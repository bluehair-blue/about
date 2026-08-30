import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const teamDomain = "https://hanparan-test.cloudflareaccess.com";
const adminEmail = "studio-admin@example.com";
const cloudflareZoneId = "f".repeat(32);
const cachePurgeToken = "test-cache-purge-token-000000000000";
const cachePurgeEndpoint = `https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/purge_cache`;
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
const canonicalSchemaMigration = readFileSync(
  new URL("../migrations/0004_phase_b_canonical_schema.sql", import.meta.url),
  "utf8",
);
const taxonomyMigration = readFileSync(
  new URL("../migrations/0005_phase_b_taxonomy.sql", import.meta.url),
  "utf8",
);
const assetCleanupMigration = readFileSync(
  new URL("../migrations/0006_phase_b_asset_manifest_cleanup.sql", import.meta.url),
  "utf8",
);

test("keeps Studio autosave single-flight, IME-aware, and native", () => {
  const editor = readFileSync(
    new URL("../app/studio/draft-editor.tsx", import.meta.url),
    "utf8",
  );

  assert.match(editor, /if \(savingRef\.current\) queuedSaveRef\.current = true;/);
  assert.match(editor, /savePromiseRef\.current[\s\S]*?return savePromiseRef\.current/);
  assert.match(editor, /while \(queuedSaveRef\.current && dirtyRef\.current\)/);
  assert.match(editor, /queuedSaveRef\.current = false/);
  assert.match(editor, /window\.setTimeout\([\s\S]*?1_500\)/);
  assert.match(editor, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(editor, /onCompositionStart=\{handleCompositionStart\}/);
  assert.match(editor, /onCompositionEnd=\{handleCompositionEnd\}/);
  assert.match(editor, /다른 창에서 수정됨/);
  assert.match(editor, /다시 로그인 필요/);
  assert.match(editor, /topics: \[\.\.\.result\.topics\]/);
  assert.doesNotMatch(editor, /topics: draftTopics\.filter/);
  assert.match(editor, /name="title"[\s\S]*?defaultValue=\{draft\.title\}/);
  assert.match(editor, /name="body"[\s\S]*?defaultValue=\{draft\.body\}/);
  assert.doesNotMatch(editor, /value=\{draft\.(?:title|body)\}/);
});

test("keeps Studio task switches on stable URLs until draft and source receipts are safe", () => {
  const editor = readFileSync(
    new URL("../app/studio/draft-editor.tsx", import.meta.url),
    "utf8",
  );
  const uploader = readFileSync(
    new URL("../app/studio/image-uploader.tsx", import.meta.url),
    "utf8",
  );
  const list = readFileSync(
    new URL("../app/studio/draft-list.tsx", import.meta.url),
    "utf8",
  );

  assert.match(editor, /window\.history\.replaceState\([\s\S]*?\/studio\/posts\//);
  assert.match(editor, /window\.addEventListener\("beforeunload"/);
  assert.match(editor, /const initialDraftSaved = await saveCurrent\(\)/);
  assert.match(editor, /assetManifestFlushRef\.current/);
  assert.match(editor, /pendingUploadCountRef\.current/);
  assert.match(editor, /window\.location\.assign\(target\)/);
  assert.match(editor, /<dialog/);
  assert.match(editor, />\s*다시 저장\s*</);
  assert.match(editor, />\s*현재 화면 유지\s*</);
  assert.match(editor, />\s*변경 내용 복사\s*</);
  assert.doesNotMatch(editor, /저장하지 않고 이동|변경 내용 버리기/);
  assert.match(uploader, /responseError === "asset_storage_failed"/);
  assert.match(uploader, /failedAssetId: responseAssetId/);
  assert.match(uploader, /receiptUnknown: submitted \|\| undefined/);
  assert.match(uploader, /asset\.status === "uploading"/);
  assert.match(uploader, /asset\.processingError === "asset_storage_failed"/);
  assert.match(uploader, /onPendingChange\(unacceptedCount, receiptChecked\)/);
  assert.match(list, /"all" \| "working" \| "attention"/);
  assert.match(list, /\/studio\/posts\/new/);
  assert.match(list, /작업 재개/);
});

test("keeps the Phase B Studio UI on canonical Markdown, taxonomy, Media, and surface contracts", () => {
  const editor = readFileSync(
    new URL("../app/studio/draft-editor.tsx", import.meta.url),
    "utf8",
  );
  const preview = readFileSync(
    new URL("../app/studio/surface-preview.tsx", import.meta.url),
    "utf8",
  );
  const uploader = readFileSync(
    new URL("../app/studio/image-uploader.tsx", import.meta.url),
    "utf8",
  );
  const taxonomy = readFileSync(
    new URL("../app/studio/taxonomy-controls.tsx", import.meta.url),
    "utf8",
  );
  const media = readFileSync(
    new URL("../app/studio/media-library.tsx", import.meta.url),
    "utf8",
  );
  const list = readFileSync(
    new URL("../app/studio/draft-list.tsx", import.meta.url),
    "utf8",
  );
  const delivery = readFileSync(
    new URL("../app/studio/delivery-controls.tsx", import.meta.url),
    "utf8",
  );

  assert.match(editor, /validateStudioMarkdown/);
  assert.match(editor, /textarea\.setRangeText/);
  assert.match(editor, /role="toolbar"/);
  assert.match(editor, />굵게</);
  assert.match(editor, />link</);
  assert.match(preview, /Portfolio/);
  assert.match(preview, /Discord Forum starter/);
  assert.match(preview, /surface=portfolio/);
  assert.match(preview, /surface=discord/);
  assert.doesNotMatch(preview, /dangerouslySetInnerHTML/);

  assert.match(taxonomy, /fetch\("\/studio\/api\/taxonomy"/);
  assert.match(taxonomy, /const displayedTopics = result \? activeTopics : fallbackTopics/);
  assert.match(taxonomy, /<details/);
  assert.match(uploader, /method: "PATCH"/);
  assert.match(uploader, /draggable=/);
  assert.match(uploader, /window\.setTimeout\(\(\) => void saveManifest\(\), 1_500\)/);
  assert.match(uploader, />\s*위\s*</);
  assert.match(uploader, />\s*아래\s*</);

  assert.match(media, /new URLSearchParams\(\{ view: "media" \}\)/);
  assert.match(media, /소유 post 편집기/);
  assert.match(media, /JSON\.stringify\(\{ assetId: item\.assetId \}\)/);
  assert.match(media, /마지막 확인/);
  assert.match(list, /Portfolio/);
  assert.match(list, /Discord/);
  assert.match(list, /href="\/studio\/media"/);
  assert.match(delivery, /오래된 상태이며 action을 막았습니다/);
  assert.match(delivery, /Discord 재전송 없이 D1 반영 재시도/);
  assert.match(delivery, /<details/);
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

class FailingD1Statement {
  bind() {
    return this;
  }

  async run() {
    throw new Error("D1 write failed");
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec(draftMigration);
    this.database.exec(assetMigration);
    this.database.exec(deliveryMigration);
    this.database.exec(canonicalSchemaMigration);
    this.database.exec(taxonomyMigration);
    this.database.exec(assetCleanupMigration);
    const tagIds = {
      update: "300000000000000001",
      work: "300000000000000002",
      character: "300000000000000003",
      world: "300000000000000004",
      illustration: "300000000000000005",
      development: "300000000000000006",
    };
    for (const [stableKey, tagId] of Object.entries(tagIds)) {
      this.database.prepare(`
        UPDATE studio_taxonomy SET discord_tag_id = ? WHERE stable_key = ?
      `).run(tagId, stableKey);
    }
    this.failQueueFailureWrite = false;
    this.beforeTaxonomyLeaseExpire = null;
  }

  prepare(query) {
    if (this.failQueueFailureWrite && query.includes("queue_send_failed")) {
      return new FailingD1Statement();
    }
    if (this.beforeTaxonomyLeaseExpire && query.includes("taxonomy_processing_lease_cas")) {
      const hook = this.beforeTaxonomyLeaseExpire;
      this.beforeTaxonomyLeaseExpire = null;
      hook();
    }
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
      truncated: false,
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
    this.notificationCalls = 0;
    this.notificationPayloads = [];
    this.taxonomyPatchCalls = 0;
    this.nextTagId = 300000000000000100n;
    this.failNextTaxonomy = null;
    this.failNextCreate = null;
    this.failNextNotification = null;
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
    const announcementPath =
      `/api/v10/channels/${this.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID}/messages`;

    if (url.pathname === announcementPath && init.method === "POST") {
      this.notificationCalls += 1;
      if (this.failNextNotification === "network") {
        this.failNextNotification = null;
        throw new Error("unknown notification result");
      }
      if (this.failNextNotification === "rate_limit") {
        this.failNextNotification = null;
        return Response.json({ retry_after: 2 }, { status: 429 });
      }
      if (this.failNextNotification === "server") {
        this.failNextNotification = null;
        return Response.json({ message: "server error" }, { status: 500 });
      }
      const payload = JSON.parse(init.body);
      assert.deepEqual(payload.allowed_mentions, {
        roles: [this.env.DISCORD_NOTIFY_ROLE_ID],
      });
      assert.match(payload.nonce, /^[0-9a-f]{25}$/u);
      assert.equal(payload.enforce_nonce, true);
      this.notificationPayloads.push(payload);
      return Response.json({
        id: "200000000000000003",
        channel_id: this.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID,
        content: payload.content,
      });
    }

    if (url.pathname === forumPath && (!init.method || init.method === "GET")) {
      return Response.json({
        id: this.env.DISCORD_FORUM_CHANNEL_ID,
        guild_id: this.env.DISCORD_GUILD_ID,
        type: 15,
        available_tags: this.tags,
      });
    }
    if (url.pathname === forumPath && init.method === "PATCH") {
      this.taxonomyPatchCalls += 1;
      if (this.failNextTaxonomy === "network") {
        this.failNextTaxonomy = null;
        throw new Error("unknown taxonomy result");
      }
      if (this.failNextTaxonomy === "rate_limit") {
        this.failNextTaxonomy = null;
        return Response.json({ retry_after: 2 }, { status: 429 });
      }
      const payload = JSON.parse(init.body);
      assert.ok(Array.isArray(payload.available_tags));
      this.tags = payload.available_tags.map((tag) => ({
        ...tag,
        id: tag.id ?? String(this.nextTagId++),
      }));
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
    ASSET_ORPHAN_RETENTION_DAYS: "7",
    VERSION_ROLLBACK_RETENTION_DAYS: "30",
    STUDIO_PUBLIC_ORIGIN: "https://staging.example",
    CLOUDFLARE_ZONE_ID: cloudflareZoneId,
    CLOUDFLARE_CACHE_PURGE_TOKEN: cachePurgeToken,
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

function studioRequester(worker, env, keys, token, purgeCalls = null) {
  return async function request(pathname, init = {}) {
    globalThis.fetch = async (input, fetchInit = {}) => {
      const url = String(input);
      if (url === `${teamDomain}/cdn-cgi/access/certs`) {
        return Response.json({ keys: [keys.publicJwk] });
      }
      if (url === cachePurgeEndpoint && purgeCalls) {
        assert.equal(fetchInit.method, "POST");
        const headers = new Headers(fetchInit.headers);
        assert.equal(headers.get("authorization"), `Bearer ${cachePurgeToken}`);
        const body = JSON.parse(String(fetchInit.body));
        assert.deepEqual(body, { files: [body.files[0]] });
        purgeCalls.push(body.files[0]);
        return Response.json({ success: true, result: { id: cloudflareZoneId } });
      }
      assert.fail(`unexpected fetch: ${url}`);
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
  form.set("revision", String(options.revision ?? 1));
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

function studioJsonWrite(body) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://staging.example",
      "x-studio-request": "1",
    },
    body: JSON.stringify(body),
  };
}

function deleteSource(assetId, expectedRevision) {
  return {
    pathname: `/studio/api/assets/${assetId}`,
    init: {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        origin: "https://staging.example",
        "x-studio-request": "1",
      },
      body: JSON.stringify({ expectedRevision }),
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
      new Request("https://staging.example/studio?filter=all", {
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
    assert.match(allowedHtml, /작업 목록/);
    assert.match(allowedHtml, /새 초안/);
    assert.match(allowedHtml, /작업 목록 불러오는 중/);
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

test("lists active drafts by stable Studio URL without expiring old work", async () => {
  const worker = await loadWorker();
  const database = new SqliteD1();
  const env = phaseAEnv({ STUDIO_DB: database });
  const keys = await accessKeys();
  const originalFetch = globalThis.fetch;
  const request = studioRequester(worker, env, keys, await keys.token());

  try {
    const oldDraft = await createDraftFixture(request, "오래된 active draft");
    const attentionDraft = await createDraftFixture(request, "확인이 필요한 draft");
    database.database.prepare(`
      UPDATE studio_post_versions SET updated_at = '2001-01-01T00:00:00.000Z'
      WHERE post_id = ? AND state = 'draft'
    `).run(oldDraft.postId);
    database.database.prepare(`
      UPDATE studio_posts
      SET updated_at = '2001-01-01T00:00:00.000Z'
      WHERE id = ?
    `).run(oldDraft.postId);
    database.database.prepare(`
      UPDATE studio_posts SET status = 'withheld' WHERE id = ?
    `).run(attentionDraft.postId);

    const stable = await request(
      `/studio/api/drafts?postId=${oldDraft.postId}`,
    );
    assert.equal(stable.status, 200);
    const stableDraft = await stable.json();
    assert.equal(stableDraft.postId, oldDraft.postId);
    assert.equal(stableDraft.title, "오래된 active draft");
    assert.equal(stableDraft.editable, true);

    const missing = await request(
      `/studio/api/drafts?postId=${crypto.randomUUID()}`,
    );
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "draft_not_found" });

    const allResponse = await request("/studio/api/drafts?filter=all");
    assert.equal(allResponse.status, 200);
    const all = await allResponse.json();
    assert.deepEqual(all.counts, { all: 2, working: 2, attention: 1 });
    assert.equal(all.items.length, 2);
    assert.equal(all.items[0].postId, attentionDraft.postId);
    assert.equal(all.items[0].attentionReason, "post_withheld");
    assert.equal(all.items[0].needsAttention, true);

    const workingResponse = await request(
      "/studio/api/drafts?filter=working",
    );
    assert.equal(workingResponse.status, 200);
    const working = await workingResponse.json();
    assert.equal(working.items.length, 2);
    assert.equal(
      working.items.some((item) => item.postId === oldDraft.postId),
      true,
    );

    const attentionResponse = await request(
      "/studio/api/drafts?filter=attention",
    );
    assert.equal(attentionResponse.status, 200);
    const attention = await attentionResponse.json();
    assert.equal(attention.items.length, 1);
    assert.equal(attention.items[0].postId, attentionDraft.postId);

    const frozenResponse = await request(
      `/studio/api/drafts?postId=${attentionDraft.postId}`,
    );
    assert.equal(frozenResponse.status, 200);
    const frozen = await frozenResponse.json();
    assert.equal(frozen.postStatus, "withheld");
    assert.equal(frozen.editable, false);
    const frozenAssets = await request(
      `/studio/api/assets?postId=${attentionDraft.postId}`,
    );
    assert.equal(frozenAssets.status, 200);
    assert.deepEqual((await frozenAssets.json()).assets, []);
    const rejectedSave = await request(
      "/studio/api/drafts",
      studioJsonWrite({
        postId: frozen.postId,
        revision: frozen.revision,
        title: frozen.title,
        body: frozen.body,
        kind: frozen.kind,
        topics: frozen.topics,
      }),
    );
    assert.equal(rejectedSave.status, 404);

    const invalidFilter = await request(
      "/studio/api/drafts?filter=unknown",
    );
    assert.equal(invalidFilter.status, 400);
    const mixedQuery = await request(
      `/studio/api/drafts?filter=all&postId=${oldDraft.postId}`,
    );
    assert.equal(mixedQuery.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("adds, renames, reorders, and archives one canonical Forum taxonomy", async () => {
  const worker = await loadWorker();
  const database = new SqliteD1();
  const queue = new MemoryQueue();
  const env = phaseAEnv({ STUDIO_DB: database, PUBLISH_QUEUE: queue });
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
    const initialResponse = await request("/studio/api/taxonomy");
    assert.equal(initialResponse.status, 200);
    const initial = await initialResponse.json();
    assert.equal(initial.taxonomy.length, 6);
    assert.equal(initial.latestJob, null);

    const addResponse = await request(
      "/studio/api/taxonomy",
      studioJsonWrite({
        action: "add",
        dimension: "topic",
        stableKey: "music",
        label: "음악",
      }),
    );
    assert.equal(addResponse.status, 202);
    const add = await addResponse.json();
    assert.equal(add.status, "queued");

    const blocked = await request(
      "/studio/api/taxonomy",
      studioJsonWrite({ action: "sync" }),
    );
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).jobId, add.jobId);

    const addMessage = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [addMessage] }, env);
    assert.equal(addMessage.acked, true);
    assert.equal(discord.taxonomyPatchCalls, 1);
    const added = database.database.prepare(`
      SELECT id, stable_key, label, status, ordinal, discord_tag_id
      FROM studio_taxonomy WHERE stable_key = 'music'
    `).get();
    assert.equal(added.label, "음악");
    assert.equal(added.status, "active");
    assert.equal(added.ordinal, 4);
    assert.match(added.discord_tag_id, /^\d{17,20}$/);

    const dynamicDraft = await request(
      "/studio/api/drafts",
      studioJsonWrite({
        postId: null,
        revision: 0,
        title: "동적 taxonomy 초안",
        body: "새 topic을 draft snapshot에 저장합니다.",
        kind: "work",
        topics: ["music"],
      }),
    );
    assert.equal(dynamicDraft.status, 201);
    const draft = await dynamicDraft.json();
    const restoredDynamicDraft = await request(
      `/studio/api/drafts?postId=${draft.postId}`,
    );
    assert.equal(restoredDynamicDraft.status, 200);
    assert.deepEqual((await restoredDynamicDraft.json()).topics, ["music"]);

    const renameResponse = await request(
      "/studio/api/taxonomy",
      studioJsonWrite({
        action: "rename",
        taxonomyId: added.id,
        label: "음악 작업",
      }),
    );
    assert.equal(renameResponse.status, 202);
    const renameMessage = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [renameMessage] }, env);
    assert.equal(renameMessage.acked, true);
    const renamed = database.database.prepare(`
      SELECT stable_key, label, discord_tag_id
      FROM studio_taxonomy WHERE id = ?
    `).get(added.id);
    assert.deepEqual(
      { ...renamed },
      {
        stable_key: "music",
        label: "음악 작업",
        discord_tag_id: added.discord_tag_id,
      },
    );

    const topics = database.database.prepare(`
      SELECT id, stable_key FROM studio_taxonomy
      WHERE dimension = 'topic' AND status = 'active'
      ORDER BY ordinal
    `).all();
    const reorderedIds = [
      added.id,
      ...topics.filter(({ id }) => id !== added.id).map(({ id }) => id),
    ];
    const reorderResponse = await request(
      "/studio/api/taxonomy",
      studioJsonWrite({
        action: "reorder",
        dimension: "topic",
        taxonomyIds: reorderedIds,
      }),
    );
    assert.equal(reorderResponse.status, 202);
    const reorderMessage = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [reorderMessage] }, env);
    assert.equal(reorderMessage.acked, true);
    assert.deepEqual(
      database.database.prepare(`
        SELECT stable_key FROM studio_taxonomy
        WHERE dimension = 'topic' AND status = 'active'
        ORDER BY ordinal
      `).all().map(({ stable_key }) => stable_key),
      ["music", "character", "world", "illustration", "development"],
    );
    assert.deepEqual(
      discord.tags.map(({ name }) => name),
      ["업데이트", "작업", "음악 작업", "캐릭터", "세계관", "일러스트", "개발"],
    );

    const archiveResponse = await request(
      "/studio/api/taxonomy",
      studioJsonWrite({ action: "archive", taxonomyId: added.id }),
    );
    assert.equal(archiveResponse.status, 202);
    const archiveMessage = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [archiveMessage] }, env);
    assert.equal(archiveMessage.acked, true);
    assert.equal(
      database.database.prepare("SELECT status FROM studio_taxonomy WHERE id = ?")
        .get(added.id).status,
      "archived",
    );
    assert.equal(discord.tags.some(({ name }) => name === "음악 작업"), false);
    assert.equal(
      database.database.prepare(`
        SELECT count(*) AS count
        FROM studio_post_version_topics AS selected
        JOIN studio_post_versions AS version ON version.id = selected.version_id
        WHERE version.post_id = ? AND selected.taxonomy_id = ?
      `).get(draft.postId, added.id).count,
      1,
    );

    const savedWithArchivedTopic = await request(
      "/studio/api/drafts",
      studioJsonWrite({
        postId: draft.postId,
        revision: draft.revision,
        title: "동적 taxonomy 초안 수정",
        body: "이미 선택한 보관 topic은 같은 draft에서 계속 저장할 수 있습니다.",
        kind: "work",
        topics: ["music"],
      }),
    );
    assert.equal(savedWithArchivedTopic.status, 200);
    const kept = await savedWithArchivedTopic.json();
    const withoutArchivedTopic = await request(
      "/studio/api/drafts",
      studioJsonWrite({
        postId: draft.postId,
        revision: kept.revision,
        title: "동적 taxonomy 초안 수정",
        body: "보관 topic 선택을 해제합니다.",
        kind: "work",
        topics: [],
      }),
    );
    assert.equal(withoutArchivedTopic.status, 200);
    const removed = await withoutArchivedTopic.json();
    const reselectArchivedTopic = await request(
      "/studio/api/drafts",
      studioJsonWrite({
        postId: draft.postId,
        revision: removed.revision,
        title: "동적 taxonomy 초안 수정",
        body: "해제한 보관 topic을 다시 선택할 수는 없습니다.",
        kind: "work",
        topics: ["music"],
      }),
    );
    assert.equal(reselectArchivedTopic.status, 409);
    assert.deepEqual(await reselectArchivedTopic.json(), { error: "invalid_topics" });

    const archivedDraft = await request(
      "/studio/api/drafts",
      studioJsonWrite({
        postId: null,
        revision: 0,
        title: "보관 taxonomy 거부",
        body: "보관된 topic은 새 draft에서 선택할 수 없습니다.",
        kind: "work",
        topics: ["music"],
      }),
    );
    assert.equal(archivedDraft.status, 409);
    assert.deepEqual(await archivedDraft.json(), { error: "invalid_topics" });

    const kindId = initial.taxonomy.find(({ stableKey }) => stableKey === "work").id;
    const kindArchive = await request(
      "/studio/api/taxonomy",
      studioJsonWrite({ action: "archive", taxonomyId: kindId }),
    );
    assert.equal(kindArchive.status, 409);
    assert.deepEqual(await kindArchive.json(), {
      error: "kind_migration_required",
    });
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("recovers a taxonomy outbox after Queue failure and Discord rate limiting", async () => {
  const worker = await loadWorker();
  const database = new SqliteD1();
  const queue = new MemoryQueue();
  const env = phaseAEnv({ STUDIO_DB: database, PUBLISH_QUEUE: queue });
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
    database.database.prepare("UPDATE studio_taxonomy SET discord_tag_id = NULL").run();
    queue.failSend = true;
    const failedResponse = await request(
      "/studio/api/taxonomy",
      studioJsonWrite({ action: "sync" }),
    );
    assert.equal(failedResponse.status, 503);
    const failed = await failedResponse.json();
    assert.equal(failed.error, "queue_send_failed");
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(failed.jobId).status,
      "queue_failed",
    );

    queue.failSend = false;
    const retryResponse = await request(
      "/studio/api/taxonomy",
      studioJsonWrite({ action: "retry", jobId: failed.jobId }),
    );
    assert.equal(retryResponse.status, 202);
    const retryMessage = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [retryMessage] }, env);
    assert.equal(retryMessage.acked, true);
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(failed.jobId).status,
      "succeeded",
    );
    assert.equal(
      database.database.prepare(`
        SELECT count(*) AS count FROM studio_taxonomy
        WHERE status = 'active' AND discord_tag_id IS NULL
      `).get().count,
      0,
    );
    assert.equal(discord.taxonomyPatchCalls, 0);

    const character = database.database.prepare(`
      SELECT id FROM studio_taxonomy WHERE stable_key = 'character'
    `).get();
    const renameResponse = await request(
      "/studio/api/taxonomy",
      studioJsonWrite({
        action: "rename",
        taxonomyId: character.id,
        label: "인물",
      }),
    );
    assert.equal(renameResponse.status, 202);
    const body = queue.messages.shift();
    discord.failNextTaxonomy = "rate_limit";
    const limitedMessage = queueMessage(body);
    await worker.queue({ messages: [limitedMessage] }, env);
    assert.equal(limitedMessage.acked, false);
    assert.deepEqual(limitedMessage.retryOptions, { delaySeconds: 2 });
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get((await renameResponse.json()).jobId).status,
      "retrying",
    );

    const recoveredMessage = queueMessage(body, 2);
    await worker.queue({ messages: [recoveredMessage] }, env);
    assert.equal(recoveredMessage.acked, true);
    assert.equal(discord.tags.some(({ name }) => name === "인물"), true);

    const overlapResponse = await request(
      "/studio/api/taxonomy",
      studioJsonWrite({ action: "sync" }),
    );
    assert.equal(overlapResponse.status, 202);
    const overlapJob = await overlapResponse.json();
    const overlapBody = queue.messages.shift();
    database.database.prepare(`
      UPDATE delivery_jobs SET status = 'processing', updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), overlapJob.jobId);
    const terminalDuplicate = queueMessage(overlapBody, 4);
    await worker.queue({ messages: [terminalDuplicate] }, env);
    assert.equal(terminalDuplicate.acked, false);
    assert.deepEqual(terminalDuplicate.retryOptions, { delaySeconds: 5 });
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(overlapJob.jobId).status,
      "processing",
    );

    database.database.prepare(`
      UPDATE delivery_jobs SET updated_at = ? WHERE id = ?
    `).run(new Date(Date.now() - 120_000).toISOString(), overlapJob.jobId);
    database.beforeTaxonomyLeaseExpire = () => {
      const reclaimedAt = new Date().toISOString();
      database.database.prepare(`
        UPDATE delivery_jobs SET status = 'retrying', updated_at = ? WHERE id = ?
      `).run(reclaimedAt, overlapJob.jobId);
      database.database.prepare(`
        UPDATE delivery_jobs SET status = 'processing', updated_at = ? WHERE id = ?
      `).run(reclaimedAt, overlapJob.jobId);
    };
    const reclaimedTerminal = queueMessage(overlapBody, 4);
    await worker.queue({ messages: [reclaimedTerminal] }, env);
    assert.equal(reclaimedTerminal.acked, false);
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(overlapJob.jobId).status,
      "processing",
    );

    database.database.prepare(`
      UPDATE delivery_jobs SET updated_at = ? WHERE id = ?
    `).run(new Date(Date.now() - 120_000).toISOString(), overlapJob.jobId);
    const staleTerminal = queueMessage(overlapBody, 4);
    await worker.queue({ messages: [staleTerminal] }, env);
    assert.equal(staleTerminal.acked, false);
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(overlapJob.jobId).status,
      "failed",
    );
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("reorders the revisioned image manifest and exposes safe Studio Media previews", async () => {
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
  const request = studioRequester(worker, env, keys, await keys.token());
  const originalFetch = globalThis.fetch;

  try {
    const draft = await createDraftFixture(request, "Media 검색 fixture");
    const firstResponse = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, staticPng, {
        alt: "첫 번째 alt",
        revision: 1,
      }),
    );
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json();
    const secondResponse = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 1, staticPng, {
        alt: "두 번째 alt",
        revision: first.revision,
      }),
    );
    assert.equal(secondResponse.status, 201);
    const second = await secondResponse.json();
    assert.equal(second.revision, 3);

    for (const body of queue.messages.splice(0)) {
      const message = queueMessage(body);
      await worker.queue({ messages: [message] }, env);
      assert.equal(message.acked, true);
    }

    const manifestBody = {
      postId: draft.postId,
      revision: second.revision,
      assets: [
        { assetId: second.assetId, ordinal: 0, alt: "앞으로 이동한 두 번째 alt" },
        { assetId: first.assetId, ordinal: 1, alt: "뒤로 이동한 첫 번째 alt" },
      ],
    };
    const reordered = await request("/studio/api/assets", {
      ...studioJsonWrite(manifestBody),
      method: "PATCH",
    });
    assert.equal(reordered.status, 200);
    const reorderedBody = await reordered.json();
    assert.equal(reorderedBody.revision, 4);

    const listed = await request(`/studio/api/assets?postId=${draft.postId}`);
    assert.equal(listed.status, 200);
    const listedBody = await listed.json();
    assert.equal(listedBody.revision, 4);
    assert.deepEqual(
      listedBody.assets.map(({ assetId, ordinal, alt, status }) => ({
        assetId,
        ordinal,
        alt,
        status,
      })),
      [
        {
          assetId: second.assetId,
          ordinal: 0,
          alt: "앞으로 이동한 두 번째 alt",
          status: "ready",
        },
        {
          assetId: first.assetId,
          ordinal: 1,
          alt: "뒤로 이동한 첫 번째 alt",
          status: "ready",
        },
      ],
    );

    const stale = await request("/studio/api/assets", {
      ...studioJsonWrite(manifestBody),
      method: "PATCH",
    });
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), {
      error: "revision_conflict",
      currentRevision: 4,
    });
    const incomplete = await request("/studio/api/assets", {
      ...studioJsonWrite({
        postId: draft.postId,
        revision: 4,
        assets: [{ assetId: second.assetId, ordinal: 0, alt: "한 장만 전송" }],
      }),
      method: "PATCH",
    });
    assert.equal(incomplete.status, 409);
    assert.deepEqual(await incomplete.json(), { error: "asset_manifest_conflict" });

    for (const assetId of [first.assetId, second.assetId]) {
      const portfolioPreview = await request(
        `/studio/api/assets/${assetId}/preview?surface=portfolio`,
      );
      assert.equal(portfolioPreview.status, 200);
      assert.equal(portfolioPreview.headers.get("content-type"), "image/webp");
      assert.equal(portfolioPreview.headers.get("cache-control"), "private, no-store");
      assert.equal(portfolioPreview.headers.get("x-content-type-options"), "nosniff");
      assert.equal(portfolioPreview.headers.get("x-studio-preview-source"), "derivative");
      assert.ok((await portfolioPreview.arrayBuffer()).byteLength > 0);
    }

    const mediaResponse = await request(
      `/studio/api/assets?view=media&q=${encodeURIComponent("Media 검색")}&status=ready`,
    );
    assert.equal(mediaResponse.status, 200);
    const mediaBody = await mediaResponse.json();
    assert.equal(mediaBody.total, 2);
    assert.equal(mediaBody.items.length, 2);
    assert.equal(mediaBody.retention.orphanDays, 7);
    assert.equal(mediaBody.retention.cleanupAvailable, true);
    assert.deepEqual(
      [...mediaBody.items.map(({ assetId }) => assetId)].sort(),
      [first.assetId, second.assetId].sort(),
    );
    assert.ok(mediaBody.items.every((item) =>
      item.currentPostTitle === "Media 검색 fixture" &&
      item.sourceBytes === staticPng.byteLength &&
      item.publicBytes > 0 &&
      item.discordBytes > 0 &&
      item.cleanupEligible === false
    ));

    const invalidDate = await request(
      "/studio/api/assets?view=media&from=2026-02-30",
    );
    assert.equal(invalidDate.status, 400);
    assert.deepEqual(await invalidDate.json(), { error: "invalid_media_filter" });

    const detached = deleteSource(first.assetId, reorderedBody.revision);
    const detachedResponse = await request(detached.pathname, detached.init);
    assert.equal(detachedResponse.status, 200);
    assert.equal((await detachedResponse.json()).revision, 5);
    const orphanedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString();
    database.database.prepare(`
      UPDATE studio_assets SET orphaned_at = ? WHERE id = ?
    `).run(orphanedAt, first.assetId);

    const orphanMedia = await request(
      `/studio/api/assets?view=media&q=${encodeURIComponent("Media 검색")}&status=orphan`,
    );
    assert.equal(orphanMedia.status, 200);
    const orphanBody = await orphanMedia.json();
    assert.equal(orphanBody.total, 1);
    assert.equal(orphanBody.retention.eligibleOrphanCount, 1);
    assert.equal(orphanBody.items[0].assetId, first.assetId);
    assert.equal(orphanBody.items[0].cleanupEligible, true);
    assert.equal(orphanBody.items[0].referenceCount, 0);
    assert.equal(
      orphanBody.retention.nextCleanupAt,
      new Date(Date.parse(orphanedAt) + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    );

    const cleanup = await request(
      "/studio/api/assets/cleanup",
      studioJsonWrite({ assetId: first.assetId }),
    );
    assert.equal(cleanup.status, 202);
    assert.deepEqual(await cleanup.json(), {
      queued: 1,
      queueFailed: 0,
      scanned: 1,
      requestedAssetId: first.assetId,
    });
    const cleanupMessage = queue.messages.shift();
    assert.deepEqual(cleanupMessage, {
      type: "asset_cleanup",
      jobId: cleanupMessage.jobId,
      assetId: first.assetId,
    });
    assert.equal(queue.messages.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("retains orphan sources, then verifies exact cleanup and cache purge", async () => {
  const worker = await loadWorker();
  const database = new SqliteD1();
  const media = new MemoryR2();
  const images = new FakeImages();
  const queue = new MemoryQueue();
  const purgeCalls = [];
  const env = phaseAEnv({
    STUDIO_DB: database,
    STUDIO_MEDIA: media,
    IMAGES: images,
    PUBLISH_QUEUE: queue,
  });
  const keys = await accessKeys();
  const request = studioRequester(
    worker,
    env,
    keys,
    await keys.token(),
    purgeCalls,
  );
  const originalFetch = globalThis.fetch;

  try {
    const draft = await createDraftFixture(request);
    const empty = await request(`/studio/api/assets?postId=${draft.postId}`);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { assets: [], revision: 1 });

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
    assert.equal(first.revision, 2);

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
      sourceUpload(draft.postId, 1, staticPng, {
        alt: "두 번째 이미지",
        revision: 2,
      }),
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

    for (const body of queue.messages.splice(0)) {
      const message = queueMessage(body);
      await worker.queue({ messages: [message] }, env);
      assert.equal(message.acked, true);
    }

    const firstDelete = deleteSource(first.assetId, 3);
    const deleted = await request(firstDelete.pathname, firstDelete.init);
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).revision, 4);
    assert.equal(media.deleteCalls.length, 0);
    const orphan = database.database.prepare(`
      SELECT status, orphaned_at FROM studio_assets WHERE id = ?
    `).get(first.assetId);
    assert.equal(orphan.status, "orphan");
    assert.match(orphan.orphaned_at, /^\d{4}-\d{2}-\d{2}T/u);
    assert.equal(media.objects.has(row.private_source_key), true);
    assert.equal(
      database.database.prepare("SELECT count(*) AS count FROM studio_assets WHERE id = ?")
        .get(first.assetId).count,
      1,
    );
    assert.deepEqual(
      database.database.prepare(`
        SELECT asset_id, ordinal
        FROM studio_post_version_assets
        ORDER BY ordinal
      `).all().map(({ asset_id, ordinal }) => ({ asset_id, ordinal })),
      [{ asset_id: second.assetId, ordinal: 0 }],
    );

    env.ASSET_ORPHAN_RETENTION_DAYS = "0";
    const invalidCleanupConfiguration = await request(
      "/studio/api/assets/cleanup",
      studioJsonWrite({}),
    );
    assert.equal(invalidCleanupConfiguration.status, 503);
    assert.deepEqual(await invalidCleanupConfiguration.json(), {
      error: "asset_cleanup_configuration_invalid",
    });
    assert.equal(queue.messages.length, 0);
    env.ASSET_ORPHAN_RETENTION_DAYS = "7";

    const cachePurgeToken = env.CLOUDFLARE_CACHE_PURGE_TOKEN;
    env.CLOUDFLARE_CACHE_PURGE_TOKEN = "";
    const missingPurgeCredentials = await request(
      "/studio/api/assets/cleanup",
      studioJsonWrite({}),
    );
    assert.equal(missingPurgeCredentials.status, 503);
    assert.deepEqual(await missingPurgeCredentials.json(), {
      error: "asset_cleanup_configuration_invalid",
    });
    assert.equal(queue.messages.length, 0);
    env.CLOUDFLARE_CACHE_PURGE_TOKEN = cachePurgeToken;

    const tooEarly = await request(
      "/studio/api/assets/cleanup",
      studioJsonWrite({}),
    );
    assert.equal(tooEarly.status, 202);
    assert.deepEqual(await tooEarly.json(), { queued: 0, queueFailed: 0, scanned: 0 });

    database.database.prepare(`
      UPDATE studio_assets SET orphaned_at = ? WHERE id = ?
    `).run(new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString(), first.assetId);
    const residualKey = `${row.created_prefix}/private/${first.assetId}/residual.bin`;
    media.objects.set(residualKey, { bytes: new Uint8Array([1]), options: {} });
    const queuedCleanup = await request(
      "/studio/api/assets/cleanup",
      studioJsonWrite({}),
    );
    assert.equal(queuedCleanup.status, 202);
    assert.equal((await queuedCleanup.json()).queued, 1);
    const cleanupBody = queue.messages.shift();
    assert.deepEqual(cleanupBody, {
      type: "asset_cleanup",
      jobId: cleanupBody.jobId,
      assetId: first.assetId,
    });
    const residualAttempt = queueMessage(cleanupBody);
    await worker.queue({ messages: [residualAttempt] }, env);
    assert.equal(residualAttempt.acked, false);
    assert.deepEqual(residualAttempt.retryOptions, { delaySeconds: 5 });
    assert.equal(
      database.database.prepare("SELECT status FROM studio_assets WHERE id = ?")
        .get(first.assetId).status,
      "deleting",
    );
    assert.equal(media.objects.has(residualKey), true);
    assert.equal(purgeCalls.length, 0);

    media.objects.delete(residualKey);
    const residualRetry = queueMessage(cleanupBody, 2);
    await worker.queue({ messages: [residualRetry] }, env);
    assert.equal(residualRetry.acked, true);
    assert.equal(
      database.database.prepare("SELECT count(*) AS count FROM studio_assets WHERE id = ?")
        .get(first.assetId).count,
      0,
    );
    assert.deepEqual(purgeCalls, [
      `https://staging.example/media/${first.assetId}/portfolio-v1.webp`,
    ]);

    const secondDelete = deleteSource(second.assetId, 4);
    const secondOrphaned = await request(secondDelete.pathname, secondDelete.init);
    assert.equal(secondOrphaned.status, 200);
    assert.equal((await secondOrphaned.json()).revision, 5);
    database.database.prepare(`
      UPDATE studio_assets SET orphaned_at = ? WHERE id = ?
    `).run(new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString(), second.assetId);
    const secondCleanup = await request(
      "/studio/api/assets/cleanup",
      studioJsonWrite({}),
    );
    assert.equal(secondCleanup.status, 202);
    const secondCleanupBody = queue.messages.shift();
    media.failDelete = true;
    const failedDelete = queueMessage(secondCleanupBody);
    await worker.queue({ messages: [failedDelete] }, env);
    assert.equal(failedDelete.acked, false);
    assert.equal(
      database.database.prepare("SELECT status FROM studio_assets WHERE id = ?")
        .get(second.assetId).status,
      "deleting",
    );

    media.failDelete = false;
    const retriedDelete = queueMessage(secondCleanupBody, 2);
    await worker.queue({ messages: [retriedDelete] }, env);
    assert.equal(retriedDelete.acked, true);
    assert.equal(
      database.database.prepare("SELECT count(*) AS count FROM studio_assets")
        .get().count,
      0,
    );
    assert.equal(media.deleteCalls.length, 4);
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
    assert.equal(manifest.assets[0].processingError, "asset_storage_failed");
    assert.equal("privateSourceKey" in manifest.assets[0], false);
    assert.equal("sourceSha256" in manifest.assets[0], false);

    const attention = await request("/studio/api/drafts?filter=attention");
    assert.equal(attention.status, 200);
    const attentionList = await attention.json();
    assert.equal(attentionList.items.length, 1);
    assert.equal(attentionList.items[0].postId, draft.postId);
    assert.equal(attentionList.items[0].attentionReason, "asset_failed");
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
    const processing = database.database.prepare(`
      SELECT discord_r2_key FROM studio_assets WHERE id = ?
    `).get(uploaded.assetId);
    media.objects.set(processing.discord_r2_key, {
      bytes: Uint8Array.from(Buffer.from("RIFF-2048x2048-80-WEBP")),
      options: { preexisting: true },
    });

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
      media.objects.get(ready.public_r2_key).options.onlyIf.get("if-none-match"),
      "*",
    );
    assert.deepEqual(media.objects.get(ready.discord_r2_key).options, {
      preexisting: true,
    });
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
  const purgeCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === `${teamDomain}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [keys.publicJwk] });
    }
    if (url === cachePurgeEndpoint) {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), `Bearer ${cachePurgeToken}`);
      const body = JSON.parse(String(init.body));
      purgeCalls.push(body.files[0]);
      return Response.json({ success: true, result: { id: cloudflareZoneId } });
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
    queue.failSend = true;
    await worker.queue({ messages: [createMessage] }, env);
    queue.failSend = false;
    assert.equal(createMessage.acked, true);
    assert.equal(discord.createCalls, 1);
    assert.equal(queue.messages.length, 0);
    const deliveryStatus = await request(
      `/studio/api/publish?postId=${draft.postId}`,
    );
    assert.equal(deliveryStatus.status, 200);
    const failedNotification = (await deliveryStatus.json()).notificationJob;
    assert.equal(failedNotification.status, "queue_failed");
    const retryNotification = await request(
      "/studio/api/publish",
      jsonWrite({
        action: "retry",
        postId: draft.postId,
        jobId: failedNotification.jobId,
      }),
    );
    assert.equal(retryNotification.status, 202);
    const notificationBody = queue.messages.shift();
    assert.deepEqual(notificationBody, {
      type: "notification_send",
      jobId: notificationBody.jobId,
    });
    const notificationMessage = queueMessage(notificationBody);
    await worker.queue({ messages: [notificationMessage] }, env);
    assert.equal(notificationMessage.acked, true);
    assert.equal(discord.notificationCalls, 1);
    assert.deepEqual(discord.notificationPayloads.map(({ content }) => content), [
      `<@&${env.DISCORD_NOTIFY_ROLE_ID}> 새 글이 올라왔어요.\n` +
        `https://discord.com/channels/${env.DISCORD_GUILD_ID}/${discord.threadId}`,
    ]);
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
    assert.match(
      database.database.prepare(`
        SELECT first_published_at FROM studio_assets WHERE id = ?
      `).get(firstAsset.assetId).first_published_at,
      /^\d{4}-\d{2}-\d{2}T/u,
    );

    const detach = deleteSource(firstAsset.assetId, 2);
    const detached = await request(detach.pathname, detach.init);
    assert.equal(detached.status, 200);
    assert.equal((await detached.json()).revision, 3);
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
        revision: 3,
        title: "수정된 Forum fixture",
        body: "attachment와 tag를 모두 교체했습니다.",
        kind: "update",
        topics: ["character", "development"],
      }),
    );
    assert.equal(editedResponse.status, 200);

    const secondUpload = await request(
      "/studio/api/assets",
      sourceUpload(draft.postId, 0, staticPng, {
        alt: "교체 attachment",
        revision: 4,
      }),
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
    const pendingUpdate = database.database.prepare(`
      SELECT status, current_version_id FROM studio_posts WHERE id = ?
    `).get(draft.postId);
    assert.equal(pendingUpdate.status, "publishing");
    assert.equal(pendingUpdate.current_version_id, published.current_version_id);
    const updateBody = queue.messages.shift();
    const publicKey = database.database.prepare(`
      SELECT public_r2_key FROM studio_assets WHERE id = ?
    `).get(secondAsset.assetId).public_r2_key;
    const publicDerivative = media.objects.get(publicKey);
    media.objects.delete(publicKey);
    const missingPublic = queueMessage(updateBody);
    await worker.queue({ messages: [missingPublic] }, env);
    assert.equal(missingPublic.acked, false);
    assert.deepEqual(missingPublic.retryOptions, { delaySeconds: 5 });
    assert.equal(discord.updateCalls, 0);
    assert.equal(
      database.database.prepare(`
        SELECT current_version_id FROM studio_posts WHERE id = ?
      `).get(draft.postId).current_version_id,
      published.current_version_id,
    );

    media.objects.set(publicKey, publicDerivative);
    const updateMessage = queueMessage(updateBody, 2);
    await worker.queue({ messages: [updateMessage] }, env);
    assert.equal(updateMessage.acked, true);
    assert.equal(discord.createCalls, 1);
    assert.equal(discord.updateCalls, 1);
    assert.equal(discord.notificationCalls, 1);
    assert.equal(queue.messages.length, 0);
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

    const retiredAsset = database.database.prepare(`
      SELECT private_source_key, discord_r2_key, public_r2_key
      FROM studio_assets WHERE id = ?
    `).get(firstAsset.assetId);
    database.database.prepare(`
      UPDATE studio_post_versions SET superseded_at = ?, updated_at = ?
      WHERE id = ? AND state = 'superseded'
    `).run(
      new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000).toISOString(),
      new Date().toISOString(),
      published.current_version_id,
    );
    const cleanupResponse = await request(
      "/studio/api/assets/cleanup",
      jsonWrite({}),
    );
    assert.equal(cleanupResponse.status, 202);
    assert.deepEqual(await cleanupResponse.json(), {
      queued: 1,
      queueFailed: 0,
      scanned: 1,
    });
    const cleanupBody = queue.messages.shift();
    assert.deepEqual(cleanupBody, {
      type: "version_cleanup",
      jobId: cleanupBody.jobId,
      versionId: published.current_version_id,
    });
    media.failDelete = true;
    const cleanupMessage = queueMessage(cleanupBody);
    await worker.queue({ messages: [cleanupMessage] }, env);
    assert.equal(cleanupMessage.acked, false);
    assert.deepEqual(cleanupMessage.retryOptions, { delaySeconds: 5 });
    assert.equal(
      database.database.prepare(`
        SELECT count(*) AS count FROM studio_post_versions WHERE id = ?
      `).get(published.current_version_id).count,
      0,
    );
    assert.equal(
      database.database.prepare(`
        SELECT processing_error FROM studio_assets WHERE id = ?
      `).get(firstAsset.assetId).processing_error,
      "asset_delete_failed",
    );
    media.failDelete = false;
    env.VERSION_ROLLBACK_RETENTION_DAYS = "60";
    const extendedRetention = await request(
      "/studio/api/assets/cleanup",
      jsonWrite({}),
    );
    assert.equal(extendedRetention.status, 202);
    assert.deepEqual(await extendedRetention.json(), {
      queued: 0,
      queueFailed: 0,
      scanned: 0,
    });
    assert.equal(media.objects.has(retiredAsset.discord_r2_key), true);
    assert.equal(media.objects.has(retiredAsset.public_r2_key), true);

    env.VERSION_ROLLBACK_RETENTION_DAYS = "30";
    const resumedCleanup = await request(
      "/studio/api/assets/cleanup",
      jsonWrite({}),
    );
    assert.equal(resumedCleanup.status, 202);
    assert.deepEqual(await resumedCleanup.json(), {
      queued: 1,
      queueFailed: 0,
      scanned: 1,
    });
    const resumedBody = queue.messages.shift();
    assert.deepEqual(resumedBody, cleanupBody);
    const resumedMessage = queueMessage(resumedBody, 2);
    await worker.queue({ messages: [resumedMessage] }, env);
    assert.equal(resumedMessage.acked, true);
    const privateArchive = database.database.prepare(`
      SELECT status, first_published_at, processing_error
      FROM studio_assets WHERE id = ?
    `).get(firstAsset.assetId);
    assert.equal(privateArchive.status, "orphan");
    assert.match(privateArchive.first_published_at, /^\d{4}-\d{2}-\d{2}T/u);
    assert.equal(privateArchive.processing_error, null);
    assert.equal(media.objects.has(retiredAsset.private_source_key), true);
    assert.equal(media.objects.has(retiredAsset.discord_r2_key), false);
    assert.equal(media.objects.has(retiredAsset.public_r2_key), false);
    assert.deepEqual(purgeCalls, [
      `https://staging.example/media/${firstAsset.assetId}/portfolio-v1.webp`,
    ]);

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

test("does not replay an outcome-unknown first-publish notification", async () => {
  const worker = await loadWorker();
  const database = new SqliteD1();
  const env = phaseAEnv({
    STUDIO_DB: database,
    STUDIO_MEDIA: new MemoryR2(),
    IMAGES: new FakeImages(),
    PUBLISH_QUEUE: new MemoryQueue(),
  });
  const discord = new FakeDiscordForum(env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => discord.fetch(input, init);
  const postId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    database.database.prepare(`
      INSERT INTO studio_posts (id, status, created_at, updated_at)
      VALUES (?, 'draft', ?, ?)
    `).run(postId, now, now);
    database.database.prepare(`
      INSERT INTO studio_post_versions (
        id, post_id, state, revision, source_hash, title, body_markdown,
        kind, locale, created_at, updated_at, schema_version
      ) VALUES (?, ?, 'published', 0, ?, '알림 fixture', '고정 본문',
        'update', 'ko', ?, ?, 1)
    `).run(versionId, postId, "a".repeat(64), now, now);
    database.database.prepare(`
      UPDATE studio_posts
      SET status = 'published', current_version_id = ?,
        discord_thread_id = ?, discord_starter_message_id = ?
      WHERE id = ?
    `).run(versionId, discord.threadId, discord.starterMessageId, postId);
    database.database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, version_id, target, action, payload_json,
        status, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'notification', 'send', ?, 'queued', 0, ?, ?)
    `).run(
      jobId,
      `notify:${postId}:${versionId}`,
      postId,
      versionId,
      JSON.stringify({ threadId: discord.threadId }),
      now,
      now,
    );

    discord.failNextNotification = "network";
    const first = queueMessage({ type: "notification_send", jobId });
    await worker.queue({ messages: [first] }, env);
    assert.equal(first.acked, true);
    assert.equal(discord.notificationCalls, 1);
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(jobId).status,
      "outcome_unknown",
    );

    const replay = queueMessage({ type: "notification_send", jobId }, 2);
    await worker.queue({ messages: [replay] }, env);
    assert.equal(replay.acked, true);
    assert.equal(discord.notificationCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("rejects draft and asset drift before creating a publish candidate", async () => {
  const worker = await loadWorker();
  const database = new SqliteD1();
  const media = new MemoryR2();
  const queue = new MemoryQueue();
  const env = phaseAEnv({
    STUDIO_DB: database,
    STUDIO_MEDIA: media,
    IMAGES: new FakeImages(),
    PUBLISH_QUEUE: queue,
  });
  const keys = await accessKeys();
  const token = await keys.token();
  const discord = new FakeDiscordForum(env);
  const originalFetch = globalThis.fetch;
  let drift = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === `${teamDomain}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [keys.publicJwk] });
    }
    if (
      url === `https://discord.com/api/v10/channels/${env.DISCORD_FORUM_CHANNEL_ID}` &&
      drift
    ) {
      if (drift.type === "draft") {
        database.database.prepare(`
          UPDATE studio_post_versions
          SET revision = revision + 1, source_hash = ?, title = ?, updated_at = ?
          WHERE post_id = ? AND state = 'draft'
        `).run("a".repeat(64), "경쟁 저장이 반영된 제목", new Date().toISOString(), drift.postId);
      } else {
        database.database.prepare(`
          UPDATE studio_post_version_assets
          SET alt = '경쟁 요청이 바꾼 대체 텍스트'
          WHERE version_id = (
            SELECT draft_version_id FROM studio_posts WHERE id = ?
          )
        `).run(drift.postId);
      }
      drift = null;
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
    const changedDraft = await createDraftFixture(request, "게시 직전 초안");
    drift = { type: "draft", postId: changedDraft.postId };
    const draftConflict = await request(
      "/studio/api/publish",
      studioJsonWrite({ action: "publish", postId: changedDraft.postId }),
    );
    assert.equal(draftConflict.status, 409);
    assert.deepEqual(await draftConflict.json(), { error: "publish_conflict" });
    assert.equal(
      database.database.prepare(`
        SELECT count(*) AS count FROM studio_post_versions
        WHERE post_id = ? AND state = 'candidate'
      `).get(changedDraft.postId).count,
      0,
    );
    assert.equal(
      database.database.prepare("SELECT status FROM studio_posts WHERE id = ?")
        .get(changedDraft.postId).status,
      "draft",
    );

    const changedAsset = await createDraftFixture(request, "게시 직전 자산");
    const upload = await request(
      "/studio/api/assets",
      sourceUpload(changedAsset.postId, 0, staticPng, { alt: "읽은 대체 텍스트" }),
    );
    const uploaded = await upload.json();
    const assetMessage = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [assetMessage] }, env);
    assert.equal(assetMessage.acked, true);

    drift = { type: "asset", postId: changedAsset.postId };
    const assetConflict = await request(
      "/studio/api/publish",
      studioJsonWrite({ action: "publish", postId: changedAsset.postId }),
    );
    assert.equal(assetConflict.status, 409);
    assert.deepEqual(await assetConflict.json(), { error: "publish_conflict" });
    assert.equal(
      database.database.prepare(`
        SELECT count(*) AS count FROM studio_post_versions
        WHERE post_id = ? AND state = 'candidate'
      `).get(changedAsset.postId).count,
      0,
    );
    assert.equal(
      database.database.prepare("SELECT status FROM studio_posts WHERE id = ?")
        .get(changedAsset.postId).status,
      "draft",
    );
    assert.equal(
      database.database.prepare(`
        SELECT count(*) AS count FROM delivery_jobs
        WHERE post_id IN (?, ?) AND target = 'discord'
      `).get(changedDraft.postId, changedAsset.postId).count,
      0,
    );
    assert.deepEqual(queue.messages, []);
    assert.equal(discord.createCalls, 0);
    assert.ok(uploaded.assetId);

    const unchangedDraft = await createDraftFixture(request, "no-change 경쟁 저장");
    const firstPublish = await request(
      "/studio/api/publish",
      studioJsonWrite({ action: "publish", postId: unchangedDraft.postId }),
    );
    assert.equal(firstPublish.status, 202);
    const delivery = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [delivery] }, env);
    assert.equal(delivery.acked, true);
    drift = { type: "draft", postId: unchangedDraft.postId };
    const staleNoChange = await request(
      "/studio/api/publish",
      studioJsonWrite({ action: "publish", postId: unchangedDraft.postId }),
    );
    assert.equal(staleNoChange.status, 409);
    assert.deepEqual(await staleNoChange.json(), { error: "publish_conflict" });
    assert.deepEqual(queue.messages, []);
    assert.equal(discord.createCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("blocks a competing current move while a Discord delivery is active", async () => {
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
  let postId = null;
  let competingVersion = null;
  let currentMoveBlocked = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.href === `${teamDomain}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [keys.publicJwk] });
    }
    const messagePath = `/api/v10/channels/${discord.threadId}/messages/${discord.starterMessageId}`;
    if (
      postId &&
      !competingVersion &&
      url.pathname === messagePath &&
      (!init.method || init.method === "GET")
    ) {
      competingVersion = crypto.randomUUID();
      const changedAt = new Date().toISOString();
      database.database.prepare(`
        INSERT INTO studio_post_versions (
          id, post_id, state, revision, source_hash, title, body_markdown,
          kind, locale, created_at, updated_at, schema_version
        )
        SELECT ?, post_id, 'published', 0, source_hash, title, body_markdown,
          kind, locale, ?, ?, schema_version
        FROM studio_post_versions
        WHERE id = (SELECT draft_version_id FROM studio_posts WHERE id = ?)
      `).run(competingVersion, changedAt, changedAt, postId);
      assert.throws(
        () => database.database.prepare(`
          UPDATE studio_posts
          SET status = 'published', current_version_id = ?, updated_at = ?
          WHERE id = ?
        `).run(
          competingVersion,
          changedAt,
          postId,
        ),
        /current_delivery_conflict/,
      );
      currentMoveBlocked = true;
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
    const draft = await createDraftFixture(request, "stale finalizer");
    postId = draft.postId;
    const prepared = await request(
      "/studio/api/publish",
      studioJsonWrite({ action: "publish", postId }),
    );
    assert.equal(prepared.status, 202);
    const publish = await prepared.json();
    const first = queueMessage(queue.messages.shift(), 1);
    await worker.queue({ messages: [first] }, env);
    assert.equal(first.acked, true);
    assert.equal(first.retryOptions, null);
    assert.equal(currentMoveBlocked, true);
    assert.ok(competingVersion);

    const post = database.database.prepare(`
      SELECT status, current_version_id FROM studio_posts WHERE id = ?
    `).get(postId);
    assert.equal(post.status, "published");
    assert.equal(post.current_version_id, publish.candidateId);
    assert.equal(
      database.database.prepare("SELECT state FROM studio_post_versions WHERE id = ?")
        .get(publish.candidateId).state,
      "published",
    );
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(publish.jobId).status,
      "succeeded",
    );
    assert.equal(
      database.database.prepare("SELECT state FROM studio_post_versions WHERE id = ?")
        .get(competingVersion).state,
      "published",
    );
    assert.equal(discord.createCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("retries a finalizing job without sending the Discord mutation again", async () => {
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
  let discordFetches = 0;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input) === `${teamDomain}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [keys.publicJwk] });
    }
    discordFetches += 1;
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
    const draft = await createDraftFixture(request, "finalization-only retry");
    const prepared = await request(
      "/studio/api/publish",
      studioJsonWrite({ action: "publish", postId: draft.postId }),
    );
    assert.equal(prepared.status, 202);
    const publish = await prepared.json();
    queue.messages.shift();
    const fetchedBeforeRetry = discordFetches;
    database.database.prepare(`
      UPDATE delivery_jobs
      SET status = 'finalizing', delivered_hash = expected_hash,
        remote_id = ?, remote_aux_id = ?, remote_attachment_ids = '[]'
      WHERE id = ?
    `).run(discord.threadId, discord.starterMessageId, publish.jobId);

    const retried = await request(
      "/studio/api/publish",
      studioJsonWrite({
        action: "retry",
        postId: draft.postId,
        jobId: publish.jobId,
      }),
    );
    assert.equal(retried.status, 202);
    assert.equal((await retried.json()).status, "finalizing");
    const retryMessage = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [retryMessage] }, env);
    assert.equal(retryMessage.acked, true);
    assert.equal(retryMessage.retryOptions, null);
    assert.equal(discordFetches, fetchedBeforeRetry);
    assert.equal(discord.createCalls, 0);
    assert.equal(discord.updateCalls, 0);
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(publish.jobId).status,
      "succeeded",
    );
    const post = database.database.prepare(`
      SELECT status, current_version_id FROM studio_posts WHERE id = ?
    `).get(draft.postId);
    assert.equal(post.status, "published");
    assert.equal(post.current_version_id, publish.candidateId);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test("re-enqueues a committed queued outbox after Queue and failure-record writes both fail", async () => {
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
    const draft = await createDraftFixture(request, "queued outbox recovery");
    queue.failSend = true;
    database.failQueueFailureWrite = true;
    const unavailable = await request(
      "/studio/api/publish",
      studioJsonWrite({ action: "publish", postId: draft.postId }),
    );
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { error: "publish_unavailable" });
    const committed = database.database.prepare(`
      SELECT id, status FROM delivery_jobs
      WHERE post_id = ? AND target = 'discord'
    `).get(draft.postId);
    assert.equal(committed.status, "queued");
    assert.equal(
      database.database.prepare("SELECT status FROM studio_posts WHERE id = ?")
        .get(draft.postId).status,
      "publishing",
    );
    assert.deepEqual(queue.messages, []);

    queue.failSend = false;
    database.failQueueFailureWrite = false;
    const retried = await request(
      "/studio/api/publish",
      studioJsonWrite({
        action: "retry",
        postId: draft.postId,
        jobId: committed.id,
      }),
    );
    assert.equal(retried.status, 202);
    assert.equal((await retried.json()).status, "queued");
    const duplicated = await request(
      "/studio/api/publish",
      studioJsonWrite({
        action: "retry",
        postId: draft.postId,
        jobId: committed.id,
      }),
    );
    assert.equal(duplicated.status, 202);
    assert.equal(queue.messages.length, 2);
    database.database.prepare(`
      UPDATE delivery_jobs SET status = 'processing' WHERE id = ?
    `).run(committed.id);
    const overlapping = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [overlapping] }, env);
    assert.equal(overlapping.acked, false);
    assert.deepEqual(overlapping.retryOptions, { delaySeconds: 5 });
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(committed.id).status,
      "processing",
    );
    assert.equal(discord.createCalls, 0);
    database.database.prepare(`
      UPDATE delivery_jobs SET status = 'queued' WHERE id = ?
    `).run(committed.id);
    const message = queueMessage(queue.messages.shift());
    await worker.queue({ messages: [message] }, env);
    assert.equal(message.acked, true);
    assert.equal(message.retryOptions, null);
    assert.equal(
      database.database.prepare("SELECT status FROM delivery_jobs WHERE id = ?")
        .get(committed.id).status,
      "succeeded",
    );
    assert.equal(discord.createCalls, 1);
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
