import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationUrls = [
  "../migrations/0001_phase_a_drafts.sql",
  "../migrations/0002_phase_a_assets.sql",
  "../migrations/0003_phase_a_delivery.sql",
  "../migrations/0004_phase_b_canonical_schema.sql",
  "../migrations/0005_phase_b_taxonomy.sql",
  "../migrations/0006_phase_b_asset_manifest_cleanup.sql",
];
const migrations = migrationUrls.map((path) =>
  readFileSync(new URL(path, import.meta.url), "utf8")
);
const now = "2026-08-30T00:00:00.000Z";

function databaseThrough(lastMigration = migrations.length) {
  const database = new DatabaseSync(":memory:");
  for (const migration of migrations.slice(0, lastMigration)) {
    database.exec(migration);
  }
  return database;
}

function insertPost(database, id, slug) {
  database.prepare(`
    INSERT INTO studio_posts (id, slug, status, created_at, updated_at)
    VALUES (?, ?, 'draft', ?, ?)
  `).run(id, slug, now, now);
}

function insertVersion(
  database,
  { id, postId, state = "draft", hash = "a".repeat(64), title = "초안" },
) {
  database.prepare(`
    INSERT INTO studio_post_versions (
      id, post_id, state, revision, source_hash, title, body_markdown,
      kind, locale, created_at, updated_at, schema_version
    ) VALUES (?, ?, ?, 1, ?, ?, '본문', 'update', 'ko', ?, ?, 1)
  `).run(id, postId, state, hash, title, now, now);
}

function insertAsset(database, id, postId) {
  const prefix = `posts/2026/08/30/fixture--${postId}--phase-b`;
  const root = `${prefix}/private/${id}`;
  const hash = "b".repeat(64);
  database.prepare(`
    INSERT INTO studio_assets (
      id, post_id, status, created_prefix, title_snapshot, width, height,
      source_mime, source_bytes, source_sha256, private_source_key,
      discord_r2_key, public_r2_key, orphaned_at, created_at, updated_at,
      public_bytes, public_sha256, public_width, public_height,
      discord_bytes, discord_sha256, discord_width, discord_height,
      processing_error
    ) VALUES (
      ?, ?, 'ready', ?, 'phase-b', 1, 1,
      'image/png', 1, ?, ?, ?, ?, NULL, ?, ?,
      1, ?, 1, 1, 1, ?, 1, 1, NULL
    )
  `).run(
    id,
    postId,
    prefix,
    hash,
    `${root}/source.png`,
    `${root}/discord-v1.webp`,
    `${root.replace("/private/", "/public/")}/portfolio-v1.webp`,
    now,
    now,
    hash,
    hash,
  );
}

function plan(database, query, ...values) {
  return database.prepare(`EXPLAIN QUERY PLAN ${query}`)
    .all(...values)
    .map(({ detail }) => detail)
    .join("\n");
}

function assertLegacyMigrationFails(setup, expected) {
  const database = databaseThrough(3);
  try {
    setup(database);
    assert.throws(() => database.exec(migrations[3]), expected);
  } finally {
    database.close();
  }
}

test("upgrades Phase A rows into the Phase B outbox without data loss", () => {
  const database = databaseThrough(3);
  const postId = "10000000-0000-4000-8000-000000000001";
  const versionId = "20000000-0000-4000-8000-000000000001";
  const assetId = "30000000-0000-4000-8000-000000000001";
  const jobId = "40000000-0000-4000-8000-000000000001";

  try {
    insertPost(database, postId, "phase-a-fixture");
    insertVersion(database, { id: versionId, postId });
    database.prepare(`
      UPDATE studio_posts SET draft_version_id = ? WHERE id = ?
    `).run(versionId, postId);
    insertAsset(database, assetId, postId);
    database.prepare(`
      INSERT INTO studio_post_version_assets (version_id, asset_id, ordinal, alt)
      VALUES (?, ?, 0, 'fixture')
    `).run(versionId, assetId);
    database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, version_id, asset_id, target, action,
        status, attempts, created_at, updated_at
      ) VALUES (?, 'phase-a-fixture', ?, ?, ?, 'asset', 'process',
        'succeeded', 1, ?, ?)
    `).run(jobId, postId, versionId, assetId, now, now);

    database.exec(migrations[3]);

    assert.deepEqual(
      { ...database.prepare(`
        SELECT id, dedupe_key, post_id, version_id, asset_id, target, action,
          status, attempts
        FROM delivery_jobs
      `).get() },
      {
        id: jobId,
        dedupe_key: "phase-a-fixture",
        post_id: postId,
        version_id: versionId,
        asset_id: assetId,
        target: "asset",
        action: "process",
        status: "succeeded",
        attempts: 1,
      },
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);

    database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, version_id, target, action, status,
        created_at, updated_at
      ) VALUES (?, 'phase-b-notification', ?, ?, 'notification', 'send',
        'queued', ?, ?)
    `).run(
      "40000000-0000-4000-8000-000000000002",
      postId,
      versionId,
      now,
      now,
    );
    database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, asset_id, target, action, status,
        created_at, updated_at
      ) VALUES (?, 'phase-b-cache', ?, ?, 'cache', 'purge', 'queued', ?, ?)
    `).run(
      "40000000-0000-4000-8000-000000000003",
      postId,
      assetId,
      now,
      now,
    );
    assert.throws(
      () => database.prepare(`
        INSERT INTO delivery_jobs (
          id, dedupe_key, post_id, target, action, status, created_at, updated_at
        ) VALUES (?, 'invalid-operation', ?, 'cache', 'send', 'queued', ?, ?)
      `).run(
        "40000000-0000-4000-8000-000000000004",
        postId,
        now,
        now,
      ),
      /CHECK constraint failed/,
    );
  } finally {
    database.close();
  }
});

test("rejects legacy Phase A rows that violate canonical ownership or snapshots", () => {
  assertLegacyMigrationFails((database) => {
    const postId = "10000000-0000-4000-8000-000000000021";
    insertPost(database, postId, "uppercase-hash");
    insertVersion(database, {
      id: "20000000-0000-4000-8000-000000000021",
      postId,
      hash: "A".repeat(64),
    });
  }, /source_hash_invalid/);

  assertLegacyMigrationFails((database) => {
    const postId = "10000000-0000-4000-8000-000000000022";
    const versionId = "20000000-0000-4000-8000-000000000022";
    insertPost(database, postId, "kind-as-topic");
    insertVersion(database, { id: versionId, postId });
    const kindId = database.prepare(`
      SELECT id FROM studio_taxonomy
      WHERE dimension = 'kind' AND stable_key = 'update'
    `).get().id;
    database.prepare(`
      INSERT INTO studio_post_version_topics (version_id, taxonomy_id)
      VALUES (?, ?)
    `).run(versionId, kindId);
  }, /legacy_topic_invariant_invalid/);

  assertLegacyMigrationFails((database) => {
    const firstPost = "10000000-0000-4000-8000-000000000023";
    const secondPost = "10000000-0000-4000-8000-000000000024";
    const secondVersion = "20000000-0000-4000-8000-000000000024";
    const assetId = "30000000-0000-4000-8000-000000000023";
    insertPost(database, firstPost, "asset-owner");
    insertPost(database, secondPost, "asset-link");
    insertVersion(database, { id: secondVersion, postId: secondPost });
    insertAsset(database, assetId, firstPost);
    database.prepare(`
      INSERT INTO studio_post_version_assets (version_id, asset_id, ordinal, alt)
      VALUES (?, ?, 0, '교차 연결')
    `).run(secondVersion, assetId);
  }, /legacy_asset_invariant_invalid/);

  assertLegacyMigrationFails((database) => {
    const firstPost = "10000000-0000-4000-8000-000000000025";
    const secondPost = "10000000-0000-4000-8000-000000000026";
    const secondVersion = "20000000-0000-4000-8000-000000000026";
    insertPost(database, firstPost, "job-owner");
    insertPost(database, secondPost, "job-version");
    insertVersion(database, { id: secondVersion, postId: secondPost });
    database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, version_id, target, action, status,
        created_at, updated_at
      ) VALUES (?, 'cross-post-job', ?, ?, 'discord', 'create', 'queued', ?, ?)
    `).run(
      "40000000-0000-4000-8000-000000000025",
      firstPost,
      secondVersion,
      now,
      now,
    );
  }, /legacy_delivery_invariant_invalid/);

  assertLegacyMigrationFails((database) => {
    const postId = "10000000-0000-4000-8000-000000000027";
    const versionId = "20000000-0000-4000-8000-000000000027";
    insertPost(database, postId, "inflight-discord-job");
    insertVersion(database, { id: versionId, postId, state: "candidate" });
    database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, version_id, target, action, payload_json,
        status, expected_hash, created_at, updated_at
      ) VALUES (?, 'inflight-discord-job', ?, ?, 'discord', 'create', ?,
        'queued', ?, ?, ?)
    `).run(
      "40000000-0000-4000-8000-000000000027",
      postId,
      versionId,
      JSON.stringify({ tagIds: [] }),
      "f".repeat(64),
      now,
      now,
    );
  }, /legacy_delivery_invariant_invalid/);
});

test("keeps the seven-table contract and uses the documented query indexes", () => {
  const database = databaseThrough();

  try {
    const tables = database.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map(({ name }) => name);
    assert.deepEqual(tables, [
      "delivery_jobs",
      "studio_assets",
      "studio_post_version_assets",
      "studio_post_version_topics",
      "studio_post_versions",
      "studio_posts",
      "studio_taxonomy",
    ]);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      database.prepare(`
        SELECT count(*) AS count
        FROM sqlite_schema
        WHERE sql LIKE '%delivery_jobs_asset_previous%'
      `).get().count,
      0,
    );

    assert.match(
      plan(
        database,
        "SELECT id FROM studio_posts WHERE status = ? ORDER BY updated_at DESC",
        "draft",
      ),
      /idx_studio_posts_status_updated_at/,
    );
    assert.match(
      plan(
        database,
        "SELECT id FROM studio_post_versions WHERE post_id = ? AND state = ? ORDER BY updated_at DESC, id",
        "post",
        "published",
      ),
      /idx_studio_post_versions_post_state_updated_at/,
    );
    assert.match(
      plan(
        database,
        "SELECT id FROM studio_post_versions WHERE state = 'superseded' AND superseded_at <= ? ORDER BY superseded_at, id",
        now,
      ),
      /idx_studio_post_versions_superseded_at/,
    );
    assert.match(
      plan(
        database,
        "SELECT id FROM studio_assets WHERE status = 'orphan' AND orphaned_at < ? ORDER BY orphaned_at, id",
        now,
      ),
      /idx_studio_assets_status_orphaned_at/,
    );
    assert.match(
      plan(
        database,
        "SELECT version_id FROM studio_post_version_assets WHERE asset_id = ?",
        "asset",
      ),
      /idx_studio_post_version_assets_asset_version/,
    );
    assert.match(
      plan(
        database,
        "SELECT id FROM delivery_jobs WHERE asset_id = ? ORDER BY created_at DESC, id",
        "asset",
      ),
      /idx_delivery_jobs_asset_created_at/,
    );
    assert.match(
      plan(
        database,
        "SELECT id FROM delivery_jobs WHERE post_id = ? AND target = ? ORDER BY created_at DESC, id",
        "post",
        "discord",
      ),
      /idx_delivery_jobs_post_target_created_at/,
    );
  } finally {
    database.close();
  }
});

test("protects taxonomy identity and serializes one global Discord sync", () => {
  const database = databaseThrough();
  const topicId = "50000000-0000-4000-8000-000000000001";
  const unusedTopicId = "50000000-0000-4000-8000-000000000002";
  const firstJobId = "40000000-0000-4000-8000-000000000021";
  const secondJobId = "40000000-0000-4000-8000-000000000022";
  const postId = "10000000-0000-4000-8000-000000000021";
  const versionId = "20000000-0000-4000-8000-000000000021";

  try {
    assert.deepEqual(
      database.prepare(`
        SELECT dimension, stable_key, label, status, ordinal
        FROM studio_taxonomy
        ORDER BY CASE dimension WHEN 'kind' THEN 0 ELSE 1 END, ordinal
      `).all().map((row) => ({ ...row })),
      [
        { dimension: "kind", stable_key: "update", label: "업데이트", status: "active", ordinal: 0 },
        { dimension: "kind", stable_key: "work", label: "작업", status: "active", ordinal: 1 },
        { dimension: "topic", stable_key: "character", label: "캐릭터", status: "active", ordinal: 0 },
        { dimension: "topic", stable_key: "world", label: "세계관", status: "active", ordinal: 1 },
        { dimension: "topic", stable_key: "illustration", label: "일러스트", status: "active", ordinal: 2 },
        { dimension: "topic", stable_key: "development", label: "개발", status: "active", ordinal: 3 },
      ],
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_taxonomy SET stable_key = 'changed' WHERE stable_key = 'character'
      `).run(),
      /taxonomy_identity_immutable/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_taxonomy SET dimension = 'kind' WHERE stable_key = 'character'
      `).run(),
      /taxonomy_identity_immutable/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_taxonomy SET status = 'archived' WHERE stable_key = 'update'
      `).run(),
      /taxonomy_kind_migration_required/,
    );
    assert.throws(
      () => database.prepare("DELETE FROM studio_taxonomy WHERE stable_key = 'work'").run(),
      /taxonomy_kind_migration_required/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_taxonomy SET label = '캐릭터' WHERE stable_key = 'world'
      `).run(),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_taxonomy SET discord_tag_id = 'bad' WHERE stable_key = 'world'
      `).run(),
      /taxonomy_discord_tag_invalid/,
    );

    database.prepare(`
      INSERT INTO studio_taxonomy (
        id, dimension, stable_key, label, status, ordinal, created_at, updated_at
      ) VALUES (?, 'topic', 'music', '음악', 'active', 4, ?, ?)
    `).run(topicId, now, now);
    database.prepare(`
      INSERT INTO studio_taxonomy (
        id, dimension, stable_key, label, status, ordinal, created_at, updated_at
      ) VALUES (?, 'topic', 'unused', '미사용', 'active', 5, ?, ?)
    `).run(unusedTopicId, now, now);
    database.prepare("DELETE FROM studio_taxonomy WHERE id = ?").run(unusedTopicId);

    insertPost(database, postId, "taxonomy-fixture");
    insertVersion(database, { id: versionId, postId });
    database.prepare("UPDATE studio_posts SET draft_version_id = ? WHERE id = ?")
      .run(versionId, postId);
    database.prepare(`
      INSERT INTO studio_post_version_topics (version_id, taxonomy_id)
      VALUES (?, ?)
    `).run(versionId, topicId);
    assert.throws(
      () => database.prepare("DELETE FROM studio_taxonomy WHERE id = ?").run(topicId),
      /FOREIGN KEY constraint failed/,
    );

    database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, target, action, payload_json, status,
        created_at, updated_at
      ) VALUES (?, 'taxonomy-one', 'discord', 'taxonomy', '{}', 'queued', ?, ?)
    `).run(firstJobId, now, now);
    assert.throws(
      () => database.prepare(`
        INSERT INTO delivery_jobs (
          id, dedupe_key, target, action, payload_json, status,
          created_at, updated_at
        ) VALUES (?, 'taxonomy-two', 'discord', 'taxonomy', '{}', 'queued', ?, ?)
      `).run(secondJobId, now, now),
      /UNIQUE constraint failed/,
    );
    database.prepare("UPDATE delivery_jobs SET status = 'succeeded' WHERE id = ?")
      .run(firstJobId);
    database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, target, action, payload_json, status,
        created_at, updated_at
      ) VALUES (?, 'taxonomy-two', 'discord', 'taxonomy', '{}', 'queued', ?, ?)
    `).run(secondJobId, now, now);
    assert.throws(
      () => database.prepare(`
        INSERT INTO delivery_jobs (
          id, dedupe_key, target, action, status, created_at, updated_at
        ) VALUES (?, 'owner-required', 'discord', 'create', 'queued', ?, ?)
      `).run("40000000-0000-4000-8000-000000000023", now, now),
      /CHECK constraint failed/,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("protects canonical asset identity, readiness, and orphan lifecycle", () => {
  const database = databaseThrough();
  const postId = "10000000-0000-4000-8000-000000000051";
  const assetId = "30000000-0000-4000-8000-000000000051";
  try {
    insertPost(database, postId, "asset-manifest");
    insertAsset(database, assetId, postId);

    assert.throws(
      () => database.prepare(`
        UPDATE studio_assets SET source_sha256 = ? WHERE id = ?
      `).run("c".repeat(64), assetId),
      /asset_identity_immutable/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_assets SET status = 'orphan' WHERE id = ?
      `).run(assetId),
      /asset_state_invalid/,
    );
    database.prepare(`
      UPDATE studio_assets
      SET status = 'orphan', orphaned_at = ? WHERE id = ?
    `).run(now, assetId);

    const draftId = "20000000-0000-4000-8000-000000000051";
    insertVersion(database, { id: draftId, postId });
    assert.throws(
      () => database.prepare(`
        INSERT INTO studio_post_version_assets (version_id, asset_id, ordinal, alt)
        VALUES (?, ?, 0, 'orphan')
      `).run(draftId, assetId),
      /asset_not_attachable/,
    );

    database.prepare(`
      UPDATE studio_assets SET first_published_at = ? WHERE id = ?
    `).run(now, assetId);
    assert.throws(
      () => database.prepare(`
        UPDATE studio_assets SET first_published_at = NULL WHERE id = ?
      `).run(assetId),
      /asset_first_published_immutable/,
    );

    const invalidId = "30000000-0000-4000-8000-000000000052";
    const invalidPrefix = `posts/2026/08/30/fixture--${postId}--invalid`;
    assert.throws(
      () => database.prepare(`
        INSERT INTO studio_assets (
          id, post_id, status, created_prefix, title_snapshot, width, height,
          source_mime, source_bytes, source_sha256, private_source_key,
          discord_r2_key, public_r2_key, created_at, updated_at
        ) VALUES (?, ?, 'ready', ?, 'invalid', 1, 1, 'image/png', 1, ?, ?, ?, ?, ?, ?)
      `).run(
        invalidId,
        postId,
        invalidPrefix,
        "d".repeat(64),
        `${invalidPrefix}/private/${invalidId}/source.png`,
        `${invalidPrefix}/private/${invalidId}/discord-v1.webp`,
        `${invalidPrefix}/public/${invalidId}/portfolio-v1.webp`,
        now,
        now,
      ),
      /asset_state_invalid/,
    );

    const publishedPostId = "10000000-0000-4000-8000-000000000052";
    const publishedId = "20000000-0000-4000-8000-000000000052";
    const processingId = "30000000-0000-4000-8000-000000000053";
    const processingPrefix = `posts/2026/08/30/fixture--${publishedPostId}--processing`;
    insertPost(database, publishedPostId, "asset-current-manifest");
    insertVersion(database, {
      id: publishedId,
      postId: publishedPostId,
      state: "candidate",
    });
    database.prepare(`
      INSERT INTO studio_assets (
        id, post_id, status, created_prefix, title_snapshot, width, height,
        source_mime, source_bytes, source_sha256, private_source_key,
        discord_r2_key, public_r2_key, first_published_at, created_at, updated_at
      ) VALUES (?, ?, 'processing', ?, 'processing', 1, 1, 'image/png', 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      processingId,
      publishedPostId,
      processingPrefix,
      "e".repeat(64),
      `${processingPrefix}/private/${processingId}/source.png`,
      `${processingPrefix}/private/${processingId}/discord-v1.webp`,
      `${processingPrefix}/public/${processingId}/portfolio-v1.webp`,
      now,
      now,
      now,
    );
    database.prepare(`
      INSERT INTO studio_post_version_assets (version_id, asset_id, ordinal, alt)
      VALUES (?, ?, 0, 'processing')
    `).run(publishedId, processingId);
    database.prepare(`
      UPDATE studio_post_versions SET state = 'published' WHERE id = ?
    `).run(publishedId);
    assert.throws(
      () => database.prepare(`
        UPDATE studio_posts SET status = 'published', current_version_id = ?
        WHERE id = ?
      `).run(publishedId, publishedPostId),
      /current_asset_manifest_invalid/,
    );

    const cleanupPostId = "10000000-0000-4000-8000-000000000053";
    const cleanupVersionId = "20000000-0000-4000-8000-000000000053";
    const cleanupAssetId = "30000000-0000-4000-8000-000000000054";
    const cleanupJobId = "40000000-0000-4000-8000-000000000053";
    insertPost(database, cleanupPostId, "asset-version-cleanup");
    insertVersion(database, {
      id: cleanupVersionId,
      postId: cleanupPostId,
      state: "candidate",
    });
    insertAsset(database, cleanupAssetId, cleanupPostId);
    database.prepare(`
      INSERT INTO studio_post_version_assets (version_id, asset_id, ordinal, alt)
      VALUES (?, ?, 0, 'retained source')
    `).run(cleanupVersionId, cleanupAssetId);
    database.prepare(`
      UPDATE studio_post_versions
      SET state = 'published' WHERE id = ?
    `).run(cleanupVersionId);
    database.prepare(`
      UPDATE studio_assets SET first_published_at = ? WHERE id = ?
    `).run(now, cleanupAssetId);
    database.prepare(`
      UPDATE studio_post_versions
      SET state = 'superseded', superseded_at = ? WHERE id = ?
    `).run(now, cleanupVersionId);
    assert.throws(
      () => database.prepare("DELETE FROM studio_post_versions WHERE id = ?")
        .run(cleanupVersionId),
      /approved_version_delete_invalid/,
    );
    database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, target, action, payload_json,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, 'version', 'cleanup', ?, 'processing', ?, ?)
    `).run(
      cleanupJobId,
      `version:${cleanupVersionId}:cleanup:${now}`,
      cleanupPostId,
      JSON.stringify({
        versionId: cleanupVersionId,
        supersededAt: now,
        assetIds: [cleanupAssetId],
      }),
      now,
      now,
    );
    database.prepare("DELETE FROM studio_post_versions WHERE id = ?")
      .run(cleanupVersionId);
    assert.equal(
      database.prepare("SELECT count(*) AS count FROM delivery_jobs WHERE id = ?")
        .get(cleanupJobId).count,
      1,
    );
  } finally {
    database.close();
  }
});

test("enforces canonical pointers, snapshots, taxonomy, pin, and hash invariants", () => {
  const database = databaseThrough();
  const firstPost = "10000000-0000-4000-8000-000000000011";
  const secondPost = "10000000-0000-4000-8000-000000000012";
  const firstDraft = "20000000-0000-4000-8000-000000000011";
  const secondDraft = "20000000-0000-4000-8000-000000000012";
  const approved = "20000000-0000-4000-8000-000000000013";
  const assetId = "30000000-0000-4000-8000-000000000011";

  try {
    insertPost(database, firstPost, "first");
    insertPost(database, secondPost, "second");
    insertVersion(database, { id: firstDraft, postId: firstPost });
    insertVersion(database, { id: secondDraft, postId: secondPost });
    database.prepare("UPDATE studio_posts SET draft_version_id = ? WHERE id = ?")
      .run(firstDraft, firstPost);
    database.prepare("UPDATE studio_posts SET draft_version_id = ? WHERE id = ?")
      .run(secondDraft, secondPost);

    assert.throws(
      () => insertVersion(database, {
        id: "20000000-0000-4000-8000-000000000015",
        postId: firstPost,
      }),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () => database.prepare("UPDATE studio_posts SET draft_version_id = ? WHERE id = ?")
        .run(secondDraft, firstPost),
      /draft_pointer_invalid/,
    );
    assert.throws(
      () => insertVersion(database, {
        id: "20000000-0000-4000-8000-000000000014",
        postId: firstPost,
        hash: "A".repeat(64),
      }),
      /source_hash_invalid/,
    );

    insertVersion(database, {
      id: approved,
      postId: firstPost,
      state: "candidate",
      hash: "c".repeat(64),
      title: "승인본",
    });
    assert.throws(
      () => insertVersion(database, {
        id: "20000000-0000-4000-8000-000000000016",
        postId: firstPost,
        state: "candidate",
        hash: "d".repeat(64),
      }),
      /UNIQUE constraint failed/,
    );
    insertAsset(database, assetId, firstPost);
    const topicId = database.prepare(`
      SELECT id FROM studio_taxonomy
      WHERE dimension = 'topic' AND stable_key = 'character'
    `).get().id;
    const kindId = database.prepare(`
      SELECT id FROM studio_taxonomy
      WHERE dimension = 'kind' AND stable_key = 'update'
    `).get().id;
    database.prepare(`
      INSERT INTO studio_post_version_topics (version_id, taxonomy_id)
      VALUES (?, ?)
    `).run(approved, topicId);
    database.prepare(`
      INSERT INTO studio_post_version_assets (version_id, asset_id, ordinal, alt)
      VALUES (?, ?, 0, '승인 이미지')
    `).run(approved, assetId);
    const candidateJob = "40000000-0000-4000-8000-000000000014";
    database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, version_id, target, action, payload_json,
        status, expected_hash, created_at, updated_at
      ) VALUES (?, 'candidate-snapshot', ?, ?, 'discord', 'create', ?,
        'queued', ?, ?, ?)
    `).run(
      candidateJob,
      firstPost,
      approved,
      JSON.stringify({ tagIds: [], assets: [], previousVersionId: null }),
      "c".repeat(64),
      now,
      now,
    );
    assert.throws(
      () => database.prepare("UPDATE studio_post_versions SET title = '후보 변조' WHERE id = ?")
        .run(approved),
      /approved_version_immutable/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_post_versions SET state = 'draft', superseded_at = ? WHERE id = ?
      `).run(now, approved),
      /candidate_state_invalid/,
    );
    assert.throws(
      () => database.prepare(`
        DELETE FROM studio_post_version_topics WHERE version_id = ? AND taxonomy_id = ?
      `).run(approved, topicId),
      /approved_topics_immutable/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_post_version_assets SET alt = '후보 변조' WHERE version_id = ?
      `).run(approved),
      /approved_assets_immutable/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_assets SET discord_bytes = 2 WHERE id = ?
      `).run(assetId),
      /approved_asset_manifest_immutable/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE delivery_jobs SET payload_json = '{"changed":true}' WHERE id = ?
      `).run(candidateJob),
      /delivery_identity_immutable/,
    );
    assert.throws(
      () => database.prepare("DELETE FROM delivery_jobs WHERE id = ?")
        .run(candidateJob),
      /candidate_job_delete_invalid/,
    );
    assert.throws(
      () => database.prepare("DELETE FROM studio_post_versions WHERE id = ?")
        .run(approved),
      /candidate_version_delete_invalid/,
    );
    assert.throws(
      () => database.prepare("DELETE FROM studio_posts WHERE id = ?")
        .run(firstPost),
      /active_post_delete_invalid/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_post_versions SET state = 'published' WHERE id = ?
      `).run(approved),
      /candidate_state_invalid/,
    );
    const competingApproved = "20000000-0000-4000-8000-000000000018";
    insertVersion(database, {
      id: competingApproved,
      postId: firstPost,
      state: "published",
      hash: "f".repeat(64),
      title: "경쟁 승인본",
    });
    assert.throws(
      () => database.prepare(`
        UPDATE studio_posts SET current_version_id = ?, status = 'published' WHERE id = ?
      `).run(competingApproved, firstPost),
      /current_delivery_conflict/,
    );
    database.prepare(`
      UPDATE delivery_jobs
      SET status = 'finalizing', delivered_hash = expected_hash
      WHERE id = ?
    `).run(candidateJob);
    database.prepare(`
      UPDATE studio_post_versions SET state = 'published' WHERE id = ?
    `).run(approved);
    database.prepare(`
      UPDATE studio_assets SET first_published_at = ? WHERE id = ?
    `).run(now, assetId);
    database.prepare(`
      UPDATE studio_posts SET current_version_id = ?, status = 'published' WHERE id = ?
    `).run(approved, firstPost);

    assert.throws(
      () => database.prepare("UPDATE studio_post_versions SET title = '변조' WHERE id = ?")
        .run(approved),
      /approved_version_immutable/,
    );
    assert.throws(
      () => database.prepare(`
        DELETE FROM studio_post_version_topics WHERE version_id = ? AND taxonomy_id = ?
      `).run(approved, topicId),
      /approved_topics_immutable/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_post_version_assets SET alt = '변조' WHERE version_id = ?
      `).run(approved),
      /approved_assets_immutable/,
    );
    assert.throws(
      () => database.prepare(`
        INSERT INTO studio_post_version_topics (version_id, taxonomy_id)
        VALUES (?, ?)
      `).run(secondDraft, kindId),
      /topic_taxonomy_required/,
    );
    assert.throws(
      () => database.prepare(`
        INSERT INTO studio_post_version_assets (version_id, asset_id, ordinal, alt)
        VALUES (?, ?, 0, '다른 글 이미지')
      `).run(secondDraft, assetId),
      /asset_post_mismatch/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_post_versions SET post_id = ? WHERE id = ?
      `).run(firstPost, secondDraft),
      /version_post_immutable/,
    );
    assert.throws(
      () => database.prepare(`
        UPDATE studio_assets SET post_id = ? WHERE id = ?
      `).run(secondPost, assetId),
      /asset_identity_immutable/,
    );
    assert.throws(
      () => database.prepare("UPDATE studio_posts SET current_version_id = ? WHERE id = ?")
        .run(approved, secondPost),
      /current_pointer_invalid/,
    );

    const historic = "20000000-0000-4000-8000-000000000017";
    insertVersion(database, {
      id: historic,
      postId: firstPost,
      state: "superseded",
      hash: "e".repeat(64),
      title: "이전 승인본",
    });
    assert.throws(
      () => database.prepare(`
        UPDATE studio_post_versions SET state = 'candidate' WHERE id = ?
      `).run(historic),
      /approved_state_invalid/,
    );

    database.prepare("UPDATE studio_posts SET pinned_at = ? WHERE id = ?")
      .run(now, firstPost);
    assert.throws(
      () => database.prepare("UPDATE studio_posts SET pinned_at = ? WHERE id = ?")
        .run(now, secondPost),
      /UNIQUE constraint failed/,
    );
    database.prepare("UPDATE studio_posts SET hero_rank = 0 WHERE id = ?")
      .run(firstPost);
    assert.throws(
      () => database.prepare("UPDATE studio_posts SET hero_rank = 0 WHERE id = ?")
        .run(secondPost),
      /UNIQUE constraint failed/,
    );

    assert.throws(
      () => database.prepare(`
        INSERT INTO delivery_jobs (
          id, dedupe_key, post_id, version_id, target, action, status,
          created_at, updated_at
        ) VALUES (?, 'cross-post-version', ?, ?, 'discord', 'update', 'queued', ?, ?)
      `).run(
        "40000000-0000-4000-8000-000000000012",
        firstPost,
        secondDraft,
        now,
        now,
      ),
      /delivery_post_mismatch/,
    );
    assert.throws(
      () => database.prepare(`
        INSERT INTO delivery_jobs (
          id, dedupe_key, post_id, asset_id, target, action, status,
          created_at, updated_at
        ) VALUES (?, 'cross-post-asset', ?, ?, 'cache', 'purge', 'queued', ?, ?)
      `).run(
        "40000000-0000-4000-8000-000000000013",
        secondPost,
        assetId,
        now,
        now,
      ),
      /delivery_post_mismatch/,
    );

    assert.throws(
      () => database.prepare(`
        INSERT INTO delivery_jobs (
          id, dedupe_key, post_id, version_id, target, action, status,
          expected_hash, created_at, updated_at
        ) VALUES (?, 'uppercase-hash', ?, ?, 'discord', 'update', 'queued', ?, ?, ?)
      `).run(
        "40000000-0000-4000-8000-000000000011",
        firstPost,
        approved,
        "D".repeat(64),
        now,
        now,
      ),
      /delivery_hash_invalid/,
    );
  } finally {
    database.close();
  }
});
