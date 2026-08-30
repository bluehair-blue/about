import {
  draftSchemaVersion,
  type DraftKind,
  type DraftTopic,
} from "../db/schema";
import type { StudioD1, StudioD1Statement } from "./phase-a-env";

export type StudioDraftContent = {
  title: string;
  body: string;
  kind: DraftKind;
  topics: DraftTopic[];
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
  discordR2Key: string;
  discordBytes: number;
  discordSha256: string;
};

export type PublishCandidateInput = {
  postId: string;
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

function activeTopicInsert(
  database: StudioD1,
  versionId: string,
  topic: DraftTopic,
  condition?: { postId: string; revision: number; sourceHash: string },
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
      WHERE dimension = 'topic' AND stable_key = ? AND status = 'active'
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
      })
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
      SET status = 'publishing', discord_delivery_state = 'queued', updated_at = ?
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
      SET status = 'archiving', discord_delivery_state = 'queued', updated_at = ?
      WHERE id = ?
        AND status = 'published'
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

async function finalizePublish(
  database: StudioD1,
  input: Extract<DeliveryFinalization, { kind: "publish" }>,
) {
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

  const results = await database.batch(statements);
  return results.at(-1)?.meta?.changes === 1;
}

export function finalizeVerifiedDelivery(
  database: StudioD1,
  input: DeliveryFinalization,
) {
  return input.kind === "archive"
    ? finalizeArchive(database, input)
    : finalizePublish(database, input);
}
