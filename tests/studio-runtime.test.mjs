import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const teamDomain = "https://hanparan-test.cloudflareaccess.com";
const adminEmail = "studio-admin@example.com";
const draftMigration = readFileSync(
  new URL("../migrations/0001_phase_a_drafts.sql", import.meta.url),
  "utf8",
);
const assetMigration = readFileSync(
  new URL("../migrations/0002_phase_a_assets.sql", import.meta.url),
  "utf8",
);
const deliveryMigration = readFileSync(
  new URL("../migrations/0003_phase_a_delivery.sql", import.meta.url),
  "utf8",
);

test("keeps Studio text fields uncontrolled for native undo and redo", () => {
  const editor = readFileSync(
    new URL("../app/studio/draft-editor.tsx", import.meta.url),
    "utf8",
  );

  assert.match(editor, /name="title"[\s\S]*?defaultValue=\{draft\.title\}/);
  assert.match(editor, /name="body"[\s\S]*?defaultValue=\{draft\.body\}/);
  assert.doesNotMatch(editor, /value=\{draft\.(?:title|body)\}/);
});

class SqliteD1Statement {
  constructor(database, query, values = []) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values) {
    return new SqliteD1Statement(this.database, this.query, values);
  }

  async run() {
    const result = this.database.prepare(this.query).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }

  async first() {
    return this.database.prepare(this.query).get(...this.values) ?? null;
  }

  async all() {
    return {
      results: this.database.prepare(this.query).all(...this.values),
    };
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec(draftMigration);
    this.database.exec(assetMigration);
    this.database.exec(deliveryMigration);
  }

  prepare(query) {
    return new SqliteD1Statement(this.database, query);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

class MemoryR2 {
  constructor() {
    this.objects = new Map();
    this.deleteCalls = [];
    this.failPut = false;
    this.failDelete = false;
  }

  async get(key) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      key,
      size: stored.bytes.byteLength,
      body: new Blob([stored.bytes]).stream(),
      async arrayBuffer() {
        return stored.bytes.slice().buffer;
      },
    };
  }

  async put(key, value, options = {}) {
    if (this.failPut) throw new Error("R2 put failed");
    if (options.onlyIf?.get("if-none-match") === "*" && this.objects.has(key)) {
      return null;
    }
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : value instanceof Blob
      ? new Uint8Array(await value.arrayBuffer())
      : new Uint8Array(await new Response(value).arrayBuffer());
    const stored = { bytes: bytes.slice(), options };
    this.objects.set(key, stored);
    return { key, size: stored.bytes.byteLength };
  }

  async delete(keys) {
    const exactKeys = Array.isArray(keys) ? [...keys] : [keys];
    this.deleteCalls.push(exactKeys);
    if (this.failDelete) throw new Error("R2 delete failed");
    for (const key of exactKeys) this.objects.delete(key);
  }

  async list({ prefix = "", limit = 1_000 } = {}) {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .slice(0, limit)
        .map((key) => ({ key })),
    };
  }
}

class FakeImages {
  constructor(result = { format: "png", width: 1, height: 1 }) {
    this.result = result;
    this.calls = [];
  }

  async info(stream) {
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    this.calls.push(bytes);
    if (this.result instanceof Error) throw this.result;
    return {
      ...this.result,
      fileSize: this.result.fileSize ?? bytes.byteLength,
    };
  }

  input(stream) {
    const source = new Response(stream).arrayBuffer();
    return {
      transform: (transform) => ({
        output: async (output) => {
          await source;
          this.calls.push({ transform, output });
          const bytes = Buffer.from(
            `RIFF-${transform.width}x${transform.height}-${output.quality}-WEBP`,
          );
          return { response: () => new Response(bytes) };
        },
      }),
    };
  }
}

class MemoryQueue {
  constructor() {
    this.messages = [];
    this.failSend = false;
  }

  async send(message) {
    if (this.failSend) throw new Error("Queue send failed");
    this.messages.push(structuredClone(message));
  }
}

function queueMessage(body, attempts = 1) {
  return {
    body,
    attempts,
    acked: false,
    retryOptions: null,
    ack() {
      this.acked = true;
    },
    retry(options) {
      this.retryOptions = options ?? {};
    },
  };
}

class FakeDiscordForum {
  constructor(env) {
    this.env = env;
    this.threadId = "200000000000000001";
    this.starterMessageId = "200000000000000002";
    this.deleted = false;
    this.thread = null;
    this.message = null;
    this.attachmentSequence = 0;
    this.deleteCalls = 0;
    this.createCalls = 0;
    this.updateCalls = 0;
    this.failNextCreate = null;
    this.tags = [
      ["업데이트", "300000000000000001"],
      ["작업", "300000000000000002"],
      ["캐릭터", "300000000000000003"],
      ["세계관", "300000000000000004"],
      ["일러스트", "300000000000000005"],
      ["개발", "300000000000000006"],
    ].map(([name, id]) => ({ name, id }));
  }

  async messageFromForm(form, nested = false) {
    assert.ok(form instanceof FormData);
    const payload = JSON.parse(form.get("payload_json"));
    const source = nested ? payload.message : payload;
    const files = [...form.entries()]
      .filter(([key]) => key.startsWith("files["))
      .map(([, file]) => file);
    const attachments = (source.attachments ?? []).map((attachment, index) => ({
      id: String(400000000000000001n + BigInt(this.attachmentSequence++)),
      filename: attachment.filename,
      description: attachment.description,
      size: files[index].size,
    }));
    return {
      id: this.starterMessageId,
      channel_id: this.threadId,
      content: source.content,
      attachments,
    };
  }

  async fetch(input, init = {}) {
    const url = new URL(String(input));
    assert.equal(init.headers?.authorization, `Bot ${this.env.DISCORD_BOT_TOKEN}`);
    const forumPath = `/api/v10/channels/${this.env.DISCORD_FORUM_CHANNEL_ID}`;
    const threadPath = `/api/v10/channels/${this.threadId}`;
    const messagePath = `${threadPath}/messages/${this.starterMessageId}`;

    if (url.pathname === forumPath && (!init.method || init.method === "GET")) {
      return Response.json({
        id: this.env.DISCORD_FORUM_CHANNEL_ID,
        guild_id: this.env.DISCORD_GUILD_ID,
        type: 15,
        available_tags: this.tags,
      });
    }
    if (url.pathname === `${forumPath}/threads` && init.method === "POST") {
      this.createCalls += 1;
      if (this.failNextCreate === "network") {
        this.failNextCreate = null;
        throw new Error("unknown network result");
      }
      if (this.failNextCreate === "rate_limit") {
        this.failNextCreate = null;
        return Response.json({ retry_after: 2 }, { status: 429 });
      }
      const payload = JSON.parse(init.body.get("payload_json"));
      this.deleted = false;
      this.message = await this.messageFromForm(init.body, true);
      this.thread = {
        id: this.threadId,
        guild_id: this.env.DISCORD_GUILD_ID,
        parent_id: this.env.DISCORD_FORUM_CHANNEL_ID,
        name: payload.name,
        applied_tags: payload.applied_tags,
      };
      return Response.json({ ...this.thread, message: this.message });
    }
    if (url.pathname === threadPath && init.method === "PATCH") {
      this.updateCalls += 1;
      const payload = JSON.parse(init.body);
      Object.assign(this.thread, payload);
      return Response.json(this.thread);
    }
    if (url.pathname === messagePath && init.method === "PATCH") {
      this.message = await this.messageFromForm(init.body);
      return Response.json(this.message);
    }
    if (url.pathname === threadPath && init.method === "DELETE") {
      this.deleteCalls += 1;
      if (this.deleted) return Response.json({ message: "Unknown Channel" }, { status: 404 });
      this.deleted = true;
      return Response.json(this.thread);
    }
    if (url.pathname === threadPath && (!init.method || init.method === "GET")) {
      return this.deleted
        ? Response.json({ message: "Unknown Channel" }, { status: 404 })
        : Response.json(this.thread);
    }
    if (url.pathname === messagePath && (!init.method || init.method === "GET")) {
      return this.deleted
        ? Response.json({ message: "Unknown Channel" }, { status: 404 })
        : Response.json(this.message);
    }
    assert.fail(`Unexpected Discord request: ${init.method ?? "GET"} ${url.pathname}`);
  }
}

const staticPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function animatedPng() {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const animationControl = Buffer.alloc(20);
  animationControl.writeUInt32BE(8, 0);
  animationControl.write("acTL", 4, "ascii");
  return Buffer.concat([signature, animationControl]);
}

function animatedWebp() {
  const bytes = Buffer.alloc(20);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(12, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("ANIM", 12, "ascii");
  return bytes;
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("studio-test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

function phaseAEnv(overrides = {}) {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
    CF_ACCESS_TEAM_DOMAIN: teamDomain,
    CF_ACCESS_AUD: "access-audience",
    STUDIO_ADMIN_EMAIL: adminEmail,
    DISCORD_BOT_TOKEN: "test-bot-token",
    DISCORD_APPLICATION_ID: "100000000000000001",
    DISCORD_APPLICATION_PUBLIC_KEY: "00".repeat(32),
    DISCORD_GUILD_ID: "100000000000000002",
    DISCORD_START_CHANNEL_ID: "100000000000000003",
    DISCORD_ROLE_PANEL_MESSAGE_ID: "100000000000000004",
    DISCORD_FORUM_CHANNEL_ID: "100000000000000005",
    DISCORD_ANNOUNCEMENTS_CHANNEL_ID: "100000000000000006",
    DISCORD_NOTIFY_ROLE_ID: "100000000000000007",
    STUDIO_DB: { prepare() {}, batch() {} },
    STUDIO_MEDIA: { get() {}, put() {}, delete() {}, list() {} },
    IMAGES: { info() {}, input() {} },
    PUBLISH_QUEUE: { send() {} },
    ...overrides,
  };
}

function executionContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function accessKeys() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  Object.assign(publicJwk, { kid: "access-key", alg: "RS256", use: "sig" });

  async function token(overrides = {}) {
    const header = encodeJson({ alg: "RS256", kid: "access-key" });
    const payload = encodeJson({
      aud: "access-audience",
      email: adminEmail,
      exp: Math.floor(Date.now() / 1000) + 300,
      iss: teamDomain,
      ...overrides,
    });
    const signingInput = `${header}.${payload}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(signingInput),
    );
    return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
  }

  return { publicJwk, token };
}

async function discordKeys() {
  const pair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  return {
    privateKey: pair.privateKey,
    publicKeyHex: Buffer.from(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    ).toString("hex"),
  };
}

async function discordRequest(privateKey, payload, timestamp) {
  const body = JSON.stringify(payload);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    new TextEncoder().encode(timestamp + body),
  );
  return new Request("https://staging.example/api/discord/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": Buffer.from(signature).toString("hex"),
      "x-signature-timestamp": timestamp,
    },
    body,
  });
}

function studioRequester(worker, env, keys, token) {
  return async function request(pathname, init = {}) {
    globalThis.fetch = async (input) => {
      assert.equal(String(input), `${teamDomain}/cdn-cgi/access/certs`);
      return Response.json({ keys: [keys.publicJwk] });
    };
    return worker.fetch(
      new Request(`https://staging.example${pathname}`, {
        ...init,
        headers: {
          "cf-access-jwt-assertion": token,
          ...(init.headers ?? {}),
        },
      }),
      env,
      executionContext(),
    );
  };
}

async function createDraftFixture(request, title = "이미지 원본") {
  const response = await request("/studio/api/drafts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://staging.example",
      "x-studio-request": "1",
    },
    body: JSON.stringify({
      postId: null,
      revision: 0,
      title,
      body: "원본 업로드 경계를 검증하는 fixture입니다.",
      kind: "work",
      topics: ["illustration"],
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

function sourceUpload(postId, ordinal, bytes, options = {}) {
  const form = new FormData();
  form.set("postId", postId);
  form.set("ordinal", String(ordinal));
  form.set("alt", options.alt ?? "푸른 머리 캐릭터 테스트 이미지");
  form.set(
    "file",
    new File([bytes], options.name ?? "fixture.png", {
      type: options.type ?? "image/png",
    }),
  );
  return {
    method: "POST",
    headers: {
      origin: options.origin ?? "https://staging.example",
      "x-studio-request": "1",
    },
    body: form,
  };
}

function deleteSource(assetId) {
  return {
    pathname: `/studio/api/assets/${assetId}`,
    init: {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        origin: "https://staging.example",
        "x-studio-request": "1",
      },
      body: "{}",
    },
  };
}

test("fails closed before Phase A bindings and configuration exist", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("https://staging.example/studio"),
    {},
    executionContext(),
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("protects every Studio route with a verified Access JWT", async () => {
  const worker = await loadWorker();
  const env = phaseAEnv();
  const keys = await accessKeys();
  const originalFetch = globalThis.fetch;
  let certRequests = 0;
  const certFetcher = async (input, init) => {
    certRequests += 1;
    assert.equal(
      String(input),
      `${teamDomain}/cdn-cgi/access/certs`,
    );
    assert.equal(init.redirect, "manual");
    return Response.json({ keys: [keys.publicJwk] });
  };
  globalThis.fetch = certFetcher;

  try {
    const denied = await worker.fetch(
      new Request("https://staging.example/studio"),
      env,
      executionContext(),
    );
    assert.equal(denied.status, 403);

    for (const invalidClaims of [
      { email: "other@example.com" },
      { aud: "other-audience" },
      { iss: "https://other.cloudflareaccess.com" },
      { exp: Math.floor(Date.now() / 1000) - 1 },
      { nbf: Math.floor(Date.now() / 1000) + 60 },
    ]) {
      const invalid = await worker.fetch(
        new Request("https://staging.example/studio", {
          headers: {
            "cf-access-jwt-assertion": await keys.token(invalidClaims),
          },
        }),
        env,
        executionContext(),
      );
      assert.equal(invalid.status, 403);
    }

    const signedToken = await keys.token();
    const [signedHeader, signedPayload, signedSignature] = signedToken.split(".");
    const forgedToken = `${signedHeader}.${signedPayload}.${
      signedSignature.startsWith("A") ? "B" : "A"
    }${signedSignature.slice(1)}`;
    assert.equal(
      (
        await worker.fetch(
          new Request("https://staging.example/studio", {
            headers: { "cf-access-jwt-assertion": forgedToken },
          }),
          env,
          executionContext(),
        )
      ).status,
      403,
    );
    assert.equal(certRequests, 1);

    const token = await keys.token({ email: "Studio-Admin@Example.Com" });
    const allowed = await worker.fetch(
      new Request("https://staging.example/studio", {
        headers: { "cf-access-jwt-assertion": token },
      }),
      env,
      executionContext(),
    );
    assert.equal(allowed.status, 200);
    assert.equal(certRequests, 2);
    assert.equal(env.CF_ACCESS_AUD, "access-audience");
    assert.equal(env.STUDIO_ADMIN_EMAIL, adminEmail);
    assert.equal(allowed.headers.get("cache-control"), "private, no-store");
    const allowedHtml = await allowed.text();
    assert.match(allowedHtml, /Studio Console/);
    assert.match(allowedHtml, /Discord 역할 패널 연결/);
    assert.match(allowedHtml, /초안 불러오는 중/);
    assert.match(allowedHtml, /지금 저장/);
    // Vinext restores the fetch implementation it captured when the built
    // worker loaded, so each black-box request reinstalls the test JWKS stub.
    globalThis.fetch = certFetcher;
    for (const headers of [
      {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "x-studio-request": "1",
      },
      {
        "content-type": "application/json",
        origin: "https://staging.example",
      },
      {
        "content-type": "text/plain",
        origin: "https://staging.example",
        "x-studio-request": "1",
      },
    ]) {
      const rejectedWrite = await worker.fetch(
        new Request("https://staging.example/studio/api/drafts", {
          method: "POST",
          headers: {
            "cf-access-jwt-assertion": token,
            ...headers,
          },
          body: "{}",
        }),
        env,
        executionContext(),
      );
      assert.equal(rejectedWrite.status, 403);
      assert.equal(rejectedWrite.headers.get("cache-control"), "no-store");
    }
    assert.equal(certRequests, 5);

    globalThis.fetch = certFetcher;
    const sameOrigin = await worker.fetch(
      new Request("https://staging.example/studio/api/drafts", {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": token,
          "content-type": "application/json",
          origin: "https://staging.example",
          "x-studio-request": "1",
        },
        body: "{}",
      }),
      env,
      executionContext(),
    );
    assert.equal(certRequests, 6);
    assert.equal(sameOrigin.status, 400);
    assert.deepEqual(await sameOrigin.json(), { error: "invalid_revision" });
    assert.equal(sameOrigin.headers.get("cache-control"), "private, no-store");
    assert.equal(sameOrigin.headers.get("access-control-allow-origin"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verifies Discord signatures before PING and role writes", async () => {
  const worker = await loadWorker();
  const keys = await discordKeys();
  const env = phaseAEnv({
    DISCORD_APPLICATION_PUBLIC_KEY: keys.publicKeyHex,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const pingPayload = {
    id: "100000000000000010",
    application_id: env.DISCORD_APPLICATION_ID,
    type: 1,
  };

  const pingStarted = performance.now();
  const ping = await worker.fetch(
    await discordRequest(keys.privateKey, pingPayload, timestamp),
    env,
    executionContext(),
  );
  assert.equal(ping.status, 200);
  assert.ok(performance.now() - pingStarted < 3_000);
  assert.deepEqual(await ping.json(), { type: 1 });

  const invalidSignature = await discordRequest(
    keys.privateKey,
    pingPayload,
    timestamp,
  );
  invalidSignature.headers.set("x-signature-ed25519", "00".repeat(64));
  assert.equal(
    (await worker.fetch(invalidSignature, env, executionContext())).status,
    401,
  );

  const staleTimestamp = String(Math.floor(Date.now() / 1000) - 301);
  assert.equal(
    (
      await worker.fetch(
        await discordRequest(keys.privateKey, pingPayload, staleTimestamp),
        env,
        executionContext(),
      )
    ).status,
    401,
  );

  const rolePayload = {
    id: "100000000000000011",
    application_id: env.DISCORD_APPLICATION_ID,
    type: 3,
    guild_id: env.DISCORD_GUILD_ID,
    channel_id: env.DISCORD_START_CHANNEL_ID,
    message: { id: env.DISCORD_ROLE_PANEL_MESSAGE_ID },
    member: { user: { id: "100000000000000008" } },
    data: {
      component_type: 2,
      custom_id: "notify-role:all:add:v1",
    },
  };
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(null, { status: 204 });
  };

  try {
    const added = await worker.fetch(
      await discordRequest(keys.privateKey, rolePayload, timestamp),
      env,
      executionContext(),
    );
    assert.equal(added.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "PUT");
    assert.equal(
      calls[0].input,
      `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/100000000000000008/roles/${env.DISCORD_NOTIFY_ROLE_ID}`,
    );
    assert.equal(
      calls[0].init.headers.authorization,
      `Bot ${env.DISCORD_BOT_TOKEN}`,
    );
    assert.deepEqual(await added.json(), {
      type: 4,
      data: {
        content: "알림을 켰어요.",
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    });

    const removePayload = structuredClone(rolePayload);
    removePayload.data.custom_id = "notify-role:all:remove:v1";
    const removed = await worker.fetch(
      await discordRequest(keys.privateKey, removePayload, timestamp),
      env,
      executionContext(),
    );
    assert.equal(removed.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init.method, "DELETE");
    assert.equal((await removed.json()).data.content, "알림을 껐어요.");

    const invalidTargets = [
      ["application", (payload) => {
        payload.application_id = "100000000000000099";
      }],
      ["guild", (payload) => {
        payload.guild_id = "100000000000000099";
      }],
      ["channel", (payload) => {
        payload.channel_id = "100000000000000099";
      }],
      ["message", (payload) => {
        payload.message.id = "100000000000000099";
      }],
      ["component", (payload) => {
        payload.data.component_type = 3;
      }],
      ["custom id", (payload) => {
        payload.data.custom_id = "notify-role:other:add:v1";
      }],
    ];
    for (const [label, mutate] of invalidTargets) {
      const invalidTarget = structuredClone(rolePayload);
      mutate(invalidTarget);
      const rejected = await worker.fetch(
        await discordRequest(keys.privateKey, invalidTarget, timestamp),
        env,
        executionContext(),
      );
      assert.equal(rejected.status, 401, label);
    }
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("persists one D1 draft and rejects stale revisions without mutation", async () => {
  const worker = await loadWorker();
  const database = new SqliteD1();
  const env = phaseAEnv({ STUDIO_DB: database });
  const keys = await accessKeys();
  const token = await keys.token();
  const originalFetch = globalThis.fetch;

  async function request(pathname, init = {}) {
    globalThis.fetch = async (input) => {
      assert.equal(String(input), `${teamDomain}/cdn-cgi/access/certs`);
      return Response.json({ keys: [keys.publicJwk] });
    };
    return worker.fetch(
      new Request(`https://staging.example${pathname}`, {
        ...init,
        headers: {
          "cf-access-jwt-assertion": token,
          ...(init.headers ?? {}),
        },
      }),
      env,
      executionContext(),
    );
  }

  function write(body) {
    return request("/studio/api/drafts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://staging.example",
        "x-studio-request": "1",
      },
      body: JSON.stringify(body),
    });
  }

  try {
    const emptyResponse = await request("/studio/api/drafts");
    assert.equal(emptyResponse.status, 204);

    const initial = {
      postId: null,
      revision: 0,
      title: "첫 초안",
      body: "한국어 본문과 [안전한 링크](https://example.com/path)입니다.",
      kind: "update",
      topics: ["character", "development"],
    };
    const createdResponse = await write(initial);
    assert.equal(createdResponse.status, 201);
    assert.equal(createdResponse.headers.get("cache-control"), "private, no-store");
    assert.equal(createdResponse.headers.get("access-control-allow-origin"), null);
    const created = await createdResponse.json();
    assert.match(created.postId, /^[0-9a-f-]{36}$/i);
    assert.match(created.versionId, /^[0-9a-f-]{36}$/i);
    assert.equal(created.revision, 1);

    const restoredResponse = await request("/studio/api/drafts");
    assert.equal(restoredResponse.status, 200);
    const restored = await restoredResponse.json();
    assert.deepEqual(
      {
        postId: restored.postId,
        revision: restored.revision,
        title: restored.title,
        body: restored.body,
        kind: restored.kind,
        topics: restored.topics,
      },
      { ...initial, postId: created.postId, revision: 1 },
    );

    const updatedResponse = await write({
      ...restored,
      title: "두 번째 저장",
      body: "충돌 전 서버 본문",
      kind: "work",
      topics: ["world"],
    });
    assert.equal(updatedResponse.status, 200);
    const updated = await updatedResponse.json();
    assert.equal(updated.revision, 2);
    assert.equal(updated.postId, created.postId);

    const conflictResponse = await write({
      ...initial,
      postId: created.postId,
      revision: 1,
      title: "뒤늦은 저장",
      topics: ["illustration"],
    });
    assert.equal(conflictResponse.status, 409);
    assert.deepEqual(await conflictResponse.json(), {
      error: "revision_conflict",
      currentRevision: 2,
    });

    const unchangedResponse = await request(
      `/studio/api/drafts?postId=${created.postId}`,
    );
    assert.equal(unchangedResponse.status, 200);
    const unchanged = await unchangedResponse.json();
    assert.equal(unchanged.revision, 2);
    assert.equal(unchanged.title, "두 번째 저장");
    assert.equal(unchanged.body, "충돌 전 서버 본문");
    assert.equal(unchanged.kind, "work");
    assert.deepEqual(unchanged.topics, ["world"]);

    for (const invalidBody of [
      "<script>alert(1)</script>",
      "<img\nsrc=https://example.com/image.png>",
      "@everyone 호출",
      "[비보안 링크](http://example.com)",
    ]) {
      const invalid = await write({
        postId: created.postId,
        revision: 2,
        title: "잘못된 본문",
        body: invalidBody,
        kind: "update",
        topics: [],
      });
      assert.equal(invalid.status, 400);
    }

    assert.throws(() => {
      database.database.prepare(`
        INSERT INTO studio_post_versions (
          id, post_id, state, revision, source_hash, title, body_markdown,
          kind, locale, created_at, updated_at, schema_version
        ) VALUES (?, ?, 'draft', 1, ?, '중복', '중복', 'update', 'ko', ?, ?, 1)
      `).run(
        crypto.randomUUID(),
        created.postId,
        "0".repeat(64),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    }, /UNIQUE constraint failed/);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("stores private sources under exact R2 keys and deletes them idempotently", async () => {
  const worker = await loadWorker();
  const database = new SqliteD1();
  const media = new MemoryR2();
  const images = new FakeImages();
  const env = phaseAEnv({
    STUDIO_DB: database,
    STUDIO_MEDIA: media,
    IMAGES: images,
  });
  const keys = await accessKeys();
  const request = studioRequester(worker, env, keys, await keys.token());
  const originalFetch = globalThis.fetch;

  try {
    const draft = await createDraftFixture(request);
    const empty = await request(`/studio/api/assets?postId=${draft.postId}`);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { assets: [] });

    const firstResponse = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, staticPng),
    );
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json();
    assert.equal(first.status, "processing");
    assert.equal(first.sourceMime, "image/png");
    assert.equal(first.sourceBytes, staticPng.byteLength);
    assert.equal(first.ordinal, 0);

    const row = database.database.prepare(`
      SELECT * FROM studio_assets WHERE id = ?
    `).get(first.assetId);
    const compactTime = `${row.created_at.slice(0, 19).replaceAll(/[-:]/g, "")}Z`;
    const expectedPrefix = `posts/${row.created_at.slice(0, 4)}/${row.created_at.slice(5, 7)}/${row.created_at.slice(8, 10)}/${compactTime}--${draft.postId}--이미지-원본`;
    assert.equal(row.status, "processing");
    assert.equal(row.created_prefix, expectedPrefix);
    assert.equal(
      row.private_source_key,
      `${expectedPrefix}/private/${first.assetId}/source.png`,
    );
    assert.equal(
      row.discord_r2_key,
      `${expectedPrefix}/private/${first.assetId}/discord-v1.webp`,
    );
    assert.equal(
      row.public_r2_key,
      `${expectedPrefix}/public/${first.assetId}/portfolio-v1.webp`,
    );

    const stored = media.objects.get(row.private_source_key);
    assert.deepEqual(stored.bytes, new Uint8Array(staticPng));
    assert.equal(stored.options.onlyIf.get("if-none-match"), "*");
    assert.deepEqual(stored.options.httpMetadata, { contentType: "image/png" });
    assert.deepEqual(
      Object.keys(stored.options.customMetadata).sort(),
      ["asset_id", "created_at", "post_id", "source_sha256", "title_snapshot"],
    );
    assert.deepEqual(stored.options.customMetadata, {
      post_id: draft.postId,
      asset_id: first.assetId,
      created_at: row.created_at,
      title_snapshot: "이미지-원본",
      source_sha256: row.source_sha256,
    });
    const expectedHash = Buffer.from(
      await crypto.subtle.digest("SHA-256", staticPng),
    ).toString("hex");
    assert.equal(row.source_sha256, expectedHash);
    assert.equal(
      Buffer.from(stored.options.sha256).toString("hex"),
      expectedHash,
    );

    const secondResponse = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 1, staticPng, { alt: "두 번째 이미지" }),
    );
    assert.equal(secondResponse.status, 201);
    const second = await secondResponse.json();

    const listedResponse = await request(
      `/studio/api/assets?postId=${draft.postId}`,
    );
    assert.equal(listedResponse.status, 200);
    const listed = await listedResponse.json();
    assert.deepEqual(
      listed.assets.map(({ assetId, ordinal, alt, status }) => ({
        assetId,
        ordinal,
        alt,
        status,
      })),
      [
        {
          assetId: first.assetId,
          ordinal: 0,
          alt: "푸른 머리 캐릭터 테스트 이미지",
          status: "processing",
        },
        {
          assetId: second.assetId,
          ordinal: 1,
          alt: "두 번째 이미지",
          status: "processing",
        },
      ],
    );

    const firstDelete = deleteSource(first.assetId);
    const deleted = await request(firstDelete.pathname, firstDelete.init);
    assert.equal(deleted.status, 204);
    assert.deepEqual(media.deleteCalls[0], [
      row.private_source_key,
      row.discord_r2_key,
      row.public_r2_key,
    ]);
    assert.equal(media.objects.has(row.private_source_key), false);
    assert.equal(
      database.database.prepare("SELECT count(*) AS count FROM studio_assets WHERE id = ?")
        .get(first.assetId).count,
      0,
    );
    assert.deepEqual(
      database.database.prepare(`
        SELECT asset_id, ordinal
        FROM studio_post_version_assets
        ORDER BY ordinal
      `).all().map(({ asset_id, ordinal }) => ({ asset_id, ordinal })),
      [{ asset_id: second.assetId, ordinal: 0 }],
    );

    const secondDelete = deleteSource(second.assetId);
    media.failDelete = true;
    const failedDelete = await request(secondDelete.pathname, secondDelete.init);
    assert.equal(failedDelete.status, 503);
    assert.equal(
      database.database.prepare("SELECT status FROM studio_assets WHERE id = ?")
        .get(second.assetId).status,
      "deleting",
    );

    media.failDelete = false;
    const retriedDelete = await request(secondDelete.pathname, secondDelete.init);
    assert.equal(retriedDelete.status, 204);
    assert.equal(
      database.database.prepare("SELECT count(*) AS count FROM studio_assets")
        .get().count,
      0,
    );
    assert.equal(media.deleteCalls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("rejects unsafe image inputs and records recoverable R2 failures", async () => {
  const worker = await loadWorker();
  const database = new SqliteD1();
  const media = new MemoryR2();
  const images = new FakeImages();
  const env = phaseAEnv({
    STUDIO_DB: database,
    STUDIO_MEDIA: media,
    IMAGES: images,
  });
  const keys = await accessKeys();
  const request = studioRequester(worker, env, keys, await keys.token());
  const originalFetch = globalThis.fetch;

  try {
    const draft = await createDraftFixture(request, "입력 검증");

    const crossOrigin = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, staticPng, {
        origin: "https://attacker.example",
      }),
    );
    assert.equal(crossOrigin.status, 403);
    assert.equal(images.calls.length, 0);

    const oversizedEnvelope = await request("/studio/api/assets", {
      method: "POST",
      headers: {
        "content-length": String(20 * 1024 * 1024 + 64 * 1024 + 1),
        "content-type": "multipart/form-data; boundary=test-boundary",
        origin: "https://staging.example",
        "x-studio-request": "1",
      },
      body: "--test-boundary--\r\n",
    });
    assert.equal(oversizedEnvelope.status, 413);

    const blankAlt = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, staticPng, { alt: "   " }),
    );
    assert.equal(blankAlt.status, 400);

    images.result = { format: "gif", width: 1, height: 1 };
    const gif = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, Buffer.from("GIF89a"), {
        name: "animated.gif",
        type: "image/gif",
      }),
    );
    assert.equal(gif.status, 400);
    assert.deepEqual(await gif.json(), { error: "unsupported_image_format" });

    images.result = { format: "png", width: 8_000, height: 5_001 };
    const tooManyPixels = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, staticPng),
    );
    assert.equal(tooManyPixels.status, 400);
    assert.deepEqual(await tooManyPixels.json(), {
      error: "invalid_image_dimensions",
    });

    images.result = { format: "png", width: 1, height: 1 };
    const apng = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, animatedPng(), { name: "animated.png" }),
    );
    assert.equal(apng.status, 400);
    assert.deepEqual(await apng.json(), {
      error: "animated_image_not_allowed",
    });

    images.result = { format: "webp", width: 1, height: 1 };
    const webp = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, animatedWebp(), {
        name: "animated.webp",
        type: "image/webp",
      }),
    );
    assert.equal(webp.status, 400);
    assert.deepEqual(await webp.json(), {
      error: "animated_image_not_allowed",
    });

    images.result = { format: "png", width: 1, height: 1 };
    const wrongOrder = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 1, staticPng),
    );
    assert.equal(wrongOrder.status, 409);
    assert.deepEqual(await wrongOrder.json(), {
      error: "asset_order_conflict",
    });
    assert.equal(
      database.database.prepare("SELECT count(*) AS count FROM studio_assets")
        .get().count,
      0,
    );

    media.failPut = true;
    const failedStorage = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, staticPng),
    );
    assert.equal(failedStorage.status, 503);
    const failedBody = await failedStorage.json();
    assert.match(failedBody.assetId, /^[0-9a-f-]{36}$/i);
    const failedRow = database.database.prepare(`
      SELECT status, private_source_key, discord_r2_key, public_r2_key
      FROM studio_assets WHERE id = ?
    `).get(failedBody.assetId);
    assert.equal(failedRow.status, "failed");
    assert.equal(media.objects.size, 0);

    const listed = await request(`/studio/api/assets?postId=${draft.postId}`);
    assert.equal(listed.status, 200);
    const manifest = await listed.json();
    assert.equal(manifest.assets.length, 1);
    assert.equal(manifest.assets[0].assetId, failedBody.assetId);
    assert.equal(manifest.assets[0].status, "failed");
    assert.equal("privateSourceKey" in manifest.assets[0], false);
    assert.equal("sourceSha256" in manifest.assets[0], false);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("creates both derivatives and records Queue retry exhaustion for the DLQ", async () => {
  const worker = await loadWorker();
  const database = new SqliteD1();
  const media = new MemoryR2();
  const images = new FakeImages();
  const queue = new MemoryQueue();
  const env = phaseAEnv({
    STUDIO_DB: database,
    STUDIO_MEDIA: media,
    IMAGES: images,
    PUBLISH_QUEUE: queue,
  });
  const keys = await accessKeys();
  const token = await keys.token();
  const request = studioRequester(worker, env, keys, token);
  const originalFetch = globalThis.fetch;

  try {
    const draft = await createDraftFixture(request, "파생본 검증");
    const upload = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, staticPng),
    );
    assert.equal(upload.status, 201);
    const uploaded = await upload.json();
    assert.deepEqual(queue.messages, [
      { type: "asset_process", jobId: uploaded.jobId, assetId: uploaded.assetId },
    ]);

    const message = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [message] }, env);
    assert.equal(message.acked, true);
    assert.equal(message.retryOptions, null);
    const ready = database.database.prepare(`
      SELECT status, private_source_key, public_r2_key, discord_r2_key,
        public_bytes, public_sha256, public_width, public_height,
        discord_bytes, discord_sha256, discord_width, discord_height
      FROM studio_assets WHERE id = ?
    `).get(uploaded.assetId);
    assert.equal(ready.status, "ready");
    assert.equal(ready.public_width, 1);
    assert.equal(ready.public_height, 1);
    assert.equal(ready.discord_width, 1);
    assert.equal(ready.discord_height, 1);
    assert.match(ready.public_sha256, /^[0-9a-f]{64}$/);
    assert.match(ready.discord_sha256, /^[0-9a-f]{64}$/);
    assert.equal(media.objects.has(ready.private_source_key), true);
    assert.equal(media.objects.has(ready.public_r2_key), true);
    assert.equal(media.objects.has(ready.discord_r2_key), true);
    assert.equal(
      media.objects.get(ready.public_r2_key).options.httpMetadata.contentType,
      "image/webp",
    );
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(uploaded.jobId).status,
      "succeeded",
    );

    const listed = await request(`/studio/api/assets?postId=${draft.postId}`);
    const manifest = await listed.json();
    assert.equal(manifest.assets[0].status, "ready");
    assert.equal(manifest.assets[0].publicBytes, ready.public_bytes);
    assert.equal(manifest.assets[0].discordBytes, ready.discord_bytes);

    const attachmentBudget = 20 * 1024 * 1024;
    database.database.prepare(`
      UPDATE studio_assets SET discord_bytes = ? WHERE id = ?
    `).run(attachmentBudget, uploaded.assetId);
    const atBudget = await request(
      `/studio/api/publish?postId=${draft.postId}`,
    );
    assert.equal(atBudget.status, 200);
    const atBudgetBody = await atBudget.json();
    assert.deepEqual(atBudgetBody.assets, {
      count: 1,
      notReadyCount: 0,
      discordBytes: attachmentBudget,
    });
    assert.equal(atBudgetBody.canPublish, true);

    database.database.prepare(`
      UPDATE studio_assets SET discord_bytes = ? WHERE id = ?
    `).run(attachmentBudget + 1, uploaded.assetId);
    const overBudget = await request("/studio/api/publish", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://staging.example",
        "x-studio-request": "1",
      },
      body: JSON.stringify({ action: "publish", postId: draft.postId }),
    });
    assert.equal(overBudget.status, 413);
    assert.deepEqual(await overBudget.json(), {
      error: "discord_attachment_budget",
      attachmentBytes: attachmentBudget + 1,
      budgetBytes: attachmentBudget,
    });
    assert.deepEqual(queue.messages, []);

    const poisonDraft = await createDraftFixture(request, "DLQ 검증");
    const poisonUpload = await request(
      "/studio/api/assets",
      sourceUpload(poisonDraft.postId, 0, staticPng),
    );
    const poison = await poisonUpload.json();
    const poisonRow = database.database.prepare(`
      SELECT private_source_key FROM studio_assets WHERE id = ?
    `).get(poison.assetId);
    media.objects.delete(poisonRow.private_source_key);

    const firstAttempt = queueMessage(queue.messages.shift(), 1);
    await worker.queue({ messages: [firstAttempt] }, env);
    assert.deepEqual(firstAttempt.retryOptions, {});
    assert.equal(firstAttempt.acked, false);
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(poison.jobId).status,
      "retrying",
    );

    const dlqAttempt = queueMessage(firstAttempt.body, 4);
    await worker.queue({ messages: [dlqAttempt] }, env);
    assert.deepEqual(dlqAttempt.retryOptions, {});
    assert.equal(dlqAttempt.acked, false);
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(poison.jobId).status,
      "failed",
    );
    const failedAsset = database.database.prepare(`
      SELECT status, processing_error FROM studio_assets WHERE id = ?
    `).get(poison.assetId);
    assert.equal(failedAsset.status, "failed");
    assert.equal(failedAsset.processing_error, "source_missing");
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("creates, updates, replaces tags and attachments, then deletes one Forum mapping", async () => {
  const worker = await loadWorker();
  const database = new SqliteD1();
  const media = new MemoryR2();
  const images = new FakeImages();
  const queue = new MemoryQueue();
  const env = phaseAEnv({
    STUDIO_DB: database,
    STUDIO_MEDIA: media,
    IMAGES: images,
    PUBLISH_QUEUE: queue,
  });
  const keys = await accessKeys();
  const token = await keys.token();
  const discord = new FakeDiscordForum(env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input) === `${teamDomain}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [keys.publicJwk] });
    }
    return discord.fetch(input, init);
  };
  const request = async (pathname, init = {}) => worker.fetch(
    new Request(`https://staging.example${pathname}`, {
      ...init,
      headers: {
        "cf-access-jwt-assertion": token,
        ...(init.headers ?? {}),
      },
    }),
    env,
    executionContext(),
  );
  const jsonWrite = (body) => ({
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://staging.example",
      "x-studio-request": "1",
    },
    body: JSON.stringify(body),
  });

  try {
    const draft = await createDraftFixture(request, "첫 Forum fixture");
    const firstUpload = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, staticPng, { alt: "첫 attachment" }),
    );
    const firstAsset = await firstUpload.json();
    const firstAssetMessage = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [firstAssetMessage] }, env);
    assert.equal(firstAssetMessage.acked, true);

    const createResponse = await request(
      "/studio/api/publish",
      jsonWrite({ action: "publish", postId: draft.postId }),
    );
    assert.equal(createResponse.status, 202);
    const create = await createResponse.json();
    assert.equal(create.action, "create");
    const createMessage = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [createMessage] }, env);
    assert.equal(createMessage.acked, true);
    assert.equal(discord.createCalls, 1);
    assert.equal(discord.thread.name, "첫 Forum fixture");
    assert.equal(discord.message.attachments[0].description, "첫 attachment");
    assert.deepEqual(
      [...discord.thread.applied_tags].sort(),
      ["300000000000000002", "300000000000000005"].sort(),
    );
    const published = database.database.prepare(`
      SELECT status, current_version_id, discord_thread_id,
        discord_starter_message_id, discord_remote_hash
      FROM studio_posts WHERE id = ?
    `).get(draft.postId);
    assert.equal(published.status, "published");
    assert.equal(published.discord_thread_id, discord.threadId);
    assert.equal(published.discord_starter_message_id, discord.starterMessageId);
    assert.equal(published.discord_remote_hash, create.expectedHash);

    const detach = deleteSource(firstAsset.assetId);
    const detached = await request(detach.pathname, detach.init);
    assert.equal(detached.status, 204);
    assert.equal(
      database.database.prepare("SELECT status FROM studio_assets WHERE id = ?")
        .get(firstAsset.assetId).status,
      "ready",
    );
    assert.equal(media.objects.size, 3);

    const editedResponse = await request(
      "/studio/api/drafts",
      jsonWrite({
        postId: draft.postId,
        revision: 1,
        title: "수정된 Forum fixture",
        body: "attachment와 tag를 모두 교체했습니다.",
        kind: "update",
        topics: ["character", "development"],
      }),
    );
    assert.equal(editedResponse.status, 200);

    const secondUpload = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, staticPng, { alt: "교체 attachment" }),
    );
    const secondAsset = await secondUpload.json();
    const secondAssetMessage = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [secondAssetMessage] }, env);
    assert.equal(secondAssetMessage.acked, true);

    const updateResponse = await request(
      "/studio/api/publish",
      jsonWrite({ action: "publish", postId: draft.postId }),
    );
    assert.equal(updateResponse.status, 202);
    const update = await updateResponse.json();
    assert.equal(update.action, "update");
    const updateMessage = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [updateMessage] }, env);
    assert.equal(updateMessage.acked, true);
    assert.equal(discord.createCalls, 1);
    assert.equal(discord.updateCalls, 1);
    assert.equal(discord.thread.name, "수정된 Forum fixture");
    assert.equal(discord.message.content, "attachment와 tag를 모두 교체했습니다.");
    assert.equal(discord.message.attachments.length, 1);
    assert.equal(discord.message.attachments[0].description, "교체 attachment");
    assert.deepEqual(
      [...discord.thread.applied_tags].sort(),
      [
        "300000000000000001",
        "300000000000000003",
        "300000000000000006",
      ].sort(),
    );
    assert.equal(
      database.database.prepare(`
        SELECT count(*) AS count
        FROM studio_post_version_assets
        WHERE version_id = (SELECT current_version_id FROM studio_posts WHERE id = ?)
          AND asset_id = ?
      `).get(draft.postId, secondAsset.assetId).count,
      1,
    );

    const deleteResponse = await request(
      "/studio/api/publish",
      jsonWrite({ action: "delete", postId: draft.postId }),
    );
    assert.equal(deleteResponse.status, 202);
    const deleteMessage = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [deleteMessage] }, env);
    assert.equal(deleteMessage.acked, true);
    assert.equal(discord.deleteCalls, 1);
    assert.equal(
      database.database.prepare("SELECT status FROM studio_posts WHERE id = ?")
        .get(draft.postId).status,
      "archived",
    );

    const retryDeleteJobId = crypto.randomUUID();
    const retryAt = new Date().toISOString();
    database.database.prepare(`
      UPDATE studio_posts SET status = 'archiving' WHERE id = ?
    `).run(draft.postId);
    database.database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, version_id, target, action, payload_json,
        status, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'discord', 'delete', ?, 'queued', 0, ?, ?)
    `).run(
      retryDeleteJobId,
      `discord:delete-retry:${draft.postId}`,
      draft.postId,
      database.database.prepare("SELECT current_version_id FROM studio_posts WHERE id = ?")
        .get(draft.postId).current_version_id,
      JSON.stringify({
        threadId: discord.threadId,
        starterMessageId: discord.starterMessageId,
      }),
      retryAt,
      retryAt,
    );
    const retryDelete = queueMessage({
      type: "discord_delivery",
      jobId: retryDeleteJobId,
    });
    await worker.queue({ messages: [retryDelete] }, env);
    assert.equal(retryDelete.acked, true);
    assert.equal(discord.deleteCalls, 2);
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(retryDeleteJobId).status,
      "succeeded",
    );
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("retries Discord 429 responses but never replays an unknown create result", async () => {
  async function runCase(failure) {
    const worker = await loadWorker();
    const database = new SqliteD1();
    const queue = new MemoryQueue();
    const env = phaseAEnv({
      STUDIO_DB: database,
      STUDIO_MEDIA: new MemoryR2(),
      IMAGES: new FakeImages(),
      PUBLISH_QUEUE: queue,
    });
    const keys = await accessKeys();
    const token = await keys.token();
    const discord = new FakeDiscordForum(env);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      if (String(input) === `${teamDomain}/cdn-cgi/access/certs`) {
        return Response.json({ keys: [keys.publicJwk] });
      }
      return discord.fetch(input, init);
    };
    const request = async (pathname, init = {}) => worker.fetch(
      new Request(`https://staging.example${pathname}`, {
        ...init,
        headers: {
          "cf-access-jwt-assertion": token,
          ...(init.headers ?? {}),
        },
      }),
      env,
      executionContext(),
    );
    try {
      const draft = await createDraftFixture(request, `${failure} fixture`);
      const response = await request("/studio/api/publish", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://staging.example",
          "x-studio-request": "1",
        },
        body: JSON.stringify({ action: "publish", postId: draft.postId }),
      });
      assert.equal(response.status, 202);
      const published = await response.json();
      discord.failNextCreate = failure;
      const message = queueMessage(queue.messages.shift(), 1);
      await worker.queue({ messages: [message] }, env);
      return { worker, database, env, discord, message, published };
    } catch (error) {
      database.close();
      throw error;
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  const rateLimited = await runCase("rate_limit");
  try {
    assert.equal(rateLimited.message.acked, false);
    assert.deepEqual(rateLimited.message.retryOptions, { delaySeconds: 2 });
    assert.equal(
      rateLimited.database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(rateLimited.published.jobId).status,
      "retrying",
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init = {}) => rateLimited.discord.fetch(input, init);
    try {
      const replay = queueMessage(rateLimited.message.body, 2);
      await rateLimited.worker.queue({ messages: [replay] }, rateLimited.env);
      assert.equal(replay.acked, true);
      assert.equal(replay.retryOptions, null);
      assert.equal(rateLimited.discord.createCalls, 2);
      assert.equal(
        rateLimited.database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
          .get(rateLimited.published.jobId).status,
        "succeeded",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    rateLimited.database.close();
  }

  const unknown = await runCase("network");
  try {
    assert.equal(unknown.message.acked, true);
    assert.equal(unknown.message.retryOptions, null);
    assert.equal(
      unknown.database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(unknown.published.jobId).status,
      "outcome_unknown",
    );
    const replay = queueMessage(unknown.message.body, 2);
    await unknown.worker.queue({ messages: [replay] }, unknown.env);
    assert.equal(replay.acked, true);
    assert.equal(replay.retryOptions, null);
    assert.equal(unknown.discord.createCalls, 1);
  } finally {
    unknown.database.close();
  }
});

test("creates the exact Discord role panel only after Access and same-origin checks", async () => {
  const worker = await loadWorker();
  const env = phaseAEnv();
  const keys = await accessKeys();
  const originalFetch = globalThis.fetch;
  const discordCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === `${teamDomain}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [keys.publicJwk] });
    }
    discordCalls.push({ url, init });
    if (init.method === "PATCH") {
      return Response.json({ message: "Unknown Message" }, { status: 404 });
    }
    return Response.json({
      id: "100000000000000009",
      channel_id: env.DISCORD_START_CHANNEL_ID,
    });
  };

  try {
    const response = await worker.fetch(
      new Request("https://staging.example/studio/api/discord/role-panel", {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": await keys.token(),
          "content-type": "application/json",
          origin: "https://staging.example",
          "x-studio-request": "1",
        },
        body: "{}",
      }),
      env,
      executionContext(),
    );

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      messageId: "100000000000000009",
      channelId: env.DISCORD_START_CHANNEL_ID,
      created: true,
    });
    assert.equal(discordCalls.length, 2);
    assert.equal(discordCalls[0].init.method, "PATCH");
    assert.equal(discordCalls[1].init.method, "POST");
    assert.equal(
      discordCalls[1].url,
      `https://discord.com/api/v10/channels/${env.DISCORD_START_CHANNEL_ID}/messages`,
    );
    assert.equal(
      discordCalls[1].init.headers.authorization,
      `Bot ${env.DISCORD_BOT_TOKEN}`,
    );
    const body = JSON.parse(discordCalls[1].init.body);
    assert.deepEqual(body.allowed_mentions, { parse: [] });
    assert.deepEqual(
      body.components[0].components.map(({ custom_id }) => custom_id),
      ["notify-role:all:add:v1", "notify-role:all:remove:v1"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
