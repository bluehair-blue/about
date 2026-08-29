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
