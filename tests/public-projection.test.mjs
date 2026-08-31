import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrations = Array.from({ length: 8 }, (_, index) => {
  const number = String(index + 1).padStart(4, "0");
  const names = [
    "phase_a_drafts",
    "phase_a_assets",
    "phase_a_delivery",
    "phase_b_canonical_schema",
    "phase_b_taxonomy",
    "phase_b_asset_manifest_cleanup",
    "phase_b_stable_slug",
    "phase_d_curation_revision",
  ];
  return readFileSync(
    new URL(`../migrations/${number}_${names[index]}.sql`, import.meta.url),
    "utf8",
  );
});

const guildId = "100000000000000001";
let workerPromise;

async function loadWorker() {
  workerPromise ??= import(
    new URL(`../dist/server/index.js?public=${Date.now()}`, import.meta.url).href
  ).then(({ default: worker }) => worker);
  return workerPromise;
}

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
    return { results: this.database.prepare(this.query).all(...this.values) };
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    for (const migration of migrations) this.database.exec(migration);
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
  }

  set(key, bytes) {
    const value = Uint8Array.from(bytes);
    const checksum = createHash("sha256").update(value).digest();
    this.objects.set(key, { value, checksum });
  }

  async get(key) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const { value: bytes, checksum } = stored;
    return {
      checksums: {
        sha256: checksum.buffer.slice(
          checksum.byteOffset,
          checksum.byteOffset + checksum.byteLength,
        ),
      },
      key,
      size: bytes.byteLength,
      body: new Blob([bytes]).stream(),
      async arrayBuffer() {
        return bytes.slice().buffer;
      },
    };
  }

  async put() {
    throw new Error("Unexpected public R2 write");
  }

  async delete() {
    throw new Error("Unexpected public R2 delete");
  }

  async list() {
    return { objects: [], truncated: false };
  }
}

function fixture() {
  const database = new SqliteD1();
  const media = new MemoryR2();
  return {
    database,
    media,
    env: {
      STUDIO_DB: database,
      STUDIO_MEDIA: media,
      DISCORD_GUILD_ID: guildId,
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
  };
}

function executionContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

async function request(worker, env, pathname, init = {}) {
  return worker.fetch(
    new Request(`https://about.bluehair.blue${pathname}`, {
      ...init,
      headers: {
        accept: "text/html",
        ...(init.headers ?? {}),
      },
    }),
    env,
    executionContext(),
  );
}

function seedPost(database, media, options = {}) {
  const postId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const slugBase = options.slugBase ?? `post-${postId.slice(0, 4)}`;
  const slug = `${slugBase}--${postId.slice(0, 8)}`;
  const publishedAt = options.publishedAt ?? "2026-08-01T00:00:00.000Z";
  const title = options.title ?? `공개 글 ${postId.slice(0, 4)}`;
  const body = options.body ?? "공개 승인된 한국어 본문입니다.";

  database.database.prepare(`
    INSERT INTO studio_posts (id, slug, status, created_at, updated_at)
    VALUES (?, ?, 'draft', ?, ?)
  `).run(postId, slug, publishedAt, publishedAt);
  database.database.prepare(`
    INSERT INTO studio_post_versions (
      id, post_id, state, revision, source_hash, title, body_markdown,
      kind, locale, created_at, updated_at, schema_version
    ) VALUES (?, ?, 'candidate', 0, ?, ?, ?, ?, 'ko', ?, ?, 1)
  `).run(
    versionId,
    postId,
    "a".repeat(64),
    title,
    body,
    options.kind ?? "update",
    publishedAt,
    publishedAt,
  );

  for (const topic of options.topics ?? []) {
    const taxonomy = database.database.prepare(`
      SELECT id FROM studio_taxonomy
      WHERE dimension = 'topic' AND stable_key = ?
    `).get(topic);
    assert.ok(taxonomy, `Unknown topic fixture: ${topic}`);
    database.database.prepare(`
      INSERT INTO studio_post_version_topics (version_id, taxonomy_id)
      VALUES (?, ?)
    `).run(versionId, taxonomy.id);
  }

  const assets = (options.images ?? []).map((image, ordinal) => {
    const assetId = crypto.randomUUID();
    const createdPrefix = `posts/${postId}`;
    const privateKey = `${createdPrefix}/private/${assetId}/source.png`;
    const discordKey = `${createdPrefix}/private/${assetId}/discord-v1.webp`;
    const publicKey = `${createdPrefix}/public/${assetId}/portfolio-v1.webp`;
    const bytes = Uint8Array.from(image.bytes ?? [82, 73, 70, 70, ordinal + 1]);
    const publicHash = createHash("sha256").update(bytes).digest("hex");
    database.database.prepare(`
      INSERT INTO studio_assets (
        id, post_id, status, created_prefix, title_snapshot, width, height,
        source_mime, source_bytes, source_sha256, private_source_key,
        discord_r2_key, public_r2_key, orphaned_at, created_at, updated_at,
        public_bytes, public_sha256, public_width, public_height,
        discord_bytes, discord_sha256, discord_width, discord_height,
        processing_error, first_published_at
      ) VALUES (
        ?, ?, 'ready', ?, ?, ?, ?, 'image/png', ?, ?, ?, ?, ?, NULL, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?
      )
    `).run(
      assetId,
      postId,
      createdPrefix,
      title.slice(0, 40),
      image.width,
      image.height,
      bytes.byteLength,
      "c".repeat(64),
      privateKey,
      discordKey,
      publicKey,
      publishedAt,
      publishedAt,
      bytes.byteLength,
      publicHash,
      image.width,
      image.height,
      bytes.byteLength,
      "d".repeat(64),
      image.width,
      image.height,
      publishedAt,
    );
    database.database.prepare(`
      INSERT INTO studio_post_version_assets (version_id, asset_id, ordinal, alt)
      VALUES (?, ?, ?, ?)
    `).run(versionId, assetId, ordinal, image.alt ?? `${title} 이미지 ${ordinal + 1}`);
    media.set(publicKey, bytes);
    return { assetId, publicKey, privateKey, discordKey, bytes, publicHash };
  });

  database.database.prepare(`
    UPDATE studio_post_versions SET state = 'published' WHERE id = ?
  `).run(versionId);

  const activeDiscord = options.discord === "active";
  const detachedDiscord = options.discord === "detached";
  const discordIndex = options.discordIndex ?? Number.parseInt(postId.slice(0, 3), 16);
  const threadId = `2${String(discordIndex).padStart(17, "0")}`;
  const starterId = `3${String(discordIndex).padStart(17, "0")}`;
  const status = options.status ?? "published";
  database.database.prepare(`
    UPDATE studio_posts
    SET status = ?, current_version_id = ?, pinned_at = ?, hero_rank = ?,
      discord_thread_id = ?, discord_starter_message_id = ?,
      discord_delivery_state = ?, discord_remote_hash = ?,
      discord_checked_at = ?, archived_at = ?, purged_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    status,
    versionId,
    options.pinned ? publishedAt : null,
    options.heroRank ?? null,
    activeDiscord || detachedDiscord ? threadId : null,
    activeDiscord || detachedDiscord ? starterId : null,
    activeDiscord ? "delivered" : detachedDiscord ? "detached" : null,
    activeDiscord || detachedDiscord ? "e".repeat(64) : null,
    activeDiscord || detachedDiscord ? publishedAt : null,
    status === "archived" ? publishedAt : null,
    status === "purged" ? publishedAt : null,
    publishedAt,
    postId,
  );

  return { postId, versionId, slug, title, threadId, starterId, assets };
}

function feedMarkup(html) {
  const start = html.indexOf('<div class="updates-list"');
  const end = html.indexOf('<p class="updates-footnote"', start);
  assert.ok(start >= 0 && end > start, "Expected the public feed wrapper");
  return html.slice(start, end);
}

function heroMarkup(html) {
  const start = html.indexOf('<aside class="hero-updates"');
  const end = html.indexOf("</aside>", start);
  assert.ok(start >= 0 && end > start, "Expected the Hero update wrapper");
  return html.slice(start, end);
}

test("normalizes unknown, archived, and overflowing public query state", async () => {
  const worker = await loadWorker();
  const { database, media, env } = fixture();
  try {
    for (let index = 1; index <= 12; index += 1) {
      seedPost(database, media, {
        title: `페이지 글 ${String(index).padStart(2, "0")}`,
        slugBase: `page-${index}`,
        publishedAt: `2026-08-${String(index).padStart(2, "0")}T00:00:00.000Z`,
      });
    }
    database.database.prepare(`
      UPDATE studio_taxonomy SET status = 'archived'
      WHERE dimension = 'topic' AND stable_key = 'world'
    `).run();

    const invalid = await request(
      worker,
      env,
      "/?kind=unknown&tag=world&sort=random&page=0&extra=1",
    );
    assert.ok([307, 308].includes(invalid.status));
    assert.equal(invalid.headers.get("location"), "/#now");

    const overflow = await request(worker, env, "/?page=99");
    assert.ok([307, 308].includes(overflow.status));
    assert.equal(overflow.headers.get("location"), "/?page=2#now");
  } finally {
    database.close();
  }
});

test("projects filters, sort, pagination, pin, and Hero from approved D1 rows", async () => {
  const worker = await loadWorker();
  const { database, media, env } = fixture();
  try {
    const seeded = [];
    for (let index = 1; index <= 12; index += 1) {
      seeded.push(seedPost(database, media, {
        title: `피드 글 ${String(index).padStart(2, "0")}`,
        slugBase: `feed-${index}`,
        publishedAt: `2026-08-${String(index).padStart(2, "0")}T00:00:00.000Z`,
        kind: index % 2 === 0 ? "work" : "update",
        topics: index % 3 === 0 ? ["character"] : ["development"],
        heroRank: index === 3 ? 2 : index === 8 ? 1 : null,
      }));
    }
    const pinned = seedPost(database, media, {
      title: "고정 공지",
      slugBase: "pinned",
      publishedAt: "2026-08-20T00:00:00.000Z",
      kind: "work",
      topics: ["character"],
      pinned: true,
      heroRank: 3,
    });
    seedPost(database, media, {
      title: "노출 금지 글",
      slugBase: "hidden",
      status: "withheld",
      heroRank: 0,
    });

    const newestResponse = await request(worker, env, "/");
    assert.equal(newestResponse.status, 200);
    const newestHtml = await newestResponse.text();
    const newestFeed = feedMarkup(newestHtml);
    assert.match(newestFeed, /고정 공지/);
    assert.match(newestFeed, /피드 글 12/);
    assert.doesNotMatch(newestFeed, /피드 글 01/);
    assert.doesNotMatch(newestHtml, /노출 금지 글/);
    assert.ok(newestFeed.indexOf("피드 글 12") < newestFeed.indexOf("피드 글 11"));
    assert.match(newestHtml, /href="\/\?page=2#now"/);

    const oldestResponse = await request(worker, env, "/?sort=oldest");
    assert.equal(oldestResponse.status, 200);
    const oldestFeed = feedMarkup(await oldestResponse.text());
    assert.ok(oldestFeed.indexOf("피드 글 01") < oldestFeed.indexOf("피드 글 02"));

    const filteredResponse = await request(
      worker,
      env,
      "/?kind=work&tag=character",
    );
    assert.equal(filteredResponse.status, 200);
    const filteredFeed = feedMarkup(await filteredResponse.text());
    assert.match(filteredFeed, /고정 공지/);
    assert.match(filteredFeed, /피드 글 06/);
    assert.match(filteredFeed, /피드 글 12/);
    assert.doesNotMatch(filteredFeed, /피드 글 03|피드 글 08/);

    const secondResponse = await request(worker, env, "/?page=2");
    assert.equal(secondResponse.status, 200);
    const secondFeed = feedMarkup(await secondResponse.text());
    assert.doesNotMatch(secondFeed, /고정 공지/);
    assert.match(secondFeed, /피드 글 02/);
    assert.match(secondFeed, /피드 글 01/);

    const hero = heroMarkup(newestHtml);
    assert.ok(hero.indexOf(seeded[7].title) < hero.indexOf(seeded[2].title));
    assert.ok(hero.indexOf(seeded[2].title) < hero.indexOf(pinned.title));
  } finally {
    database.close();
  }
});

test("renders the 0, 1, uniform, and mixed-ratio gallery contracts", async () => {
  const worker = await loadWorker();
  const { database, media, env } = fixture();
  try {
    seedPost(database, media, { title: "이미지 없음", slugBase: "zero" });
    seedPost(database, media, {
      title: "이미지 하나",
      slugBase: "one",
      images: [{ width: 1200, height: 800 }],
    });
    seedPost(database, media, {
      title: "동일 비율 둘",
      slugBase: "uniform",
      images: [
        { width: 1200, height: 800 },
        { width: 900, height: 600 },
      ],
    });
    seedPost(database, media, {
      title: "혼합 비율 셋",
      slugBase: "mixed-three",
      images: [
        { width: 1200, height: 800 },
        { width: 800, height: 1200 },
        { width: 1000, height: 1000 },
      ],
    });
    const mixedFive = seedPost(database, media, {
      title: "혼합 비율 다섯",
      slugBase: "mixed-five",
      images: [
        { width: 1200, height: 800 },
        { width: 800, height: 1200 },
        { width: 1000, height: 1000 },
        { width: 1600, height: 900 },
        { width: 900, height: 1600 },
      ],
    });

    const response = await request(worker, env, "/");
    assert.equal(response.status, 200);
    const html = await response.text();
    const feed = feedMarkup(html);
    assert.match(feed, /post-media-single/);
    assert.match(feed, /post-media-slider/);
    assert.match(feed, /post-media-grid-3/);
    assert.match(feed, /post-media-grid-4/);
    assert.match(feed, />\+(?:<!-- -->)?1</);
    assert.equal((feed.match(/post-media-single/g) ?? []).length, 1);
    assert.match(html, new RegExp(`/media/${mixedFive.assets[0].assetId}/portfolio-v1\\.webp`));
    assert.doesNotMatch(html, /\/private\/|discord-v1\.webp|cdn\.discordapp\.com/);
  } finally {
    database.close();
  }
});

test("renders record metadata and safe Markdown without leaking private media", async () => {
  const worker = await loadWorker();
  const { database, media, env } = fixture();
  try {
    const withImage = seedPost(database, media, {
      title: "기록별 메타데이터",
      slugBase: "기록-메타데이터",
      publishedAt: "2026-08-21T12:30:00.000Z",
      body: "**강조 본문**\n\n[안전한 링크](https://example.com/read)\n\n<script>alert(1)</script>",
      images: [{ width: 1200, height: 630, alt: "메타데이터 대표 이미지" }],
    });
    const withoutImage = seedPost(database, media, {
      title: "이미지 없는 메타데이터",
      slugBase: "metadata-empty",
      body: "이미지 없이 공개되는 상세 설명입니다.",
    });

    const detailPath = `/updates/${encodeURIComponent(withImage.slug)}`;
    const response = await request(worker, env, detailPath);
    assert.equal(response.status, 200);
    const html = await response.text();
    const canonical = `https://about.bluehair.blue${detailPath}`;
    const mediaUrl = `https://about.bluehair.blue/media/${withImage.assets[0].assetId}/portfolio-v1.webp`;
    assert.match(html, /<title>기록별 메타데이터 — 한파란<\/title>/);
    assert.match(html, new RegExp(`rel="canonical" href="${canonical}"`));
    assert.match(html, /<meta name="description" content="강조 본문 안전한 링크 &lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
    assert.match(html, new RegExp(`property="og:image" content="${mediaUrl}"`));
    assert.match(html, /<strong>강조 본문<\/strong>/);
    assert.match(html, /href="https:\/\/example\.com\/read"/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /\/private\/|discord-v1\.webp|cdn\.discordapp\.com/);

    const noImageResponse = await request(
      worker,
      env,
      `/updates/${withoutImage.slug}`,
    );
    assert.equal(noImageResponse.status, 200);
    const noImageHtml = await noImageResponse.text();
    assert.match(noImageHtml, /<meta name="twitter:card" content="summary"/);
    assert.doesNotMatch(noImageHtml, /property="og:image"|name="twitter:image"|\/og\.png/);
  } finally {
    database.close();
  }
});

test("returns lifecycle-safe 404 and 410 responses for non-public slugs", async () => {
  const worker = await loadWorker();
  const { database, media, env } = fixture();
  try {
    const withheld = seedPost(database, media, {
      title: "보류 글",
      slugBase: "withheld",
      status: "withheld",
    });
    const archived = seedPost(database, media, {
      title: "보관 글",
      slugBase: "archived",
      status: "archived",
    });
    const purged = seedPost(database, media, {
      title: "삭제 글",
      slugBase: "purged",
      status: "purged",
    });
    const missingCurrent = seedPost(database, media, {
      title: "현재 승인본 없는 글",
      slugBase: "missing-current",
    });
    database.database.prepare(`
      UPDATE studio_posts SET current_version_id = NULL WHERE id = ?
    `).run(missingCurrent.postId);
    const supersededCurrent = seedPost(database, media, {
      title: "교체된 승인본을 가리키는 글",
      slugBase: "superseded-current",
    });
    database.database.prepare(`
      UPDATE studio_post_versions
      SET state = 'superseded', superseded_at = updated_at
      WHERE id = ?
    `).run(supersededCurrent.versionId);

    for (const slug of [
      withheld.slug,
      archived.slug,
      missingCurrent.slug,
      supersededCurrent.slug,
      "unknown--12345678",
    ]) {
      const response = await request(worker, env, `/updates/${slug}`);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const gone = await request(worker, env, `/updates/${purged.slug}`);
    assert.equal(gone.status, 410);
    assert.equal(await gone.text(), "Gone");
    const head = await request(worker, env, `/updates/${purged.slug}`, {
      method: "HEAD",
    });
    assert.equal(head.status, 410);
    assert.equal(await head.text(), "");
  } finally {
    database.close();
  }
});

test("serves only an approved public derivative without revocation-unsafe caching", async () => {
  const worker = await loadWorker();
  const { database, media, env } = fixture();
  try {
    const post = seedPost(database, media, {
      title: "공개 미디어",
      slugBase: "public-media",
      images: [{ width: 1200, height: 800, bytes: [1, 2, 3, 4, 5] }],
    });
    const asset = post.assets[0];
    const path = `/media/${asset.assetId}/portfolio-v1.webp`;

    const get = await request(worker, env, path, { headers: { accept: "image/webp" } });
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("content-type"), "image/webp");
    assert.equal(get.headers.get("cache-control"), "private, no-store");
    assert.equal(get.headers.get("etag"), `"${asset.publicHash}"`);
    assert.deepEqual(new Uint8Array(await get.arrayBuffer()), asset.bytes);

    const head = await request(worker, env, path, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(asset.bytes.byteLength));
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    const unchanged = await request(worker, env, path, {
      headers: { "if-none-match": `"${asset.publicHash}"` },
    });
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.headers.get("content-length"), null);

    const write = await request(worker, env, path, { method: "POST" });
    assert.equal(write.status, 405);
    assert.equal(write.headers.get("allow"), "GET, HEAD");

    const stored = media.objects.get(asset.publicKey);
    stored.value = Uint8Array.from([5, 4, 3, 2, 1]);
    stored.checksum = createHash("sha256").update(stored.value).digest();
    const corrupted = await request(worker, env, path);
    assert.equal(corrupted.status, 404);

    database.database.prepare(`
      UPDATE studio_posts SET status = 'withheld' WHERE id = ?
    `).run(post.postId);
    const hidden = await request(worker, env, path);
    assert.equal(hidden.status, 404);
  } finally {
    database.close();
  }
});

test("shows Discord CTAs only for active verified mappings", async () => {
  const worker = await loadWorker();
  const { database, media, env } = fixture();
  try {
    const active = seedPost(database, media, {
      title: "활성 댓글 글",
      slugBase: "active-thread",
      discord: "active",
      discordIndex: 1,
    });
    const detached = seedPost(database, media, {
      title: "분리된 댓글 글",
      slugBase: "detached-thread",
      discord: "detached",
      discordIndex: 2,
    });
    const unverified = seedPost(database, media, {
      title: "검증 안 된 댓글 글",
      slugBase: "unverified-thread",
      discordIndex: 3,
    });
    database.database.prepare(`
      UPDATE studio_posts
      SET discord_thread_id = ?, discord_starter_message_id = ?,
        discord_delivery_state = 'delivered', discord_remote_hash = 'invalid',
        discord_checked_at = 'not-a-timestamp'
      WHERE id = ?
    `).run(unverified.threadId, unverified.starterId, unverified.postId);

    const root = await request(worker, env, "/");
    const rootHtml = await root.text();
    assert.match(rootHtml, new RegExp(`https://discord\\.com/channels/${guildId}/${active.threadId}`));
    assert.doesNotMatch(rootHtml, new RegExp(detached.threadId));
    assert.doesNotMatch(rootHtml, new RegExp(unverified.threadId));

    const community = await request(worker, env, "/community");
    assert.equal(community.status, 200);
    const communityHtml = await community.text();
    assert.match(communityHtml, /활성 댓글 글/);
    assert.doesNotMatch(communityHtml, /분리된 댓글 글|검증 안 된 댓글 글/);

    database.database.prepare(`
      UPDATE studio_posts SET discord_delivery_state = 'detached'
      WHERE id = ?
    `).run(active.postId);
    const detachedCommunity = await request(worker, env, "/community");
    const detachedHtml = await detachedCommunity.text();
    assert.doesNotMatch(detachedHtml, /활성 댓글 글/);
    assert.match(detachedHtml, /현재 확인된 Discord 댓글 경로가 없습니다/);
    const detachedRoot = await request(worker, env, "/");
    assert.doesNotMatch(await detachedRoot.text(), new RegExp(active.threadId));
  } finally {
    database.close();
  }
});
