import {
  draftSchemaVersion,
  type DraftKind,
  type TaxonomyDimension,
} from "../db/schema";
import type { StudioD1, StudioD1Statement } from "./phase-a-env";

export type StudioDraftContent = {
  title: string;
  body: string;
  kind: DraftKind;
  topics: string[];
};

type DraftWriteResult = {
  postId: string;
  versionId: string;
  revision: number;
  savedAt: string;
};

export type DraftSaveResult =
  | ({ outcome: "saved" } & DraftWriteResult)
  | { outcome: "not_found" }
  | { outcome: "revision_conflict"; currentRevision: number | null };

export type PublishCandidateAsset = {
  id: string;
  ordinal: number;
  alt: string;
  publicR2Key: string;
  publicBytes: number;
  publicSha256: string;
  discordR2Key: string;
  discordBytes: number;
  discordSha256: string;
};

export type PublishCandidateInput = {
  postId: string;
  title: string;
  draftVersionId: string;
  expectedRevision: number;
  expectedSourceHash: string;
  previousVersionId: string | null;
  postStatus: "draft" | "published";
  action: "create" | "update";
  expectedHash: string;
  tagIds: string[];
  topicIds: string[];
  assets: PublishCandidateAsset[];
  threadId: string | null;
  starterMessageId: string | null;
  createdAt: string;
};

export type PublishCandidateResult = {
  candidateId: string;
  jobId: string;
};

export type ArchiveInput = {
  postId: string;
  currentVersionId: string;
  threadId: string;
  starterMessageId: string;
  createdAt: string;
};

export type RestoreInput = {
  postId: string;
  currentVersionId: string;
  archivedThreadId: string;
  archivedStarterMessageId: string;
  archivedAt: string;
  expectedHash: string;
  tagIds: string[];
  assets: PublishCandidateAsset[];
  createdAt: string;
};

export type DeliveryFinalization =
  | {
      kind: "publish";
      jobId: string;
      postId: string;
      candidateVersionId: string;
      previousVersionId: string | null;
      action: "create" | "update";
      remoteThreadId: string;
      remoteStarterMessageId: string;
      expectedHash: string;
      completedAt: string;
    }
  | {
      kind: "archive";
      jobId: string;
      postId: string;
      currentVersionId: string;
      remoteThreadId: string;
      remoteStarterMessageId: string;
      completedAt: string;
    }
  | {
      kind: "restore";
      jobId: string;
      postId: string;
      currentVersionId: string;
      archivedThreadId: string;
      archivedStarterMessageId: string;
      remoteThreadId: string;
      remoteStarterMessageId: string;
      expectedHash: string;
      completedAt: string;
    };

async function draftHash(content: StudioDraftContent) {
  const source = JSON.stringify({
    title: content.title,
    body: content.body,
    kind: content.kind,
    topics: content.topics,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function stablePostSlug(title: string, postId: string) {
  const titleSlug = title
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Mark}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return `${titleSlug || "post"}--${postId.slice(0, 8).toLowerCase()}`;
}

function activeTopicInsert(
  database: StudioD1,
  versionId: string,
  topic: string,
  condition?: { postId: string; revision: number; sourceHash: string },
  retainArchived = false,
) {
  if (!condition) {
    return database.prepare(`
      INSERT INTO studio_post_version_topics (version_id, taxonomy_id)
      VALUES (?, (
        SELECT id
        FROM studio_taxonomy
        WHERE dimension = 'topic' AND stable_key = ? AND status = 'active'
      ))
    `).bind(versionId, topic);
  }

  return database.prepare(`
    INSERT INTO studio_post_version_topics (version_id, taxonomy_id)
    SELECT ?, (
      SELECT id
      FROM studio_taxonomy
      WHERE dimension = 'topic' AND stable_key = ?
        AND (status = 'active' OR (status = 'archived' AND ? = 1))
    )
    WHERE EXISTS (
      SELECT 1
      FROM studio_post_versions
      WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
        AND source_hash = ?
    )
  `).bind(
    versionId,
    topic,
    retainArchived ? 1 : 0,
    versionId,
    condition.postId,
    condition.revision,
    condition.sourceHash,
  );
}

export async function createDraftRecord(
  database: StudioD1,
  content: StudioDraftContent,
  savedAt: string,
): Promise<DraftWriteResult> {
  const postId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const sourceHash = await draftHash(content);
  const statements = [
    database.prepare(`
      INSERT INTO studio_posts (id, status, created_at, updated_at)
      VALUES (?, 'draft', ?, ?)
    `).bind(postId, savedAt, savedAt),
    database.prepare(`
      INSERT INTO studio_post_versions (
        id, post_id, state, revision, source_hash, title, body_markdown,
        kind, locale, created_at, updated_at, schema_version
      ) VALUES (?, ?, 'draft', 1, ?, ?, ?, ?, 'ko', ?, ?, ?)
    `).bind(
      versionId,
      postId,
      sourceHash,
      content.title,
      content.body,
      content.kind,
      savedAt,
      savedAt,
      draftSchemaVersion,
    ),
    ...content.topics.map((topic) =>
      activeTopicInsert(database, versionId, topic)
    ),
    database.prepare(`
      UPDATE studio_posts
      SET draft_version_id = ?
      WHERE id = ? AND draft_version_id IS NULL
    `).bind(versionId, postId),
  ];
  const results = await database.batch(statements);
  if (
    results[0]?.meta?.changes !== 1 ||
    results[1]?.meta?.changes !== 1 ||
    results.at(-1)?.meta?.changes !== 1
  ) {
    throw new Error("draft_create_failed");
  }
  return { postId, versionId, revision: 1, savedAt };
}

export async function saveDraftRevisionCas(
  database: StudioD1,
  postId: string,
  expectedRevision: number,
  content: StudioDraftContent,
  savedAt: string,
): Promise<DraftSaveResult> {
  const pointer = await database.prepare(`
    SELECT draft_version_id
    FROM studio_posts
    WHERE id = ? AND status IN ('draft', 'published')
  `).bind(postId).first<{ draft_version_id: string }>();
  if (!pointer) return { outcome: "not_found" };

  const versionId = pointer.draft_version_id;
  const existingTopics = await database.prepare(`
    SELECT taxonomy.stable_key
    FROM studio_post_version_topics AS selected
    JOIN studio_taxonomy AS taxonomy ON taxonomy.id = selected.taxonomy_id
    WHERE selected.version_id = ? AND taxonomy.dimension = 'topic'
  `).bind(versionId).all<{ stable_key: string }>();
  const retainedTopicKeys = new Set(
    (existingTopics.results ?? []).map(({ stable_key }) => stable_key),
  );
  const sourceHash = await draftHash(content);
  const statements: StudioD1Statement[] = [
    database.prepare(`
      UPDATE studio_post_versions
      SET revision = revision + 1,
        source_hash = ?,
        title = ?,
        body_markdown = ?,
        kind = ?,
        updated_at = ?,
        schema_version = ?
      WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
        AND EXISTS (
          SELECT 1
          FROM studio_posts
          WHERE id = ? AND draft_version_id = ?
            AND status IN ('draft', 'published')
        )
    `).bind(
      sourceHash,
      content.title,
      content.body,
      content.kind,
      savedAt,
      draftSchemaVersion,
      versionId,
      postId,
      expectedRevision,
      postId,
      versionId,
    ),
    database.prepare(`
      DELETE FROM studio_post_version_topics
      WHERE version_id = ?
        AND EXISTS (
          SELECT 1
          FROM studio_post_versions
          WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
            AND source_hash = ?
        )
    `).bind(
      versionId,
      versionId,
      postId,
      expectedRevision + 1,
      sourceHash,
    ),
    ...content.topics.map((topic) =>
      activeTopicInsert(database, versionId, topic, {
        postId,
        revision: expectedRevision + 1,
        sourceHash,
      }, retainedTopicKeys.has(topic))
    ),
    database.prepare(`
      UPDATE studio_posts
      SET updated_at = ?
      WHERE id = ? AND draft_version_id = ?
        AND EXISTS (
          SELECT 1
          FROM studio_post_versions
          WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
            AND source_hash = ?
        )
    `).bind(
      savedAt,
      postId,
      versionId,
      versionId,
      postId,
      expectedRevision + 1,
      sourceHash,
    ),
  ];

  const results = await database.batch(statements);
  if (results[0]?.meta?.changes !== 1) {
    const current = await database.prepare(`
      SELECT version.revision
      FROM studio_posts AS post
      JOIN studio_post_versions AS version ON version.id = post.draft_version_id
      WHERE post.id = ? AND post.status IN ('draft', 'published')
        AND version.state = 'draft'
    `).bind(postId).first<{ revision: number }>();
    return {
      outcome: "revision_conflict",
      currentRevision: current?.revision ?? null,
    };
  }
  return {
    outcome: "saved",
    postId,
    versionId,
    revision: expectedRevision + 1,
    savedAt,
  };
}

function publishSnapshotMatch(input: PublishCandidateInput) {
  const topicChecks = input.topicIds.map(() => `
    AND EXISTS (
      SELECT 1
      FROM studio_post_version_topics AS selected_topic
      JOIN studio_taxonomy AS taxonomy
        ON taxonomy.id = selected_topic.taxonomy_id
      WHERE selected_topic.version_id = version.id
        AND selected_topic.taxonomy_id = ?
        AND taxonomy.dimension = 'topic'
        AND taxonomy.status = 'active'
    )
  `).join("");
  const assetChecks = input.assets.map(() => `
    AND EXISTS (
      SELECT 1
      FROM studio_post_version_assets AS selected_asset
      JOIN studio_assets AS asset ON asset.id = selected_asset.asset_id
      WHERE selected_asset.version_id = version.id
        AND asset.id = ?
        AND selected_asset.ordinal = ?
        AND selected_asset.alt = ?
        AND asset.status = 'ready'
        AND asset.public_r2_key = ?
        AND asset.public_bytes = ?
        AND asset.public_sha256 = ?
        AND asset.discord_r2_key = ?
        AND asset.discord_bytes = ?
        AND asset.discord_sha256 = ?
    )
  `).join("");
  const mappingCheck = input.action === "create"
    ? `AND post.discord_thread_id IS NULL
       AND post.discord_starter_message_id IS NULL`
    : `AND post.discord_thread_id = ?
       AND post.discord_starter_message_id = ?`;
  const mappingValues = input.action === "create"
    ? []
    : [input.threadId, input.starterMessageId];

  return {
    sql: `
      version.id = ?
      AND version.post_id = ?
      AND version.state = 'draft'
      AND version.revision = ?
      AND version.source_hash = ?
      AND post.status = ?
      AND post.current_version_id IS ?
      ${mappingCheck}
      AND EXISTS (
        SELECT 1
        FROM studio_taxonomy AS kind_taxonomy
        WHERE kind_taxonomy.dimension = 'kind'
          AND kind_taxonomy.stable_key = version.kind
          AND kind_taxonomy.status = 'active'
      )
      AND (
        SELECT count(*)
        FROM studio_post_version_topics
        WHERE version_id = version.id
      ) = ?
      ${topicChecks}
      AND (
        SELECT count(*)
        FROM studio_post_version_assets
        WHERE version_id = version.id
      ) = ?
      ${assetChecks}
    `,
    values: [
      input.draftVersionId,
      input.postId,
      input.expectedRevision,
      input.expectedSourceHash,
      input.postStatus,
      input.previousVersionId,
      ...mappingValues,
      input.topicIds.length,
      ...input.topicIds,
      input.assets.length,
      ...input.assets.flatMap((asset) => [
        asset.id,
        asset.ordinal,
        asset.alt,
        asset.publicR2Key,
        asset.publicBytes,
        asset.publicSha256,
        asset.discordR2Key,
        asset.discordBytes,
        asset.discordSha256,
      ]),
    ],
  };
}

function validPublishTransition(input: PublishCandidateInput) {
  return input.action === "create"
    ? input.postStatus === "draft" &&
      input.previousVersionId === null &&
      input.threadId === null &&
      input.starterMessageId === null
    : input.postStatus === "published" &&
      input.previousVersionId !== null &&
      input.threadId !== null &&
      input.starterMessageId !== null;
}

export async function isPublishSnapshotCurrent(
  database: StudioD1,
  input: PublishCandidateInput,
) {
  if (!validPublishTransition(input)) return false;
  const match = publishSnapshotMatch(input);
  const row = await database.prepare(`
    SELECT 1 AS matched
    FROM studio_post_versions AS version
    JOIN studio_posts AS post ON post.draft_version_id = version.id
    WHERE ${match.sql}
  `).bind(...match.values).first<{ matched: number }>();
  return row?.matched === 1;
}

function candidateInsert(
  database: StudioD1,
  candidateId: string,
  input: PublishCandidateInput,
) {
  const match = publishSnapshotMatch(input);
  return database.prepare(`
    INSERT INTO studio_post_versions (
      id, post_id, state, revision, source_hash, title, body_markdown,
      kind, locale, created_at, updated_at, schema_version
    )
    SELECT ?, version.post_id, 'candidate', 0, version.source_hash,
      version.title, version.body_markdown, version.kind, version.locale,
      ?, ?, version.schema_version
    FROM studio_post_versions AS version
    JOIN studio_posts AS post ON post.draft_version_id = version.id
    WHERE ${match.sql}
  `).bind(
    candidateId,
    input.createdAt,
    input.createdAt,
    ...match.values,
  );
}

function candidateTopicInsert(
  database: StudioD1,
  candidateId: string,
  taxonomyId: string,
) {
  return database.prepare(`
    INSERT INTO studio_post_version_topics (version_id, taxonomy_id)
    SELECT ?, ?
    WHERE EXISTS (
      SELECT 1 FROM studio_post_versions
      WHERE id = ? AND state = 'candidate'
    )
  `).bind(candidateId, taxonomyId, candidateId);
}

function candidateAssetInsert(
  database: StudioD1,
  candidateId: string,
  asset: PublishCandidateAsset,
) {
  return database.prepare(`
    INSERT INTO studio_post_version_assets (version_id, asset_id, ordinal, alt)
    SELECT ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM studio_post_versions
      WHERE id = ? AND state = 'candidate'
    )
  `).bind(candidateId, asset.id, asset.ordinal, asset.alt, candidateId);
}

export async function createPublishCandidate(
  database: StudioD1,
  input: PublishCandidateInput,
): Promise<PublishCandidateResult | null> {
  if (!validPublishTransition(input)) return null;
  const candidateId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const slug = input.action === "create"
    ? stablePostSlug(input.title, input.postId)
    : null;
  const mappingCheck = input.action === "create"
    ? "AND discord_thread_id IS NULL AND discord_starter_message_id IS NULL"
    : "AND discord_thread_id = ? AND discord_starter_message_id = ?";
  const mappingValues = input.action === "create"
    ? []
    : [input.threadId, input.starterMessageId];
  const payload = input.action === "create"
    ? {
        tagIds: input.tagIds,
        assets: input.assets,
        previousVersionId: null,
      }
    : {
        tagIds: input.tagIds,
        assets: input.assets,
        previousVersionId: input.previousVersionId,
        threadId: input.threadId,
        starterMessageId: input.starterMessageId,
      };
  const statements: StudioD1Statement[] = [
    candidateInsert(database, candidateId, input),
    ...input.topicIds.map((taxonomyId) =>
      candidateTopicInsert(database, candidateId, taxonomyId)
    ),
    ...input.assets.map((asset) =>
      candidateAssetInsert(database, candidateId, asset)
    ),
  ];
  const postIndex = statements.length;
  statements.push(
    database.prepare(`
      UPDATE studio_posts
      SET status = 'publishing', slug = coalesce(slug, ?),
        discord_delivery_state = 'queued', updated_at = ?
      WHERE id = ?
        AND status = ?
        AND draft_version_id = ?
        AND current_version_id IS ?
        ${mappingCheck}
        AND EXISTS (
          SELECT 1 FROM studio_post_versions
          WHERE id = ? AND post_id = ? AND state = 'candidate'
        )
    `).bind(
      slug,
      input.createdAt,
      input.postId,
      input.postStatus,
      input.draftVersionId,
      input.previousVersionId,
      ...mappingValues,
      candidateId,
      input.postId,
    ),
  );
  const jobIndex = statements.length;
  statements.push(
    database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, version_id, target, action, payload_json,
        status, attempts, expected_hash, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, 'discord', ?, ?, 'queued', 0, ?, ?, ?
      WHERE EXISTS (
        SELECT 1
        FROM studio_posts
        WHERE id = ?
          AND status = 'publishing'
          AND current_version_id IS ?
          ${mappingCheck}
      ) AND EXISTS (
        SELECT 1 FROM studio_post_versions
        WHERE id = ? AND post_id = ? AND state = 'candidate'
      )
    `).bind(
      jobId,
      `discord:${input.action}:${input.postId}:${input.expectedHash}`,
      input.postId,
      candidateId,
      input.action,
      JSON.stringify(payload),
      input.expectedHash,
      input.createdAt,
      input.createdAt,
      input.postId,
      input.previousVersionId,
      ...mappingValues,
      candidateId,
      input.postId,
    ),
  );

  const results = await database.batch(statements);
  if (
    results[0]?.meta?.changes !== 1 ||
    results[postIndex]?.meta?.changes !== 1 ||
    results[jobIndex]?.meta?.changes !== 1
  ) {
    return null;
  }
  return { candidateId, jobId };
}

export async function queueArchive(
  database: StudioD1,
  input: ArchiveInput,
): Promise<{ jobId: string } | null> {
  const jobId = crypto.randomUUID();
  const results = await database.batch([
    database.prepare(`
      UPDATE studio_posts
      SET status = 'archiving', pinned_at = NULL, hero_rank = NULL,
        discord_delivery_state = 'queued', updated_at = ?
      WHERE id = ?
        AND status IN ('published', 'unpublished')
        AND current_version_id = ?
        AND discord_thread_id = ?
        AND discord_starter_message_id = ?
    `).bind(
      input.createdAt,
      input.postId,
      input.currentVersionId,
      input.threadId,
      input.starterMessageId,
    ),
    database.prepare(`
      UPDATE delivery_jobs
      SET status = 'failed', error_code = 'notification_post_archived',
        last_error = 'notification_post_archived', updated_at = ?, completed_at = ?
      WHERE post_id = ? AND target = 'notification' AND action = 'send'
        AND status NOT IN ('succeeded', 'failed', 'outcome_unknown')
    `).bind(input.createdAt, input.createdAt, input.postId),
    database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, version_id, target, action, payload_json,
        status, attempts, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, 'discord', 'delete', ?, 'queued', 0, ?, ?
      WHERE EXISTS (
        SELECT 1
        FROM studio_posts
        WHERE id = ?
          AND status = 'archiving'
          AND current_version_id = ?
          AND discord_thread_id = ?
          AND discord_starter_message_id = ?
          AND updated_at = ?
      )
    `).bind(
      jobId,
      `discord:delete:${input.postId}:${input.threadId}`,
      input.postId,
      input.currentVersionId,
      JSON.stringify({
        threadId: input.threadId,
        starterMessageId: input.starterMessageId,
      }),
      input.createdAt,
      input.createdAt,
      input.postId,
      input.currentVersionId,
      input.threadId,
      input.starterMessageId,
      input.createdAt,
    ),
  ]);
  return results[0]?.meta?.changes === 1 && results[2]?.meta?.changes === 1
    ? { jobId }
    : null;
}

export async function setPortfolioVisibility(
  database: StudioD1,
  input: { postId: string; visible: boolean; changedAt: string },
) {
  const expectedStatus = input.visible ? "unpublished" : "published";
  const nextStatus = input.visible ? "published" : "unpublished";
  const statements = [database.prepare(`
    UPDATE studio_posts
    SET status = ?, pinned_at = CASE WHEN ? = 1 THEN pinned_at ELSE NULL END,
      hero_rank = CASE WHEN ? = 1 THEN hero_rank ELSE NULL END, updated_at = ?
    WHERE id = ? AND status = ?
      AND current_version_id IS NOT NULL
      AND discord_thread_id IS NOT NULL
      AND discord_starter_message_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM delivery_jobs
        WHERE post_id = studio_posts.id
          AND target = 'discord'
          AND status NOT IN ('succeeded', 'failed', 'outcome_unknown')
      )
  `).bind(
    nextStatus,
    input.visible ? 1 : 0,
    input.visible ? 1 : 0,
    input.changedAt,
    input.postId,
    expectedStatus,
  )];
  if (!input.visible) {
    statements.push(database.prepare(`
      UPDATE delivery_jobs
      SET status = 'failed', error_code = 'notification_post_unpublished',
        last_error = 'notification_post_unpublished', updated_at = ?, completed_at = ?
      WHERE post_id = ? AND target = 'notification' AND action = 'send'
        AND status NOT IN ('succeeded', 'failed', 'outcome_unknown')
        AND EXISTS (
          SELECT 1 FROM studio_posts
          WHERE id = ? AND status = 'unpublished'
        )
    `).bind(input.changedAt, input.changedAt, input.postId, input.postId));
  }
  const updated = await database.batch(statements);
  return updated[0]?.meta?.changes === 1;
}

export async function setPinnedPost(
  database: StudioD1,
  input: {
    postId: string;
    pinned: boolean;
    expectedCurationRevision: number;
    changedAt: string;
  },
) {
  if (!input.pinned) {
    const updated = await database.prepare(`
      UPDATE studio_posts
      SET pinned_at = NULL, updated_at = ?,
        curation_revision = curation_revision + 1
      WHERE id = ? AND status = 'published' AND current_version_id IS NOT NULL
        AND curation_revision = ? AND pinned_at IS NOT NULL
    `).bind(
      input.changedAt,
      input.postId,
      input.expectedCurationRevision,
    ).run();
    return updated.meta?.changes === 1;
  }
  const results = await database.batch([
    database.prepare(`
      UPDATE studio_posts
      SET pinned_at = NULL, updated_at = ?,
        curation_revision = curation_revision + 1
      WHERE id != ? AND pinned_at IS NOT NULL AND status != 'purged'
        AND EXISTS (
          SELECT 1 FROM studio_posts AS target
          WHERE target.id = ? AND target.status = 'published'
            AND target.current_version_id IS NOT NULL
            AND target.curation_revision = ?
        )
    `).bind(
      input.changedAt,
      input.postId,
      input.postId,
      input.expectedCurationRevision,
    ),
    database.prepare(`
      UPDATE studio_posts
      SET pinned_at = ?, updated_at = ?,
        curation_revision = curation_revision + 1
      WHERE id = ? AND status = 'published' AND current_version_id IS NOT NULL
        AND curation_revision = ?
    `).bind(
      input.changedAt,
      input.changedAt,
      input.postId,
      input.expectedCurationRevision,
    ),
  ]);
  return results[1]?.meta?.changes === 1;
}

export async function setHeroRank(
  database: StudioD1,
  input: {
    postId: string;
    heroRank: number | null;
    expectedCurationRevision: number;
    changedAt: string;
  },
) {
  const statements = [];
  if (input.heroRank !== null) {
    statements.push(database.prepare(`
      UPDATE studio_posts
      SET hero_rank = NULL, updated_at = ?,
        curation_revision = curation_revision + 1
      WHERE id != ? AND hero_rank = ? AND status != 'purged'
        AND EXISTS (
          SELECT 1 FROM studio_posts AS target
          WHERE target.id = ? AND target.status = 'published'
            AND target.current_version_id IS NOT NULL
            AND target.curation_revision = ?
        )
    `).bind(
      input.changedAt,
      input.postId,
      input.heroRank,
      input.postId,
      input.expectedCurationRevision,
    ));
  }
  const targetIndex = statements.length;
  statements.push(database.prepare(`
    UPDATE studio_posts
    SET hero_rank = ?, updated_at = ?,
      curation_revision = curation_revision + 1
    WHERE id = ? AND status = 'published' AND current_version_id IS NOT NULL
      AND curation_revision = ?
      AND (? IS NOT NULL OR hero_rank IS NOT NULL)
  `).bind(
    input.heroRank,
    input.changedAt,
    input.postId,
    input.expectedCurationRevision,
    input.heroRank,
  ));
  const results = await database.batch(statements);
  return results[targetIndex]?.meta?.changes === 1;
}

export async function queueRestore(
  database: StudioD1,
  input: RestoreInput,
): Promise<{ jobId: string } | null> {
  const jobId = crypto.randomUUID();
  const payload = JSON.stringify({
    restore: true,
    tagIds: input.tagIds,
    assets: input.assets,
    previousVersionId: input.currentVersionId,
    archivedThreadId: input.archivedThreadId,
    archivedStarterMessageId: input.archivedStarterMessageId,
  });
  const results = await database.batch([
    database.prepare(`
      UPDATE studio_posts
      SET status = 'restoring', pinned_at = NULL, hero_rank = NULL,
        discord_delivery_state = 'queued', updated_at = ?
      WHERE id = ? AND status = 'archived' AND current_version_id = ?
        AND discord_thread_id = ? AND discord_starter_message_id = ?
        AND archived_at = ?
    `).bind(
      input.createdAt,
      input.postId,
      input.currentVersionId,
      input.archivedThreadId,
      input.archivedStarterMessageId,
      input.archivedAt,
    ),
    database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, version_id, target, action, payload_json,
        status, attempts, expected_hash, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, 'discord', 'create', ?, 'queued', 0, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM studio_posts
        WHERE id = ? AND status = 'restoring' AND current_version_id = ?
          AND discord_thread_id = ? AND discord_starter_message_id = ?
          AND archived_at = ? AND updated_at = ?
      )
    `).bind(
      jobId,
      `restore:${input.postId}:${input.archivedAt}`,
      input.postId,
      input.currentVersionId,
      payload,
      input.expectedHash,
      input.createdAt,
      input.createdAt,
      input.postId,
      input.currentVersionId,
      input.archivedThreadId,
      input.archivedStarterMessageId,
      input.archivedAt,
      input.createdAt,
    ),
  ]);
  return results[0]?.meta?.changes === 1 && results[1]?.meta?.changes === 1
    ? { jobId }
    : null;
}

async function finalizeArchive(
  database: StudioD1,
  input: Extract<DeliveryFinalization, { kind: "archive" }>,
) {
  const results = await database.batch([
    database.prepare(`
      UPDATE studio_posts
      SET status = 'archived', archived_at = ?,
        discord_delivery_state = 'deleted', discord_checked_at = ?, updated_at = ?
      WHERE id = ?
        AND status IN ('archiving', 'archived')
        AND current_version_id = ?
        AND discord_thread_id = ?
        AND discord_starter_message_id = ?
        AND EXISTS (
          SELECT 1 FROM delivery_jobs
          WHERE id = ? AND post_id = ? AND version_id = ?
            AND target = 'discord' AND action = 'delete' AND status = 'finalizing'
        )
    `).bind(
      input.completedAt,
      input.completedAt,
      input.completedAt,
      input.postId,
      input.currentVersionId,
      input.remoteThreadId,
      input.remoteStarterMessageId,
      input.jobId,
      input.postId,
      input.currentVersionId,
    ),
    database.prepare(`
      UPDATE delivery_jobs
      SET status = 'succeeded', error_code = NULL, last_error = NULL,
        updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'finalizing'
        AND EXISTS (
          SELECT 1 FROM studio_posts
          WHERE id = ? AND status = 'archived'
            AND current_version_id = ?
            AND discord_thread_id = ?
            AND discord_starter_message_id = ?
        )
    `).bind(
      input.completedAt,
      input.completedAt,
      input.jobId,
      input.postId,
      input.currentVersionId,
      input.remoteThreadId,
      input.remoteStarterMessageId,
    ),
  ]);
  return results[1]?.meta?.changes === 1;
}

async function finalizeRestore(
  database: StudioD1,
  input: Extract<DeliveryFinalization, { kind: "restore" }>,
) {
  const results = await database.batch([
    database.prepare(`
      UPDATE studio_posts
      SET status = 'published', discord_thread_id = ?,
        discord_starter_message_id = ?, discord_delivery_state = 'delivered',
        discord_remote_hash = ?, discord_checked_at = ?, archived_at = NULL,
        updated_at = ?
      WHERE id = ? AND status = 'restoring' AND current_version_id = ?
        AND discord_thread_id = ? AND discord_starter_message_id = ?
        AND EXISTS (
          SELECT 1 FROM delivery_jobs
          WHERE id = ? AND post_id = ? AND version_id = ?
            AND target = 'discord' AND action = 'create' AND status = 'finalizing'
            AND expected_hash = ? AND delivered_hash = expected_hash
            AND remote_id = ? AND remote_aux_id = ?
        )
    `).bind(
      input.remoteThreadId,
      input.remoteStarterMessageId,
      input.expectedHash,
      input.completedAt,
      input.completedAt,
      input.postId,
      input.currentVersionId,
      input.archivedThreadId,
      input.archivedStarterMessageId,
      input.jobId,
      input.postId,
      input.currentVersionId,
      input.expectedHash,
      input.remoteThreadId,
      input.remoteStarterMessageId,
    ),
    database.prepare(`
      UPDATE delivery_jobs
      SET status = 'succeeded', delivered_hash = expected_hash,
        error_code = NULL, last_error = NULL, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'finalizing' AND expected_hash = ?
        AND remote_id = ? AND remote_aux_id = ?
        AND EXISTS (
          SELECT 1 FROM studio_posts
          WHERE id = ? AND status = 'published' AND current_version_id = ?
            AND discord_thread_id = ? AND discord_starter_message_id = ?
            AND archived_at IS NULL
        )
    `).bind(
      input.completedAt,
      input.completedAt,
      input.jobId,
      input.expectedHash,
      input.remoteThreadId,
      input.remoteStarterMessageId,
      input.postId,
      input.currentVersionId,
      input.remoteThreadId,
      input.remoteStarterMessageId,
    ),
  ]);
  return results[1]?.meta?.changes === 1;
}

async function finalizePublish(
  database: StudioD1,
  input: Extract<DeliveryFinalization, { kind: "publish" }>,
) {
  const notificationJobId = input.action === "create" ? crypto.randomUUID() : null;
  const previousCheck = input.previousVersionId === null
    ? "AND post.current_version_id IS NULL"
    : `AND post.current_version_id = ?
       AND EXISTS (
         SELECT 1 FROM studio_post_versions AS previous
         WHERE previous.id = ? AND previous.post_id = post.id
           AND previous.state IN ('published', 'superseded')
       )`;
  const previousValues = input.previousVersionId === null
    ? []
    : [input.previousVersionId, input.previousVersionId];
  const remoteMappingCheck = input.action === "create"
    ? `AND post.discord_thread_id IS NULL
       AND post.discord_starter_message_id IS NULL`
    : `AND post.discord_thread_id = ?
       AND post.discord_starter_message_id = ?`;
  const postMappingCheck = input.action === "create"
    ? `AND discord_thread_id IS NULL
       AND discord_starter_message_id IS NULL`
    : `AND discord_thread_id = ?
       AND discord_starter_message_id = ?`;
  const mappingValues = input.action === "create"
    ? []
    : [input.remoteThreadId, input.remoteStarterMessageId];
  const statements: StudioD1Statement[] = [
    database.prepare(`
      UPDATE studio_post_versions
      SET state = 'published', superseded_at = NULL, updated_at = ?
      WHERE id = ? AND post_id = ? AND state IN ('candidate', 'published')
        AND EXISTS (
          SELECT 1
          FROM studio_posts AS post
          JOIN delivery_jobs AS job ON job.post_id = post.id
          WHERE post.id = ? AND post.status = 'publishing'
            ${previousCheck}
            ${remoteMappingCheck}
            AND job.id = ? AND job.version_id = ?
            AND job.target = 'discord' AND job.action = ?
            AND job.status = 'finalizing'
            AND job.expected_hash = ? AND job.delivered_hash = job.expected_hash
            AND job.remote_id = ? AND job.remote_aux_id = ?
        )
    `).bind(
      input.completedAt,
      input.candidateVersionId,
      input.postId,
      input.postId,
      ...previousValues,
      ...mappingValues,
      input.jobId,
      input.candidateVersionId,
      input.action,
      input.expectedHash,
      input.remoteThreadId,
      input.remoteStarterMessageId,
    ),
  ];
  if (input.previousVersionId !== null) {
    statements.push(
      database.prepare(`
        UPDATE studio_post_versions
        SET state = 'superseded', superseded_at = ?, updated_at = ?
        WHERE id = ? AND post_id = ? AND id != ?
          AND state IN ('published', 'superseded')
          AND EXISTS (
            SELECT 1 FROM studio_post_versions
            WHERE id = ? AND post_id = ? AND state = 'published'
          )
          AND EXISTS (
            SELECT 1 FROM studio_posts
            WHERE id = ? AND status = 'publishing' AND current_version_id = ?
          )
          AND EXISTS (
            SELECT 1 FROM delivery_jobs
            WHERE id = ? AND status = 'finalizing' AND version_id = ?
          )
      `).bind(
        input.completedAt,
        input.completedAt,
        input.previousVersionId,
        input.postId,
        input.candidateVersionId,
        input.candidateVersionId,
        input.postId,
        input.postId,
        input.previousVersionId,
        input.jobId,
        input.candidateVersionId,
      ),
    );
  }
  statements.push(
    database.prepare(`
      UPDATE studio_assets
      SET first_published_at = coalesce(first_published_at, ?), updated_at = ?
      WHERE first_published_at IS NULL
        AND id IN (
          SELECT asset_id
          FROM studio_post_version_assets
          WHERE version_id = ?
        )
        AND EXISTS (
          SELECT 1
          FROM studio_post_versions
          WHERE id = ? AND post_id = ? AND state = 'published'
        )
        AND EXISTS (
          SELECT 1
          FROM delivery_jobs
          WHERE id = ? AND version_id = ? AND status = 'finalizing'
            AND delivered_hash = expected_hash
        )
    `).bind(
      input.completedAt,
      input.completedAt,
      input.candidateVersionId,
      input.candidateVersionId,
      input.postId,
      input.jobId,
      input.candidateVersionId,
    ),
  );
  statements.push(
    database.prepare(`
      UPDATE studio_posts
      SET status = 'published', current_version_id = ?,
        discord_thread_id = ?, discord_starter_message_id = ?,
        discord_delivery_state = 'delivered', discord_remote_hash = ?,
        discord_checked_at = ?, updated_at = ?
      WHERE id = ? AND status = 'publishing' AND current_version_id IS ?
        ${postMappingCheck}
        AND EXISTS (
          SELECT 1 FROM studio_post_versions
          WHERE id = ? AND post_id = ? AND state = 'published'
        )
        AND EXISTS (
          SELECT 1 FROM delivery_jobs
          WHERE id = ? AND status = 'finalizing' AND version_id = ?
            AND delivered_hash = expected_hash AND expected_hash = ?
            AND remote_id = ? AND remote_aux_id = ?
        )
    `).bind(
      input.candidateVersionId,
      input.remoteThreadId,
      input.remoteStarterMessageId,
      input.expectedHash,
      input.completedAt,
      input.completedAt,
      input.postId,
      input.previousVersionId,
      ...mappingValues,
      input.candidateVersionId,
      input.postId,
      input.jobId,
      input.candidateVersionId,
      input.expectedHash,
      input.remoteThreadId,
      input.remoteStarterMessageId,
    ),
    database.prepare(`
      UPDATE delivery_jobs
      SET status = 'succeeded', delivered_hash = expected_hash,
        error_code = NULL, last_error = NULL, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'finalizing'
        AND version_id = ? AND expected_hash = ?
        AND remote_id = ? AND remote_aux_id = ?
        AND EXISTS (
          SELECT 1 FROM studio_posts
          WHERE id = ? AND status = 'published' AND current_version_id = ?
            AND discord_thread_id = ? AND discord_starter_message_id = ?
            AND discord_remote_hash = ?
        )
    `).bind(
      input.completedAt,
      input.completedAt,
      input.jobId,
      input.candidateVersionId,
      input.expectedHash,
      input.remoteThreadId,
      input.remoteStarterMessageId,
      input.postId,
      input.candidateVersionId,
      input.remoteThreadId,
      input.remoteStarterMessageId,
      input.expectedHash,
    ),
  );

  if (notificationJobId) {
    statements.push(
      database.prepare(`
        INSERT INTO delivery_jobs (
          id, dedupe_key, post_id, version_id, target, action, payload_json,
          status, attempts, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, 'notification', 'send', ?, 'queued', 0, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM studio_posts
          WHERE id = ? AND status = 'published' AND current_version_id = ?
            AND discord_thread_id = ? AND discord_starter_message_id = ?
        )
          AND EXISTS (
            SELECT 1
            FROM delivery_jobs
            WHERE id = ? AND post_id = ? AND version_id = ?
              AND target = 'discord' AND action = 'create' AND status = 'succeeded'
          )
      `).bind(
        notificationJobId,
        `notify:${input.postId}:${input.candidateVersionId}`,
        input.postId,
        input.candidateVersionId,
        JSON.stringify({ threadId: input.remoteThreadId }),
        input.completedAt,
        input.completedAt,
        input.postId,
        input.candidateVersionId,
        input.remoteThreadId,
        input.remoteStarterMessageId,
        input.jobId,
        input.postId,
        input.candidateVersionId,
      ),
    );
  }

  const results = await database.batch(statements);
  return results.at(-1)?.meta?.changes === 1;
}

export function finalizeVerifiedDelivery(
  database: StudioD1,
  input: DeliveryFinalization,
) {
  if (input.kind === "archive") return finalizeArchive(database, input);
  if (input.kind === "restore") return finalizeRestore(database, input);
  return finalizePublish(database, input);
}

export type TaxonomyCatalogItem = {
  id: string;
  dimension: TaxonomyDimension;
  stableKey: string;
  label: string;
  status: "active" | "archived";
  ordinal: number;
  discordTagId: string | null;
  createdAt: string;
  updatedAt: string;
};

type TaxonomyRow = {
  id: string;
  dimension: TaxonomyDimension;
  stable_key: string;
  label: string;
  status: "active" | "archived";
  ordinal: number;
  discord_tag_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TaxonomyMutation =
  | { action: "sync" }
  | {
      action: "add";
      dimension: "topic";
      stableKey: string;
      label: string;
    }
  | { action: "rename"; taxonomyId: string; label: string }
  | {
      action: "reorder";
      dimension: TaxonomyDimension;
      taxonomyIds: string[];
    }
  | { action: "archive"; taxonomyId: string };

export type TaxonomyMutationResult =
  | { outcome: "queued"; jobId: string }
  | { outcome: "active_job"; jobId: string; status: string }
  | {
      outcome:
        | "not_found"
        | "stable_key_exists"
        | "label_exists"
        | "invalid_order"
        | "kind_migration_required"
        | "taxonomy_limit";
    };

export type TaxonomySyncJob = {
  id: string;
  status: string;
  attempts: number;
  errorCode: string | null;
  updatedAt: string;
};

type TaxonomyJobRow = {
  id: string;
  status: string;
  attempts: number;
  error_code: string | null;
  updated_at: string;
};

function taxonomyItem(row: TaxonomyRow): TaxonomyCatalogItem {
  return {
    id: row.id,
    dimension: row.dimension,
    stableKey: row.stable_key,
    label: row.label,
    status: row.status,
    ordinal: row.ordinal,
    discordTagId: row.discord_tag_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTaxonomyCatalog(database: StudioD1) {
  const rows = await database.prepare(`
    SELECT id, dimension, stable_key, label, status, ordinal,
      discord_tag_id, created_at, updated_at
    FROM studio_taxonomy
    ORDER BY CASE dimension WHEN 'kind' THEN 0 ELSE 1 END,
      CASE status WHEN 'active' THEN 0 ELSE 1 END,
      ordinal ASC, id ASC
  `).all<TaxonomyRow>();
  return (rows.results ?? []).map(taxonomyItem);
}

export async function latestTaxonomySyncJob(
  database: StudioD1,
): Promise<TaxonomySyncJob | null> {
  const row = await database.prepare(`
    SELECT id, status, attempts, error_code, updated_at
    FROM delivery_jobs
    WHERE target = 'discord' AND action = 'taxonomy'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).first<TaxonomyJobRow>();
  return row
    ? {
        id: row.id,
        status: row.status,
        attempts: row.attempts,
        errorCode: row.error_code,
        updatedAt: row.updated_at,
      }
    : null;
}

export async function taxonomySyncJobState(
  database: StudioD1,
  jobId: string,
): Promise<TaxonomySyncJob | null> {
  const row = await database.prepare(`
    SELECT id, status, attempts, error_code, updated_at
    FROM delivery_jobs
    WHERE id = ? AND target = 'discord' AND action = 'taxonomy'
  `).bind(jobId).first<TaxonomyJobRow>();
  return row
    ? {
        id: row.id,
        status: row.status,
        attempts: row.attempts,
        errorCode: row.error_code,
        updatedAt: row.updated_at,
      }
    : null;
}

function reorderTaxonomyStatements(
  database: StudioD1,
  rows: TaxonomyCatalogItem[],
  dimension: TaxonomyDimension,
  updatedAt: string,
) {
  const ordered = rows.filter((row) => row.dimension === dimension);
  if (ordered.length === 0) return [];
  const temporaryOffset = Math.max(...ordered.map(({ ordinal }) => ordinal), 0) +
    ordered.length + 1;
  const cases = ordered.map(() => "WHEN ? THEN ?").join(" ");
  return [
    database.prepare(`
      UPDATE studio_taxonomy
      SET ordinal = ordinal + ?, updated_at = ?
      WHERE dimension = ?
    `).bind(temporaryOffset, updatedAt, dimension),
    database.prepare(`
      UPDATE studio_taxonomy
      SET ordinal = CASE id ${cases} ELSE ordinal END, updated_at = ?
      WHERE dimension = ?
    `).bind(
      ...ordered.flatMap((row, ordinal) => [row.id, ordinal]),
      updatedAt,
      dimension,
    ),
  ];
}

function activeTaxonomyJob(database: StudioD1) {
  return database.prepare(`
    SELECT id, status, attempts, error_code, updated_at
    FROM delivery_jobs
    WHERE target = 'discord' AND action = 'taxonomy'
      AND status NOT IN ('succeeded', 'failed', 'outcome_unknown')
    LIMIT 1
  `).first<TaxonomyJobRow>();
}

export async function queueTaxonomyMutation(
  database: StudioD1,
  mutation: TaxonomyMutation,
  createdAt: string,
): Promise<TaxonomyMutationResult> {
  const activeJob = await activeTaxonomyJob(database);
  if (activeJob) {
    return {
      outcome: "active_job",
      jobId: activeJob.id,
      status: activeJob.status,
    };
  }

  const catalog = await listTaxonomyCatalog(database);
  const activeRows = catalog.filter(({ status }) => status === "active");
  const statements: StudioD1Statement[] = [];
  let changedId: string | null = null;

  if (mutation.action === "add") {
    if (activeRows.length >= 20) return { outcome: "taxonomy_limit" };
    if (catalog.some(({ stableKey }) => stableKey === mutation.stableKey)) {
      return { outcome: "stable_key_exists" };
    }
    if (activeRows.some(({ label }) => label === mutation.label)) {
      return { outcome: "label_exists" };
    }
    changedId = crypto.randomUUID();
    const dimensionRows = catalog.filter(({ dimension }) =>
      dimension === mutation.dimension
    );
    const added: TaxonomyCatalogItem = {
      id: changedId,
      dimension: mutation.dimension,
      stableKey: mutation.stableKey,
      label: mutation.label,
      status: "active",
      ordinal: Math.max(...dimensionRows.map(({ ordinal }) => ordinal), -1) + 1,
      discordTagId: null,
      createdAt,
      updatedAt: createdAt,
    };
    statements.push(database.prepare(`
      INSERT INTO studio_taxonomy (
        id, dimension, stable_key, label, status, ordinal,
        discord_tag_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, NULL, ?, ?)
    `).bind(
      added.id,
      added.dimension,
      added.stableKey,
      added.label,
      added.ordinal,
      createdAt,
      createdAt,
    ));
    const nextCatalog = [
      ...catalog.filter(({ dimension }) => dimension !== mutation.dimension),
      ...dimensionRows.filter(({ status }) => status === "active"),
      added,
      ...dimensionRows.filter(({ status }) => status === "archived"),
    ];
    statements.push(
      ...reorderTaxonomyStatements(
        database,
        nextCatalog,
        mutation.dimension,
        createdAt,
      ),
    );
  }

  if (mutation.action === "rename") {
    const row = catalog.find(({ id }) => id === mutation.taxonomyId);
    if (!row || row.status !== "active") return { outcome: "not_found" };
    if (activeRows.some(({ id, label }) =>
      id !== row.id && label === mutation.label
    )) {
      return { outcome: "label_exists" };
    }
    changedId = row.id;
    statements.push(database.prepare(`
      UPDATE studio_taxonomy
      SET label = ?, updated_at = ?
      WHERE id = ? AND status = 'active'
    `).bind(mutation.label, createdAt, row.id));
  }

  if (mutation.action === "reorder") {
    const active = catalog.filter(({ dimension, status }) =>
      dimension === mutation.dimension && status === "active"
    );
    if (
      mutation.taxonomyIds.length !== active.length ||
      new Set(mutation.taxonomyIds).size !== active.length ||
      mutation.taxonomyIds.some((id) => !active.some((row) => row.id === id))
    ) {
      return { outcome: "invalid_order" };
    }
    const ordered = [
      ...mutation.taxonomyIds.map((id) =>
        active.find((row) => row.id === id) as TaxonomyCatalogItem
      ),
      ...catalog.filter(({ dimension, status }) =>
        dimension === mutation.dimension && status === "archived"
      ),
      ...catalog.filter(({ dimension }) => dimension !== mutation.dimension),
    ];
    statements.push(
      ...reorderTaxonomyStatements(
        database,
        ordered,
        mutation.dimension,
        createdAt,
      ),
    );
  }

  if (mutation.action === "archive") {
    const row = catalog.find(({ id }) => id === mutation.taxonomyId);
    if (!row || row.status !== "active") return { outcome: "not_found" };
    if (row.dimension === "kind") {
      return { outcome: "kind_migration_required" };
    }
    changedId = row.id;
    statements.push(database.prepare(`
      UPDATE studio_taxonomy
      SET status = 'archived', updated_at = ?
      WHERE id = ? AND dimension = 'topic' AND status = 'active'
    `).bind(createdAt, row.id));
    const ordered = [
      ...catalog.filter(({ dimension, status, id }) =>
        dimension === row.dimension && status === "active" && id !== row.id
      ),
      ...catalog.filter(({ dimension, status }) =>
        dimension === row.dimension && status === "archived"
      ),
      { ...row, status: "archived" as const },
      ...catalog.filter(({ dimension }) => dimension !== row.dimension),
    ];
    statements.push(
      ...reorderTaxonomyStatements(database, ordered, row.dimension, createdAt),
    );
  }

  const jobId = crypto.randomUUID();
  statements.push(database.prepare(`
    INSERT INTO delivery_jobs (
      id, dedupe_key, post_id, version_id, asset_id, target, action,
      payload_json, status, attempts, created_at, updated_at
    ) VALUES (?, ?, NULL, NULL, NULL, 'discord', 'taxonomy', ?,
      'queued', 0, ?, ?)
  `).bind(
    jobId,
    `taxonomy:${jobId}`,
    JSON.stringify({ requestedAction: mutation.action, taxonomyId: changedId }),
    createdAt,
    createdAt,
  ));
  await database.batch(statements);
  return { outcome: "queued", jobId };
}

export async function markTaxonomyQueueFailed(
  database: StudioD1,
  jobId: string,
  updatedAt: string,
) {
  await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'queue_failed', error_code = 'queue_send_failed',
      last_error = 'queue_send_failed', updated_at = ?
    WHERE id = ? AND target = 'discord' AND action = 'taxonomy'
      AND status = 'queued'
  `).bind(updatedAt, jobId).run();
}

export async function retryTaxonomySyncJob(
  database: StudioD1,
  jobId: string,
  updatedAt: string,
) {
  const result = await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'queued', error_code = NULL, last_error = NULL,
      completed_at = NULL, updated_at = ?
    WHERE id = ? AND target = 'discord' AND action = 'taxonomy'
      AND status IN ('queue_failed', 'failed', 'outcome_unknown')
  `).bind(updatedAt, jobId).run();
  if (result.meta?.changes === 1) return "queued" as const;
  const job = await database.prepare(`
    SELECT status FROM delivery_jobs
    WHERE id = ? AND target = 'discord' AND action = 'taxonomy'
  `).bind(jobId).first<{ status: string }>();
  if (!job) return "not_found" as const;
  return job.status === "succeeded" ? "succeeded" as const : "active" as const;
}

export async function claimTaxonomySyncJob(
  database: StudioD1,
  jobId: string,
  updatedAt: string,
) {
  const job = await database.prepare(`
    SELECT id, status, attempts, error_code, updated_at
    FROM delivery_jobs
    WHERE id = ? AND target = 'discord' AND action = 'taxonomy'
  `).bind(jobId).first<TaxonomyJobRow>();
  if (!job) return { outcome: "missing" as const };
  if (["succeeded", "failed", "outcome_unknown"].includes(job.status)) {
    return { outcome: "terminal" as const, status: job.status };
  }
  if (job.status === "processing") return { outcome: "processing" as const };
  const claimed = await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'processing', attempts = attempts + 1,
      error_code = NULL, last_error = NULL, updated_at = ?
    WHERE id = ? AND target = 'discord' AND action = 'taxonomy'
      AND status IN ('queued', 'retrying', 'queue_failed')
  `).bind(updatedAt, jobId).run();
  return claimed.meta?.changes === 1
    ? { outcome: "claimed" as const }
    : { outcome: "missing" as const };
}

export async function finalizeTaxonomySync(
  database: StudioD1,
  jobId: string,
  mappings: { taxonomyId: string; discordTagId: string }[],
  completedAt: string,
) {
  const statements = mappings.map(({ taxonomyId, discordTagId }) =>
    database.prepare(`
      UPDATE studio_taxonomy
      SET discord_tag_id = ?, updated_at = ?
      WHERE id = ? AND status = 'active'
    `).bind(discordTagId, completedAt, taxonomyId)
  );
  statements.push(database.prepare(`
    UPDATE delivery_jobs
    SET status = 'succeeded', error_code = NULL, last_error = NULL,
      completed_at = ?, updated_at = ?
    WHERE id = ? AND target = 'discord' AND action = 'taxonomy'
      AND status = 'processing'
  `).bind(completedAt, completedAt, jobId));
  const results = await database.batch(statements);
  const complete = results.length === mappings.length + 1 &&
    results.every((result) => result.meta?.changes === 1);
  if (!complete) {
    await database.prepare(`
      UPDATE delivery_jobs
      SET status = 'retrying', error_code = 'taxonomy_finalization_failed',
        last_error = 'taxonomy_finalization_failed', completed_at = NULL,
        updated_at = ?
      WHERE id = ? AND target = 'discord' AND action = 'taxonomy'
        AND status = 'succeeded'
    `).bind(completedAt, jobId).run();
  }
  return complete;
}

export async function recordTaxonomySyncFailure(
  database: StudioD1,
  jobId: string,
  errorCode: string,
  terminal: boolean,
  updatedAt: string,
) {
  await database.prepare(`
    UPDATE delivery_jobs
    SET status = ?, error_code = ?, last_error = ?,
      completed_at = CASE WHEN ? THEN ? ELSE NULL END,
      updated_at = ?
    WHERE id = ? AND target = 'discord' AND action = 'taxonomy'
      AND status IN ('queued', 'processing', 'retrying', 'queue_failed')
  `).bind(
    terminal ? "failed" : "retrying",
    errorCode,
    errorCode,
    terminal ? 1 : 0,
    updatedAt,
    updatedAt,
    jobId,
  ).run();
}

export async function expireTaxonomyProcessingLease(
  database: StudioD1,
  jobId: string,
  expectedUpdatedAt: string,
  updatedAt: string,
) {
  const result = await database.prepare(`
    -- taxonomy_processing_lease_cas
    UPDATE delivery_jobs
    SET status = 'failed', error_code = 'taxonomy_retry_exhausted',
      last_error = 'taxonomy_retry_exhausted', completed_at = ?,
      updated_at = ?
    WHERE id = ? AND target = 'discord' AND action = 'taxonomy'
      AND status = 'processing' AND updated_at = ?
  `).bind(updatedAt, updatedAt, jobId, expectedUpdatedAt).run();
  return result.meta?.changes === 1;
}
