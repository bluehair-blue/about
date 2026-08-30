import type {
  PhaseAEnv,
  StudioD1,
  StudioQueueProducer,
  StudioR2,
} from "./phase-a-env";
import {
  MAX_DISCORD_ATTACHMENT_BYTES,
  queueStudioPostPurge,
} from "./studio-assets";
import {
  createPublishCandidate,
  finalizeVerifiedDelivery,
  isPublishSnapshotCurrent,
  queueArchive,
  queueRestore,
  setPortfolioVisibility,
  type PublishCandidateAsset,
} from "./studio-domain";

const DISCORD_API = "https://discord.com/api/v10";
const MAX_REQUEST_BYTES = 4_096;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PublishAction =
  | "publish"
  | "unpublish"
  | "republish"
  | "archive"
  | "delete"
  | "restore"
  | "purge"
  | "retry"
  | "reconcile";
type DiscordAction = "create" | "update" | "delete";
type RetriableTarget = "discord" | "notification";

type PublishInput = {
  action: PublishAction;
  postId: string;
  jobId: string | null;
  title: string | null;
};

type DraftSnapshot = {
  post_id: string;
  post_status: "draft" | "published";
  draft_version_id: string;
  current_version_id: string | null;
  discord_thread_id: string | null;
  discord_starter_message_id: string | null;
  discord_remote_hash: string | null;
  revision: number;
  source_hash: string;
  title: string;
  body_markdown: string;
  kind: string;
  locale: string;
  schema_version: number;
};

type ArchivedSnapshot = {
  post_id: string;
  current_version_id: string;
  discord_thread_id: string;
  discord_starter_message_id: string;
  archived_at: string;
  source_hash: string;
  title: string;
  body_markdown: string;
  kind: string;
};

type PublishAsset = {
  id: string;
  status: string;
  ordinal: number;
  alt: string;
  public_r2_key: string;
  public_bytes: number | null;
  public_sha256: string | null;
  discord_r2_key: string;
  discord_bytes: number | null;
  discord_sha256: string | null;
};

type TaxonomyRow = {
  id: string;
  dimension: "kind" | "topic";
  stable_key: string;
  label: string;
  ordinal: number;
  discord_tag_id: string | null;
};

type PublishTopic = {
  id: string;
  stable_key: string;
};

type StatusRow = {
  id: string;
  status: string;
  draft_version_id: string | null;
  current_version_id: string | null;
  discord_thread_id: string | null;
  discord_delivery_state: string | null;
  discord_remote_hash: string | null;
  discord_checked_at: string | null;
};

type AssetSummary = {
  asset_count: number;
  not_ready_count: number;
  discord_bytes: number;
};

type JobStatusRow = {
  id: string;
  target: RetriableTarget;
  action: DiscordAction | "send";
  status: string;
  attempts: number;
  error_code: string | null;
  updated_at: string;
};

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseInput(request: Request): Promise<PublishInput | string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return "request_too_large";
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    return "request_too_large";
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "invalid_json";
  }
  if (!isRecord(value)) return "invalid_json_object";
  const action = value.action;
  const postId = value.postId;
  const jobId = value.jobId ?? null;
  const title = value.title ?? null;
  if (
    ![
      "publish",
      "unpublish",
      "republish",
      "archive",
      "delete",
      "restore",
      "purge",
      "retry",
      "reconcile",
    ].includes(String(action)) ||
    typeof postId !== "string" ||
    !uuidPattern.test(postId) ||
    (jobId !== null && (typeof jobId !== "string" || !uuidPattern.test(jobId))) ||
    ((action === "retry" || action === "reconcile") && jobId === null) ||
    ((action !== "retry" && action !== "reconcile") && jobId !== null) ||
    (action === "purge" && (
      typeof title !== "string" ||
      Array.from(title).length < 1 ||
      Array.from(title).length > 100 ||
      title.normalize("NFC") !== title
    )) ||
    (action !== "purge" && title !== null) ||
    Object.keys(value).some((key) =>
      !["action", "postId", "jobId", "title"].includes(key)
    )
  ) {
    return "invalid_publish_request";
  }
  return { action: action as PublishAction, postId, jobId, title };
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function loadDraftSnapshot(database: StudioD1, postId: string) {
  const draft = await database.prepare(`
    SELECT post.id AS post_id, post.status AS post_status,
      post.draft_version_id, post.current_version_id,
      post.discord_thread_id, post.discord_starter_message_id,
      post.discord_remote_hash, version.revision, version.source_hash,
      version.title, version.body_markdown, version.kind, version.locale,
      version.schema_version
    FROM studio_posts AS post
    JOIN studio_post_versions AS version ON version.id = post.draft_version_id
    WHERE post.id = ? AND post.status IN ('draft', 'published')
      AND version.state = 'draft'
  `).bind(postId).first<DraftSnapshot>();
  if (!draft) return null;

  const [assetRows, topicRows, taxonomyRows] = await Promise.all([
    database.prepare(`
      SELECT asset.id, asset.status, selected.ordinal, selected.alt,
        asset.public_r2_key, asset.public_bytes, asset.public_sha256,
        asset.discord_r2_key, asset.discord_bytes, asset.discord_sha256
      FROM studio_post_version_assets AS selected
      JOIN studio_assets AS asset ON asset.id = selected.asset_id
      WHERE selected.version_id = ? AND asset.post_id = ?
      ORDER BY selected.ordinal ASC, asset.id ASC
    `).bind(draft.draft_version_id, postId).all<PublishAsset>(),
    database.prepare(`
      SELECT taxonomy.id, taxonomy.stable_key
      FROM studio_post_version_topics AS selected
      JOIN studio_taxonomy AS taxonomy ON taxonomy.id = selected.taxonomy_id
      WHERE selected.version_id = ? AND taxonomy.dimension = 'topic'
      ORDER BY taxonomy.ordinal ASC
    `).bind(draft.draft_version_id).all<PublishTopic>(),
    database.prepare(`
      SELECT id, dimension, stable_key, label, ordinal, discord_tag_id
      FROM studio_taxonomy
      WHERE status = 'active'
      ORDER BY CASE dimension WHEN 'kind' THEN 0 ELSE 1 END, ordinal ASC
    `).all<TaxonomyRow>(),
  ]);
  return {
    draft,
    assets: assetRows.results ?? [],
    topics: topicRows.results ?? [],
    taxonomy: taxonomyRows.results ?? [],
  };
}

async function loadArchivedSnapshot(database: StudioD1, postId: string) {
  const post = await database.prepare(`
    SELECT post.id AS post_id, post.current_version_id,
      post.discord_thread_id, post.discord_starter_message_id, post.archived_at,
      version.source_hash, version.title, version.body_markdown, version.kind
    FROM studio_posts AS post
    JOIN studio_post_versions AS version ON version.id = post.current_version_id
    WHERE post.id = ? AND post.status = 'archived'
      AND post.current_version_id IS NOT NULL
      AND post.discord_thread_id IS NOT NULL
      AND post.discord_starter_message_id IS NOT NULL
      AND post.archived_at IS NOT NULL
      AND version.state IN ('published', 'superseded')
  `).bind(postId).first<ArchivedSnapshot>();
  if (!post) return null;
  const [assetRows, topicRows, taxonomyRows] = await Promise.all([
    database.prepare(`
      SELECT asset.id, asset.status, selected.ordinal, selected.alt,
        asset.public_r2_key, asset.public_bytes, asset.public_sha256,
        asset.discord_r2_key, asset.discord_bytes, asset.discord_sha256
      FROM studio_post_version_assets AS selected
      JOIN studio_assets AS asset ON asset.id = selected.asset_id
      WHERE selected.version_id = ? AND asset.post_id = ?
      ORDER BY selected.ordinal ASC, asset.id ASC
    `).bind(post.current_version_id, postId).all<PublishAsset>(),
    database.prepare(`
      SELECT taxonomy.id, taxonomy.stable_key
      FROM studio_post_version_topics AS selected
      JOIN studio_taxonomy AS taxonomy ON taxonomy.id = selected.taxonomy_id
      WHERE selected.version_id = ? AND taxonomy.dimension = 'topic'
      ORDER BY taxonomy.ordinal ASC
    `).bind(post.current_version_id).all<PublishTopic>(),
    database.prepare(`
      SELECT id, dimension, stable_key, label, ordinal, discord_tag_id
      FROM studio_taxonomy
      WHERE status = 'active'
      ORDER BY CASE dimension WHEN 'kind' THEN 0 ELSE 1 END, ordinal ASC
    `).all<TaxonomyRow>(),
  ]);
  return {
    post,
    assets: assetRows.results ?? [],
    topics: topicRows.results ?? [],
    taxonomy: taxonomyRows.results ?? [],
  };
}

async function forumTagIds(
  env: PhaseAEnv,
  taxonomy: TaxonomyRow[],
  kind: string,
  topics: string[],
) {
  let response: Response;
  try {
    response = await fetch(
      `${DISCORD_API}/channels/${env.DISCORD_FORUM_CHANNEL_ID}`,
      {
        headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch {
    return { error: "discord_forum_unavailable" } as const;
  }
  if (!response.ok) return { error: "discord_forum_unavailable" } as const;
  const forum = await response.json() as unknown;
  if (
    !isRecord(forum) ||
    forum.id !== env.DISCORD_FORUM_CHANNEL_ID ||
    forum.guild_id !== env.DISCORD_GUILD_ID ||
    forum.type !== 15 ||
    !Array.isArray(forum.available_tags)
  ) {
    return { error: "discord_forum_mismatch" } as const;
  }
  const available = new Map<string, string>();
  for (const value of forum.available_tags) {
    if (
      isRecord(value) &&
      typeof value.id === "string" &&
      /^\d{17,20}$/.test(value.id) &&
      typeof value.name === "string"
    ) {
      available.set(value.id, value.name.normalize("NFC"));
    }
  }

  const selectedKeys = new Set([kind, ...topics]);
  const selected = taxonomy.filter((item) => selectedKeys.has(item.stable_key));
  const missing = selected
    .filter((item) =>
      !item.discord_tag_id ||
      available.get(item.discord_tag_id) !== item.label.normalize("NFC")
    )
    .map((item) => item.label);
  if (missing.length > 0) {
    return { error: "discord_tags_missing", missing } as const;
  }
  return {
    tagIds: selected.map((item) => item.discord_tag_id as string),
  } as const;
}

async function markQueueFailed(database: StudioD1, jobId: string) {
  await database.prepare(`
    UPDATE delivery_jobs
    SET status = CASE WHEN status = 'queued' THEN 'queue_failed' ELSE status END,
      error_code = 'queue_send_failed',
      last_error = 'queue_send_failed', updated_at = ?
    WHERE id = ? AND status IN ('queued', 'finalizing')
  `).bind(new Date().toISOString(), jobId).run();
}

async function enqueue(
  database: StudioD1,
  queue: StudioQueueProducer,
  jobId: string,
  type: "discord_delivery" | "notification_send" = "discord_delivery",
) {
  try {
    await queue.send({ type, jobId });
    return true;
  } catch {
    await markQueueFailed(database, jobId);
    return false;
  }
}

async function preparePublish(
  postId: string,
  env: PhaseAEnv,
  database: StudioD1,
  queue: StudioQueueProducer,
) {
  const snapshot = await loadDraftSnapshot(database, postId);
  if (!snapshot) return json({ error: "draft_not_found" }, 404);
  if (
    snapshot.assets.some((asset) =>
      asset.status !== "ready" ||
      !asset.public_bytes ||
      !asset.public_sha256 ||
      !asset.discord_bytes ||
      !asset.discord_sha256
    )
  ) {
    return json({ error: "assets_not_ready" }, 409);
  }
  const attachmentBytes = snapshot.assets.reduce(
    (sum, asset) => sum + (asset.discord_bytes ?? 0),
    0,
  );
  if (attachmentBytes > MAX_DISCORD_ATTACHMENT_BYTES) {
    return json(
      {
        error: "discord_attachment_budget",
        attachmentBytes,
        budgetBytes: MAX_DISCORD_ATTACHMENT_BYTES,
      },
      413,
    );
  }

  const tags = await forumTagIds(
    env,
    snapshot.taxonomy,
    snapshot.draft.kind,
    snapshot.topics.map(({ stable_key }) => stable_key),
  );
  if ("error" in tags) {
    return json(tags, tags.error === "discord_tags_missing" ? 409 : 502);
  }

  const expectedHash = await sha256({
    title: snapshot.draft.title,
    body: snapshot.draft.body_markdown,
    kind: snapshot.draft.kind,
    topics: snapshot.topics.map(({ stable_key }) => stable_key),
    tagIds: tags.tagIds,
    assets: snapshot.assets.map((asset) => ({
      assetId: asset.id,
      ordinal: asset.ordinal,
      alt: asset.alt,
      r2Key: asset.discord_r2_key,
      bytes: asset.discord_bytes,
      sha256: asset.discord_sha256,
    })),
  });
  const action = snapshot.draft.discord_thread_id
    ? "update"
    : "create";
  const createdAt = new Date().toISOString();
  const candidateInput = {
    postId,
    draftVersionId: snapshot.draft.draft_version_id,
    expectedRevision: snapshot.draft.revision,
    expectedSourceHash: snapshot.draft.source_hash,
    previousVersionId: snapshot.draft.current_version_id,
    postStatus: snapshot.draft.post_status,
    action,
    expectedHash,
    tagIds: tags.tagIds,
    topicIds: snapshot.topics.map(({ id }) => id),
    assets: snapshot.assets.map((asset) => ({
      id: asset.id,
      ordinal: asset.ordinal,
      alt: asset.alt,
      publicR2Key: asset.public_r2_key,
      publicBytes: asset.public_bytes as number,
      publicSha256: asset.public_sha256 as string,
      discordR2Key: asset.discord_r2_key,
      discordBytes: asset.discord_bytes as number,
      discordSha256: asset.discord_sha256 as string,
    })),
    threadId: snapshot.draft.discord_thread_id,
    starterMessageId: snapshot.draft.discord_starter_message_id,
    createdAt,
  } as const;
  if (
    snapshot.draft.post_status === "published" &&
    snapshot.draft.discord_remote_hash === expectedHash
  ) {
    if (!await isPublishSnapshotCurrent(database, candidateInput)) {
      return json({ error: "publish_conflict" }, 409);
    }
    return json({ postId, status: "published", noChange: true });
  }

  let candidate;
  try {
    candidate = await createPublishCandidate(database, candidateInput);
  } catch {
    return json({ error: "publish_conflict" }, 409);
  }
  if (!candidate) {
    return json({ error: "publish_conflict" }, 409);
  }

  const queued = await enqueue(database, queue, candidate.jobId);
  return json(
    {
      postId,
      candidateId: candidate.candidateId,
      jobId: candidate.jobId,
      action,
      status: queued ? "queued" : "queue_failed",
      expectedHash,
      attachmentBytes,
    },
    queued ? 202 : 503,
  );
}

async function changePortfolioVisibility(
  postId: string,
  visible: boolean,
  database: StudioD1,
) {
  const changed = await setPortfolioVisibility(database, {
    postId,
    visible,
    changedAt: new Date().toISOString(),
  });
  if (!changed) return json({ error: "visibility_conflict" }, 409);
  return json({
    postId,
    action: visible ? "republish" : "unpublish",
    status: visible ? "published" : "unpublished",
  });
}

async function prepareArchive(
  postId: string,
  database: StudioD1,
  queue: StudioQueueProducer,
) {
  const post = await database.prepare(`
    SELECT id, status, current_version_id, discord_thread_id,
      discord_starter_message_id
    FROM studio_posts
    WHERE id = ? AND status IN ('published', 'unpublished')
      AND current_version_id IS NOT NULL
      AND discord_thread_id IS NOT NULL
      AND discord_starter_message_id IS NOT NULL
  `).bind(postId).first<{
    id: string;
    status: string;
    current_version_id: string;
    discord_thread_id: string;
    discord_starter_message_id: string;
  }>();
  if (!post) return json({ error: "published_mapping_not_found" }, 404);

  const createdAt = new Date().toISOString();
  let archived;
  try {
    archived = await queueArchive(database, {
      postId,
      currentVersionId: post.current_version_id,
      threadId: post.discord_thread_id,
      starterMessageId: post.discord_starter_message_id,
      createdAt,
    });
  } catch {
    return json({ error: "archive_conflict" }, 409);
  }
  if (!archived) {
    return json({ error: "archive_conflict" }, 409);
  }
  const queued = await enqueue(database, queue, archived.jobId);
  return json(
    {
      postId,
      jobId: archived.jobId,
      action: "archive",
      status: queued ? "queued" : "queue_failed",
    },
    queued ? 202 : 503,
  );
}

async function prepareRestore(
  postId: string,
  env: PhaseAEnv,
  database: StudioD1,
  queue: StudioQueueProducer,
) {
  const snapshot = await loadArchivedSnapshot(database, postId);
  if (!snapshot) return json({ error: "archive_not_found" }, 404);
  if (
    snapshot.assets.some((asset) =>
      asset.status !== "ready" ||
      !asset.public_bytes ||
      !asset.public_sha256 ||
      !asset.discord_bytes ||
      !asset.discord_sha256
    )
  ) {
    return json({ error: "assets_not_ready" }, 409);
  }
  const attachmentBytes = snapshot.assets.reduce(
    (sum, asset) => sum + (asset.discord_bytes ?? 0),
    0,
  );
  if (attachmentBytes > MAX_DISCORD_ATTACHMENT_BYTES) {
    return json({ error: "discord_attachment_budget" }, 413);
  }
  const tags = await forumTagIds(
    env,
    snapshot.taxonomy,
    snapshot.post.kind,
    snapshot.topics.map(({ stable_key }) => stable_key),
  );
  if ("error" in tags) {
    return json(tags, tags.error === "discord_tags_missing" ? 409 : 502);
  }
  const expectedHash = await sha256({
    title: snapshot.post.title,
    body: snapshot.post.body_markdown,
    kind: snapshot.post.kind,
    topics: snapshot.topics.map(({ stable_key }) => stable_key),
    tagIds: tags.tagIds,
    assets: snapshot.assets.map((asset) => ({
      assetId: asset.id,
      ordinal: asset.ordinal,
      alt: asset.alt,
      r2Key: asset.discord_r2_key,
      bytes: asset.discord_bytes,
      sha256: asset.discord_sha256,
    })),
  });
  let restored;
  try {
    restored = await queueRestore(database, {
      postId,
      currentVersionId: snapshot.post.current_version_id,
      archivedThreadId: snapshot.post.discord_thread_id,
      archivedStarterMessageId: snapshot.post.discord_starter_message_id,
      archivedAt: snapshot.post.archived_at,
      expectedHash,
      tagIds: tags.tagIds,
      assets: snapshot.assets.map((asset) => ({
        id: asset.id,
        ordinal: asset.ordinal,
        alt: asset.alt,
        publicR2Key: asset.public_r2_key,
        publicBytes: asset.public_bytes as number,
        publicSha256: asset.public_sha256 as string,
        discordR2Key: asset.discord_r2_key,
        discordBytes: asset.discord_bytes as number,
        discordSha256: asset.discord_sha256 as string,
      })),
      createdAt: new Date().toISOString(),
    });
  } catch {
    return json({ error: "restore_conflict" }, 409);
  }
  if (!restored) return json({ error: "restore_conflict" }, 409);
  const queued = await enqueue(database, queue, restored.jobId);
  return json(
    {
      postId,
      jobId: restored.jobId,
      action: "restore",
      status: queued ? "queued" : "queue_failed",
      expectedHash,
    },
    queued ? 202 : 503,
  );
}

async function retryDelivery(
  postId: string,
  jobId: string,
  database: StudioD1,
  queue: StudioQueueProducer,
) {
  const job = await database.prepare(`
    SELECT id, target, action, status, payload_json
    FROM delivery_jobs
    WHERE id = ? AND post_id = ? AND target IN ('discord', 'notification')
  `).bind(jobId, postId).first<{
    id: string;
    target: RetriableTarget;
    action: DiscordAction | "send";
    status: string;
    payload_json: string;
  }>();
  if (!job) return json({ error: "delivery_job_not_found" }, 404);
  if (!["queued", "queue_failed", "retrying", "failed", "finalizing"].includes(job.status)) {
    return json(
      { error: job.status === "outcome_unknown" ? "outcome_unknown" : "delivery_retry_conflict" },
      409,
    );
  }
  if (job.status !== "queued" && job.status !== "finalizing") {
    const changedAt = new Date().toISOString();
    const statements = [];
    let restore = false;
    if (job.target === "discord" && job.action === "create") {
      try {
        const payload = JSON.parse(job.payload_json) as unknown;
        restore = isRecord(payload) && payload.restore === true;
      } catch {
        restore = false;
      }
    }
    if (
      job.target === "discord" &&
      (job.action === "create" || job.action === "update")
    ) {
      statements.push(database.prepare(`
        UPDATE studio_posts
        SET status = ?, discord_delivery_state = 'queued', updated_at = ?
        WHERE id = ?
          AND (
            (? = 1 AND status IN ('archived', 'restoring')) OR
            (? = 0 AND status IN ('draft', 'published', 'publishing'))
          )
          AND EXISTS (
            SELECT 1 FROM delivery_jobs
            WHERE id = ? AND post_id = studio_posts.id
              AND target = 'discord' AND action = ?
              AND status IN ('queue_failed', 'retrying', 'failed')
          )
      `).bind(
        restore ? "restoring" : "publishing",
        changedAt,
        postId,
        restore ? 1 : 0,
        restore ? 1 : 0,
        jobId,
        job.action,
      ));
    }
    const jobIndex = statements.length;
    statements.push(database.prepare(`
      UPDATE delivery_jobs
      SET status = 'queued', error_code = NULL, last_error = NULL,
        completed_at = NULL, updated_at = ?
      WHERE id = ? AND post_id = ?
        AND status IN ('queue_failed', 'retrying', 'failed')
        AND (? = 'notification' OR EXISTS (
          SELECT 1 FROM studio_posts
          WHERE studio_posts.id = delivery_jobs.post_id
            AND studio_posts.status = ?
        ))
    `).bind(
      changedAt,
      jobId,
      postId,
      job.target,
      restore ? "restoring" : "publishing",
    ));
    const updated = await database.batch(statements);
    if (
      updated[jobIndex]?.meta?.changes !== 1 ||
      (jobIndex === 1 && updated[0]?.meta?.changes !== 1)
    ) {
      return json({ error: "delivery_retry_conflict" }, 409);
    }
  }
  const queued = await enqueue(
    database,
    queue,
    jobId,
    job.target === "notification" ? "notification_send" : "discord_delivery",
  );
  const status = job.status === "finalizing"
    ? "finalizing"
    : queued
    ? "queued"
    : "queue_failed";
  return json(
    { postId, jobId, target: job.target, action: job.action, status },
    queued ? 202 : 503,
  );
}

async function reconcileDelivery(
  postId: string,
  jobId: string,
  database: StudioD1,
  queue: StudioQueueProducer,
) {
  const job = await loadDeliveryJob(database, jobId);
  if (!job || job.post_id !== postId) {
    return json({ error: "delivery_job_not_found" }, 404);
  }
  if (job.status !== "outcome_unknown") {
    return json({ error: "delivery_reconcile_conflict" }, 409);
  }
  if (job.action !== "update") {
    return json({ error: "create_mapping_requires_manual_review" }, 409);
  }
  const payload = parseDeliveryPayload(job);
  if (
    !payload ||
    !payload.previousVersionId ||
    !payload.threadId ||
    !payload.starterMessageId
  ) {
    return json({ error: "delivery_payload_invalid" }, 409);
  }

  const changedAt = new Date().toISOString();
  const transitioned = await database.batch([
    database.prepare(`
      UPDATE studio_posts
      SET status = 'publishing', discord_delivery_state = 'verifying', updated_at = ?
      WHERE id = ? AND status = 'published' AND current_version_id = ?
        AND discord_thread_id = ? AND discord_starter_message_id = ?
        AND EXISTS (
          SELECT 1 FROM delivery_jobs
          WHERE id = ? AND post_id = studio_posts.id
            AND target = 'discord' AND action = 'update'
            AND status = 'outcome_unknown'
        )
    `).bind(
      changedAt,
      postId,
      payload.previousVersionId,
      payload.threadId,
      payload.starterMessageId,
      jobId,
    ),
    database.prepare(`
      UPDATE delivery_jobs
      SET status = 'verifying', remote_id = ?, remote_aux_id = ?,
        error_code = NULL, last_error = NULL, completed_at = NULL, updated_at = ?
      WHERE id = ? AND post_id = ? AND target = 'discord' AND action = 'update'
        AND status = 'outcome_unknown'
        AND EXISTS (
          SELECT 1 FROM studio_posts
          WHERE id = ? AND status = 'publishing' AND current_version_id = ?
            AND discord_thread_id = ? AND discord_starter_message_id = ?
        )
    `).bind(
      payload.threadId,
      payload.starterMessageId,
      changedAt,
      jobId,
      postId,
      postId,
      payload.previousVersionId,
      payload.threadId,
      payload.starterMessageId,
    ),
  ]);
  if (
    transitioned[0]?.meta?.changes !== 1 ||
    transitioned[1]?.meta?.changes !== 1
  ) {
    return json({ error: "delivery_reconcile_conflict" }, 409);
  }

  try {
    await queue.send({ type: "discord_delivery", jobId });
  } catch {
    const failedAt = new Date().toISOString();
    await database.batch([
      database.prepare(`
        UPDATE delivery_jobs
        SET status = 'outcome_unknown', error_code = 'reconcile_queue_failed',
          last_error = 'reconcile_queue_failed', completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'verifying'
      `).bind(failedAt, failedAt, jobId),
      database.prepare(`
        UPDATE studio_posts
        SET status = 'published', discord_delivery_state = 'outcome_unknown',
          updated_at = ?
        WHERE id = ? AND status = 'publishing' AND current_version_id = ?
          AND EXISTS (
            SELECT 1 FROM delivery_jobs
            WHERE id = ? AND status = 'outcome_unknown'
          )
      `).bind(failedAt, postId, payload.previousVersionId, jobId),
    ]);
    return json({ error: "reconcile_queue_failed" }, 503);
  }
  return json({ postId, jobId, action: "reconcile", status: "verifying" }, 202);
}

async function readStatus(request: Request, database: StudioD1) {
  const postId = new URL(request.url).searchParams.get("postId");
  if (!postId || !uuidPattern.test(postId)) {
    return json({ error: "invalid_post_id" }, 400);
  }
  const post = await database.prepare(`
    SELECT id, status, draft_version_id, current_version_id,
      discord_thread_id, discord_delivery_state, discord_remote_hash,
      discord_checked_at
    FROM studio_posts
    WHERE id = ?
  `).bind(postId).first<StatusRow>();
  if (!post) return json({ error: "post_not_found" }, 404);
  const summary = post.draft_version_id
    ? await database.prepare(`
        SELECT count(*) AS asset_count,
          sum(CASE WHEN asset.status != 'ready' THEN 1 ELSE 0 END) AS not_ready_count,
          coalesce(sum(asset.discord_bytes), 0) AS discord_bytes
        FROM studio_post_version_assets AS selected
        JOIN studio_assets AS asset ON asset.id = selected.asset_id
        WHERE selected.version_id = ?
      `).bind(post.draft_version_id).first<AssetSummary>()
    : null;
  const latest = await database.prepare(`
    SELECT id, target, action, status, attempts, error_code, updated_at
    FROM delivery_jobs
    WHERE post_id = ? AND target = 'discord'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).bind(postId).first<JobStatusRow>();
  const notification = await database.prepare(`
    SELECT id, target, action, status, attempts, error_code, updated_at
    FROM delivery_jobs
    WHERE post_id = ? AND target = 'notification'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).bind(postId).first<JobStatusRow>();
  const assetCount = Number(summary?.asset_count ?? 0);
  const notReadyCount = Number(summary?.not_ready_count ?? 0);
  const discordBytes = Number(summary?.discord_bytes ?? 0);
  return json({
    postId,
    postStatus: post.status,
    mode: post.discord_thread_id ? "update" : "create",
    threadId: post.discord_thread_id,
    hasCurrentVersion: post.current_version_id !== null,
    discordDeliveryState: post.discord_delivery_state,
    discordCheckedAt: post.discord_checked_at,
    remoteHash: post.discord_remote_hash,
    assets: { count: assetCount, notReadyCount, discordBytes },
    budgetBytes: MAX_DISCORD_ATTACHMENT_BYTES,
    canPublish: ["draft", "published"].includes(post.status) &&
      latest?.status !== "outcome_unknown" &&
      notReadyCount === 0 && discordBytes <= MAX_DISCORD_ATTACHMENT_BYTES,
    canUnpublish: post.status === "published" && Boolean(post.current_version_id),
    canRepublish: post.status === "unpublished" && Boolean(post.current_version_id),
    canArchive: ["published", "unpublished"].includes(post.status) &&
      Boolean(post.discord_thread_id),
    canRestore: post.status === "archived" && Boolean(post.current_version_id),
    canPurge: ["archived", "purging"].includes(post.status),
    canDelete: ["published", "unpublished"].includes(post.status) &&
      Boolean(post.discord_thread_id),
    latestJob: latest
      ? {
          jobId: latest.id,
          target: latest.target,
          action: latest.action,
          status: latest.status,
          attempts: latest.attempts,
          error: latest.error_code,
          updatedAt: latest.updated_at,
        }
      : null,
    notificationJob: notification
      ? {
          jobId: notification.id,
          target: notification.target,
          action: notification.action,
          status: notification.status,
          attempts: notification.attempts,
          error: notification.error_code,
          updatedAt: notification.updated_at,
        }
      : null,
  });
}

export async function handleStudioPublishRequest(
  request: Request,
  env: PhaseAEnv,
) {
  const database = env.STUDIO_DB;
  const queue = env.PUBLISH_QUEUE;
  if (!database || !queue) return json({ error: "publish_unavailable" }, 503);
  try {
    if (request.method === "GET") return readStatus(request, database);
    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, POST" },
      });
    }
    const input = await parseInput(request);
    if (typeof input === "string") {
      return json({ error: input }, input === "request_too_large" ? 413 : 400);
    }
    if (input.action === "publish") {
      return await preparePublish(input.postId, env, database, queue);
    }
    if (input.action === "unpublish" || input.action === "republish") {
      return await changePortfolioVisibility(
        input.postId,
        input.action === "republish",
        database,
      );
    }
    if (input.action === "archive" || input.action === "delete") {
      return await prepareArchive(input.postId, database, queue);
    }
    if (input.action === "restore") {
      return await prepareRestore(input.postId, env, database, queue);
    }
    if (input.action === "purge") {
      return await queueStudioPostPurge(
        input.postId,
        input.title as string,
        env,
        database,
        queue,
      );
    }
    if (input.action === "reconcile") {
      return await reconcileDelivery(
        input.postId,
        input.jobId as string,
        database,
        queue,
      );
    }
    return await retryDelivery(
      input.postId,
      input.jobId as string,
      database,
      queue,
    );
  } catch {
    return json({ error: "publish_unavailable" }, 503);
  }
}

export type StudioQueueOutcome =
  | { action: "ack" }
  | { action: "retry"; delaySeconds?: number };

type DeliveryJob = {
  id: string;
  post_id: string;
  version_id: string | null;
  action: DiscordAction;
  payload_json: string;
  status: string;
  expected_hash: string | null;
  remote_id: string | null;
  remote_aux_id: string | null;
  post_status: string;
  current_version_id: string | null;
  discord_thread_id: string | null;
  discord_starter_message_id: string | null;
  title: string | null;
  body_markdown: string | null;
};

type DeliveryAsset = {
  id: string;
  status: string;
  ordinal: number;
  alt: string;
  public_r2_key: string;
  public_bytes: number;
  public_sha256: string;
  discord_r2_key: string;
  discord_bytes: number;
  discord_sha256: string;
};

type LoadedAttachment = DeliveryAsset & {
  bytes: ArrayBuffer;
  filename: string;
};

async function loadDeliveryJob(database: StudioD1, jobId: string) {
  return database.prepare(`
    SELECT job.id, job.post_id, job.version_id, job.action, job.payload_json,
      job.status, job.expected_hash, job.remote_id, job.remote_aux_id,
      post.status AS post_status, post.current_version_id,
      post.discord_thread_id, post.discord_starter_message_id,
      version.title, version.body_markdown
    FROM delivery_jobs AS job
    JOIN studio_posts AS post ON post.id = job.post_id
    LEFT JOIN studio_post_versions AS version ON version.id = job.version_id
    WHERE job.id = ? AND job.target = 'discord'
  `).bind(jobId).first<DeliveryJob>();
}

function parsePayloadAssets(value: unknown): PublishCandidateAsset[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const assets: PublishCandidateAsset[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !uuidPattern.test(item.id) ||
      typeof item.ordinal !== "number" ||
      !Number.isSafeInteger(item.ordinal) ||
      item.ordinal < 0 ||
      typeof item.alt !== "string" ||
      typeof item.publicR2Key !== "string" ||
      item.publicR2Key === "" ||
      typeof item.publicBytes !== "number" ||
      !Number.isSafeInteger(item.publicBytes) ||
      item.publicBytes < 1 ||
      typeof item.publicSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(item.publicSha256) ||
      typeof item.discordR2Key !== "string" ||
      item.discordR2Key === "" ||
      typeof item.discordBytes !== "number" ||
      !Number.isSafeInteger(item.discordBytes) ||
      item.discordBytes < 1 ||
      typeof item.discordSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(item.discordSha256)
    ) {
      return null;
    }
    assets.push({
      id: item.id,
      ordinal: item.ordinal,
      alt: item.alt,
      publicR2Key: item.publicR2Key,
      publicBytes: item.publicBytes,
      publicSha256: item.publicSha256,
      discordR2Key: item.discordR2Key,
      discordBytes: item.discordBytes,
      discordSha256: item.discordSha256,
    });
  }
  if (
    new Set(assets.map(({ id }) => id)).size !== assets.length ||
    new Set(assets.map(({ ordinal }) => ordinal)).size !== assets.length
  ) {
    return null;
  }
  return assets;
}

function parseDeliveryPayload(job: DeliveryJob) {
  try {
    const payload = JSON.parse(job.payload_json) as unknown;
    if (!isRecord(payload)) return null;
    if (job.action === "delete") {
      return typeof payload.threadId === "string" &&
          /^\d{17,20}$/.test(payload.threadId) &&
          typeof payload.starterMessageId === "string" &&
          /^\d{17,20}$/.test(payload.starterMessageId)
          ? {
            threadId: payload.threadId,
            starterMessageId: payload.starterMessageId,
            tagIds: [] as string[],
            assets: [] as PublishCandidateAsset[],
            previousVersionId: null,
            restore: false,
            archivedThreadId: null,
            archivedStarterMessageId: null,
          }
        : null;
    }
    if (
      !Array.isArray(payload.tagIds) ||
      payload.tagIds.length > 5 ||
      !payload.tagIds.every(
        (tagId) => typeof tagId === "string" && /^\d{17,20}$/.test(tagId),
      )
    ) {
      return null;
    }
    const assets = parsePayloadAssets(payload.assets);
    if (!assets) return null;
    if (job.action === "create") {
      if (payload.restore === true) {
        return typeof payload.previousVersionId === "string" &&
            uuidPattern.test(payload.previousVersionId) &&
            validDiscordId(payload.archivedThreadId) &&
            validDiscordId(payload.archivedStarterMessageId)
          ? {
              threadId: null,
              starterMessageId: null,
              tagIds: payload.tagIds as string[],
              assets,
              previousVersionId: payload.previousVersionId,
              restore: true,
              archivedThreadId: payload.archivedThreadId,
              archivedStarterMessageId: payload.archivedStarterMessageId,
            }
          : null;
      }
      return payload.previousVersionId === null
        ? {
            threadId: null,
            starterMessageId: null,
            tagIds: payload.tagIds as string[],
            assets,
            previousVersionId: null,
            restore: false,
            archivedThreadId: null,
            archivedStarterMessageId: null,
          }
        : null;
    }
    return typeof payload.previousVersionId === "string" &&
        uuidPattern.test(payload.previousVersionId) &&
        typeof payload.threadId === "string" &&
        /^\d{17,20}$/.test(payload.threadId) &&
        typeof payload.starterMessageId === "string" &&
        /^\d{17,20}$/.test(payload.starterMessageId)
      ? {
          threadId: payload.threadId,
          starterMessageId: payload.starterMessageId,
          tagIds: payload.tagIds as string[],
          assets,
          previousVersionId: payload.previousVersionId,
          restore: false,
          archivedThreadId: null,
          archivedStarterMessageId: null,
        }
      : null;
  } catch {
    return null;
  }
}

async function loadDeliveryAssets(
  database: StudioD1,
  media: StudioR2,
  job: DeliveryJob,
  expectedAssets: PublishCandidateAsset[],
) {
  if (!job.version_id) return [];
  const rows = await database.prepare(`
    SELECT asset.id, asset.status, selected.ordinal, selected.alt,
      asset.public_r2_key, asset.public_bytes, asset.public_sha256,
      asset.discord_r2_key,
      asset.discord_bytes, asset.discord_sha256
    FROM studio_post_version_assets AS selected
    JOIN studio_assets AS asset ON asset.id = selected.asset_id
    WHERE selected.version_id = ?
    ORDER BY selected.ordinal ASC, asset.id ASC
  `).bind(job.version_id).all<DeliveryAsset>();
  const assets = rows.results ?? [];
  if (
    assets.length !== expectedAssets.length ||
    assets.some((asset, index) => {
      const expected = expectedAssets[index];
      return !expected ||
        asset.id !== expected.id ||
        asset.ordinal !== expected.ordinal ||
        asset.alt !== expected.alt ||
        asset.public_r2_key !== expected.publicR2Key ||
        asset.public_bytes !== expected.publicBytes ||
        asset.public_sha256 !== expected.publicSha256 ||
        asset.discord_r2_key !== expected.discordR2Key ||
        asset.discord_bytes !== expected.discordBytes ||
        asset.discord_sha256 !== expected.discordSha256;
    })
  ) {
    throw new Error("delivery_asset_snapshot_mismatch");
  }
  const loaded: LoadedAttachment[] = [];
  for (const asset of assets) {
    if (
      asset.status !== "ready" ||
      !Number.isSafeInteger(asset.public_bytes) ||
      asset.public_bytes < 1 ||
      typeof asset.public_sha256 !== "string" ||
      !Number.isSafeInteger(asset.discord_bytes) ||
      asset.discord_bytes < 1 ||
      typeof asset.discord_sha256 !== "string"
    ) {
      throw new Error("assets_not_ready");
    }
    const [publicObject, discordObject] = await Promise.all([
      media.get(asset.public_r2_key),
      media.get(asset.discord_r2_key),
    ]);
    if (!publicObject) throw new Error("public_derivative_missing");
    if (!discordObject) throw new Error("discord_derivative_missing");
    const [publicBytes, bytes] = await Promise.all([
      publicObject.arrayBuffer(),
      discordObject.arrayBuffer(),
    ]);
    const [publicDigest, discordDigest] = await Promise.all([
      crypto.subtle.digest("SHA-256", publicBytes),
      crypto.subtle.digest("SHA-256", bytes),
    ]);
    const publicHash = Array.from(new Uint8Array(publicDigest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    const discordHash = Array.from(new Uint8Array(discordDigest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    if (
      publicBytes.byteLength !== asset.public_bytes ||
      publicHash !== asset.public_sha256
    ) {
      throw new Error("public_derivative_mismatch");
    }
    if (bytes.byteLength !== asset.discord_bytes || discordHash !== asset.discord_sha256) {
      throw new Error("discord_derivative_mismatch");
    }
    loaded.push({
      ...asset,
      bytes,
      filename: `asset-${String(asset.ordinal + 1).padStart(2, "0")}.webp`,
    });
  }
  if (
    loaded.reduce((sum, asset) => sum + asset.bytes.byteLength, 0) >
      MAX_DISCORD_ATTACHMENT_BYTES
  ) {
    throw new Error("discord_attachment_budget");
  }
  return loaded;
}

function discordHeaders(env: PhaseAEnv, jsonBody = false) {
  return {
    authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    ...(jsonBody ? { "content-type": "application/json" } : {}),
  };
}

function messagePayload(
  job: DeliveryJob,
  attachments: LoadedAttachment[],
  suppressNotifications = false,
) {
  return {
    content: job.body_markdown,
    allowed_mentions: { parse: [] },
    ...(suppressNotifications ? { flags: 1 << 12 } : {}),
    attachments: attachments.map((asset, index) => ({
      id: String(index),
      filename: asset.filename,
      description: asset.alt,
    })),
  };
}

function multipart(payload: unknown, attachments: LoadedAttachment[]) {
  const form = new FormData();
  form.set("payload_json", JSON.stringify(payload));
  attachments.forEach((asset, index) => {
    form.append(
      `files[${index}]`,
      new Blob([asset.bytes], { type: "image/webp" }),
      asset.filename,
    );
  });
  return form;
}

async function rateLimitDelay(response: Response) {
  try {
    const value = await response.json() as unknown;
    if (isRecord(value) && typeof value.retry_after === "number") {
      return Math.max(1, Math.min(900, Math.ceil(value.retry_after)));
    }
  } catch {
    // Use a conservative delay when Discord omits a valid JSON body.
  }
  const header = Number(response.headers.get("retry-after"));
  return Number.isFinite(header)
    ? Math.max(1, Math.min(900, Math.ceil(header)))
    : 5;
}

async function setJobState(
  database: StudioD1,
  jobId: string,
  status: string,
  errorCode: string | null,
) {
  const changedAt = new Date().toISOString();
  const statements = [database.prepare(`
    UPDATE delivery_jobs
    SET status = ?, error_code = ?, last_error = ?, updated_at = ?,
      completed_at = CASE WHEN ? IN ('failed', 'outcome_unknown') THEN ? ELSE NULL END
    WHERE id = ? AND target = 'discord' AND status != 'succeeded'
  `).bind(
    status,
    errorCode,
    errorCode,
    changedAt,
    status,
    changedAt,
    jobId,
  )];
  if (["failed", "outcome_unknown"].includes(status)) {
    statements.push(database.prepare(`
      UPDATE studio_posts
      SET status = CASE
          WHEN EXISTS (
            SELECT 1 FROM delivery_jobs AS restore_job
            WHERE restore_job.id = ? AND restore_job.post_id = studio_posts.id
              AND restore_job.action = 'create'
              AND json_extract(restore_job.payload_json, '$.restore') = 1
          ) THEN 'archived'
          WHEN current_version_id IS NOT NULL THEN 'published'
          WHEN ? = 'failed' THEN 'draft'
          ELSE status
        END,
        discord_delivery_state = ?, discord_checked_at = ?, updated_at = ?
      WHERE status IN ('publishing', 'restoring')
        AND EXISTS (
          SELECT 1
          FROM delivery_jobs
          WHERE id = ? AND post_id = studio_posts.id
            AND target = 'discord' AND action IN ('create', 'update')
            AND status = ?
        )
    `).bind(
      jobId,
      status,
      status,
      changedAt,
      changedAt,
      jobId,
      status,
    ));
  }
  await database.batch(statements);
}

async function classifyDiscordFailure(
  response: Response,
  database: StudioD1,
  job: DeliveryJob,
) {
  if (response.status === 429) {
    await setJobState(database, job.id, "retrying", "discord_rate_limited");
    return {
      action: "retry" as const,
      delaySeconds: await rateLimitDelay(response),
    };
  }
  if (response.status >= 500) {
    if (job.action === "delete") {
      await setJobState(database, job.id, "retrying", "discord_server_error");
      return { action: "retry" as const, delaySeconds: 5 };
    }
    await setJobState(database, job.id, "outcome_unknown", "discord_server_error");
    return { action: "ack" as const };
  }
  await setJobState(database, job.id, "failed", `discord_http_${response.status}`);
  return { action: "ack" as const };
}

function validDiscordId(value: unknown): value is string {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function responseAttachments(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.attachments)) return null;
  const attachments = value.attachments;
  if (!attachments.every((item) =>
    isRecord(item) &&
    validDiscordId(item.id) &&
    typeof item.filename === "string" &&
    typeof item.size === "number"
  )) return null;
  return attachments as Array<Record<string, unknown> & { id: string }>;
}

async function persistVerifying(
  database: StudioD1,
  job: DeliveryJob,
  threadId: string,
  starterMessageId: string,
  attachmentIds: string[],
) {
  const updated = await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'verifying', remote_id = ?, remote_aux_id = ?,
      remote_attachment_ids = ?, error_code = NULL, last_error = NULL,
      updated_at = ?
    WHERE id = ? AND status = 'processing'
  `).bind(
    threadId,
    starterMessageId,
    JSON.stringify(attachmentIds),
    new Date().toISOString(),
    job.id,
  ).run();
  if (updated.meta?.changes !== 1) throw new Error("delivery_manifest_unavailable");
}

async function createDiscordPost(
  env: PhaseAEnv,
  database: StudioD1,
  job: DeliveryJob,
  tagIds: string[],
  attachments: LoadedAttachment[],
  suppressNotifications: boolean,
) {
  const payload = {
    name: job.title,
    message: messagePayload(job, attachments, suppressNotifications),
    applied_tags: tagIds,
  };
  let response: Response;
  try {
    response = await fetch(
      `${DISCORD_API}/channels/${env.DISCORD_FORUM_CHANNEL_ID}/threads`,
      {
        method: "POST",
        headers: discordHeaders(env),
        body: multipart(payload, attachments),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    await setJobState(database, job.id, "outcome_unknown", "discord_network_unknown");
    return { action: "ack" as const };
  }
  if (!response.ok) return classifyDiscordFailure(response, database, job);
  const thread = await response.json() as unknown;
  const starter = isRecord(thread) && isRecord(thread.message) ? thread.message : null;
  const responseFiles = responseAttachments(starter);
  if (
    !isRecord(thread) ||
    !validDiscordId(thread.id) ||
    thread.parent_id !== env.DISCORD_FORUM_CHANNEL_ID ||
    !starter ||
    !validDiscordId(starter.id) ||
    !responseFiles
  ) {
    await setJobState(database, job.id, "outcome_unknown", "discord_create_response_mismatch");
    return { action: "ack" as const };
  }
  await persistVerifying(
    database,
    job,
    thread.id,
    starter.id,
    responseFiles.map(({ id }) => id),
  );
  return verifyDiscordDelivery(job.id, env, database, attachments);
}

async function updateDiscordPost(
  env: PhaseAEnv,
  database: StudioD1,
  job: DeliveryJob,
  threadId: string,
  starterMessageId: string,
  tagIds: string[],
  attachments: LoadedAttachment[],
) {
  let channelResponse: Response;
  try {
    channelResponse = await fetch(`${DISCORD_API}/channels/${threadId}`, {
      method: "PATCH",
      headers: discordHeaders(env, true),
      body: JSON.stringify({ name: job.title, applied_tags: tagIds }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    await setJobState(database, job.id, "outcome_unknown", "discord_network_unknown");
    return { action: "ack" as const };
  }
  if (!channelResponse.ok) {
    return classifyDiscordFailure(channelResponse, database, job);
  }

  let messageResponse: Response;
  try {
    messageResponse = await fetch(
      `${DISCORD_API}/channels/${threadId}/messages/${starterMessageId}`,
      {
        method: "PATCH",
        headers: discordHeaders(env),
        body: multipart(messagePayload(job, attachments), attachments),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    await setJobState(database, job.id, "outcome_unknown", "discord_network_unknown");
    return { action: "ack" as const };
  }
  if (!messageResponse.ok) {
    return classifyDiscordFailure(messageResponse, database, job);
  }
  const message = await messageResponse.json() as unknown;
  const responseFiles = responseAttachments(message);
  if (!isRecord(message) || message.id !== starterMessageId || !responseFiles) {
    await setJobState(database, job.id, "outcome_unknown", "discord_update_response_mismatch");
    return { action: "ack" as const };
  }
  await persistVerifying(
    database,
    job,
    threadId,
    starterMessageId,
    responseFiles.map(({ id }) => id),
  );
  return verifyDiscordDelivery(job.id, env, database, attachments);
}

async function deleteDiscordPost(
  env: PhaseAEnv,
  database: StudioD1,
  job: DeliveryJob,
  threadId: string,
  starterMessageId: string,
) {
  let response: Response;
  try {
    response = await fetch(`${DISCORD_API}/channels/${threadId}`, {
      method: "DELETE",
      headers: discordHeaders(env),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    await setJobState(database, job.id, "retrying", "discord_network_error");
    return { action: "retry" as const, delaySeconds: 5 };
  }
  if (!response.ok && response.status !== 404) {
    return classifyDiscordFailure(response, database, job);
  }
  await persistVerifying(database, job, threadId, starterMessageId, []);
  return verifyDiscordDelivery(job.id, env, database, []);
}

async function verificationResponse(
  response: Response,
  database: StudioD1,
  jobId: string,
): Promise<
  | { outcome: StudioQueueOutcome; value?: never }
  | { value: unknown; outcome?: never }
> {
  if (response.status === 429) {
    return {
      outcome: {
        action: "retry" as const,
        delaySeconds: await rateLimitDelay(response),
      },
    };
  }
  if (response.status === 404 || response.status >= 500) {
    return { outcome: { action: "retry" as const, delaySeconds: 5 } };
  }
  if (!response.ok) {
    await setJobState(database, jobId, "outcome_unknown", "discord_verify_failed");
    return { outcome: { action: "ack" as const } };
  }
  return { value: await response.json() as unknown };
}

function sameStrings(left: unknown, right: string[]) {
  return Array.isArray(left) &&
    left.every((value) => typeof value === "string") &&
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function attachmentsMatch(
  remote: Array<Record<string, unknown> & { id: string }>,
  expected: LoadedAttachment[],
) {
  if (remote.length !== expected.length) return false;
  const byName = new Map(remote.map((item) => [item.filename, item]));
  return expected.every((asset) => {
    const item = byName.get(asset.filename);
    return item &&
      item.size === asset.discord_bytes &&
      item.description === asset.alt;
  });
}

async function verifyDiscordDelivery(
  jobId: string,
  env: PhaseAEnv,
  database: StudioD1,
  suppliedAttachments?: LoadedAttachment[],
): Promise<StudioQueueOutcome> {
  const job = await loadDeliveryJob(database, jobId);
  if (!job || job.status !== "verifying") return { action: "ack" };
  const payload = parseDeliveryPayload(job);
  if (!payload) {
    await setJobState(database, job.id, "failed", "delivery_payload_invalid");
    return { action: "ack" };
  }
  const threadId = job.remote_id ?? payload.threadId;
  const starterMessageId = job.remote_aux_id ?? payload.starterMessageId;
  if (!threadId || !starterMessageId) {
    await setJobState(database, job.id, "outcome_unknown", "discord_mapping_missing");
    return { action: "ack" };
  }

  let threadResponse: Response;
  try {
    threadResponse = await fetch(`${DISCORD_API}/channels/${threadId}`, {
      headers: discordHeaders(env),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return { action: "retry", delaySeconds: 5 };
  }

  if (job.action === "delete") {
    if (threadResponse.status !== 404) {
      const checked = await verificationResponse(
        threadResponse,
        database,
        job.id,
      );
      if (checked.outcome) return checked.outcome;
      return { action: "retry", delaySeconds: 3 };
    }
    const finalizedAt = new Date().toISOString();
    await database.prepare(`
      UPDATE delivery_jobs
      SET status = 'finalizing', error_code = NULL, last_error = NULL,
        updated_at = ?
      WHERE id = ? AND status = 'verifying'
    `).bind(finalizedAt, job.id).run();
    return finalizeDiscordDelivery(job.id, database, env);
  }

  const checkedThread = await verificationResponse(
    threadResponse,
    database,
    job.id,
  );
  if (checkedThread.outcome) return checkedThread.outcome;
  let messageResponse: Response;
  try {
    messageResponse = await fetch(
      `${DISCORD_API}/channels/${threadId}/messages/${starterMessageId}`,
      {
        headers: discordHeaders(env),
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch {
    return { action: "retry", delaySeconds: 5 };
  }
  const checkedMessage = await verificationResponse(
    messageResponse,
    database,
    job.id,
  );
  if (checkedMessage.outcome) return checkedMessage.outcome;

  const thread = checkedThread.value;
  const message = checkedMessage.value;
  const attachments = suppliedAttachments ?? (
    env.STUDIO_MEDIA
      ? await loadDeliveryAssets(database, env.STUDIO_MEDIA, job, payload.assets)
      : []
  );
  const remoteFiles = responseAttachments(message);
  if (
    !isRecord(thread) ||
    thread.id !== threadId ||
    thread.parent_id !== env.DISCORD_FORUM_CHANNEL_ID ||
    thread.name !== job.title ||
    !sameStrings(thread.applied_tags, payload.tagIds) ||
    !isRecord(message) ||
    message.id !== starterMessageId ||
    message.channel_id !== threadId ||
    message.content !== job.body_markdown ||
    (payload.restore && (
      typeof message.flags !== "number" || (message.flags & (1 << 12)) === 0
    )) ||
    !remoteFiles ||
    !attachmentsMatch(remoteFiles, attachments)
  ) {
    await setJobState(database, job.id, "outcome_unknown", "discord_verify_mismatch");
    return { action: "ack" };
  }

  const updatedAt = new Date().toISOString();
  const verified = await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'finalizing', delivered_hash = expected_hash,
      remote_attachment_ids = ?, error_code = NULL, last_error = NULL,
      updated_at = ?
    WHERE id = ? AND status = 'verifying'
  `).bind(
    JSON.stringify(remoteFiles.map(({ id }) => id)),
    updatedAt,
    job.id,
  ).run();
  if (verified.meta?.changes !== 1) throw new Error("delivery_manifest_unavailable");
  return finalizeDiscordDelivery(job.id, database, env);
}

async function finalizeDiscordDelivery(
  jobId: string,
  database: StudioD1,
  env: PhaseAEnv,
): Promise<StudioQueueOutcome> {
  const job = await loadDeliveryJob(database, jobId);
  if (!job || job.status !== "finalizing") return { action: "ack" };
  const payload = parseDeliveryPayload(job);
  if (!payload) {
    await setJobState(database, job.id, "outcome_unknown", "delivery_payload_invalid");
    return { action: "ack" };
  }
  const completedAt = new Date().toISOString();
  if (job.action === "delete") {
    if (
      !job.version_id ||
      !job.remote_id ||
      !job.remote_aux_id ||
      job.remote_id !== payload.threadId ||
      job.remote_aux_id !== payload.starterMessageId
    ) {
      await setJobState(database, job.id, "outcome_unknown", "discord_mapping_missing");
      return { action: "ack" };
    }
    const finalized = await finalizeVerifiedDelivery(database, {
      kind: "archive",
      jobId: job.id,
      postId: job.post_id,
      currentVersionId: job.version_id,
      remoteThreadId: job.remote_id,
      remoteStarterMessageId: job.remote_aux_id,
      completedAt,
    });
    if (!finalized) {
      throw new Error("delivery_finalization_failed");
    }
    return { action: "ack" };
  }

  if (!job.version_id || !job.remote_id || !job.remote_aux_id || !job.expected_hash) {
    await setJobState(database, job.id, "outcome_unknown", "discord_mapping_missing");
    return { action: "ack" };
  }
  if (
    (job.action === "create" && !payload.restore && payload.previousVersionId !== null) ||
    (job.action === "create" && payload.restore && (
      payload.previousVersionId === null ||
      payload.archivedThreadId !== job.discord_thread_id ||
      payload.archivedStarterMessageId !== job.discord_starter_message_id
    )) ||
    (job.action === "update" && (
      payload.threadId !== job.remote_id ||
      payload.starterMessageId !== job.remote_aux_id
    ))
  ) {
    await setJobState(database, job.id, "outcome_unknown", "discord_mapping_missing");
    return { action: "ack" };
  }
  if (!env.STUDIO_MEDIA) throw new Error("asset_storage_unavailable");
  await loadDeliveryAssets(database, env.STUDIO_MEDIA, job, payload.assets);
  const finalized = payload.restore
    ? await finalizeVerifiedDelivery(database, {
        kind: "restore",
        jobId: job.id,
        postId: job.post_id,
        currentVersionId: job.version_id,
        archivedThreadId: payload.archivedThreadId as string,
        archivedStarterMessageId: payload.archivedStarterMessageId as string,
        remoteThreadId: job.remote_id,
        remoteStarterMessageId: job.remote_aux_id,
        expectedHash: job.expected_hash,
        completedAt,
      })
    : await finalizeVerifiedDelivery(database, {
        kind: "publish",
        jobId: job.id,
        postId: job.post_id,
        candidateVersionId: job.version_id,
        previousVersionId: payload.previousVersionId,
        action: job.action,
        remoteThreadId: job.remote_id,
        remoteStarterMessageId: job.remote_aux_id,
        expectedHash: job.expected_hash,
        completedAt,
      });
  if (!finalized) {
    throw new Error("delivery_finalization_failed");
  }
  if (job.action === "create" && !payload.restore) {
    const notification = await database.prepare(`
      SELECT id
      FROM delivery_jobs
      WHERE post_id = ? AND version_id = ?
        AND target = 'notification' AND action = 'send'
        AND dedupe_key = ? AND status = 'queued'
    `).bind(
      job.post_id,
      job.version_id,
      `notify:${job.post_id}:${job.version_id}`,
    ).first<{ id: string }>();
    if (!notification || !env.PUBLISH_QUEUE) {
      throw new Error("notification_outbox_unavailable");
    }
    await enqueue(
      database,
      env.PUBLISH_QUEUE,
      notification.id,
      "notification_send",
    );
  }
  return { action: "ack" };
}

export async function processStudioDiscordJob(
  jobId: string,
  env: PhaseAEnv,
): Promise<StudioQueueOutcome> {
  if (!uuidPattern.test(jobId)) return { action: "ack" };
  const database = env.STUDIO_DB;
  const media = env.STUDIO_MEDIA;
  if (!database || !media) throw new Error("publish_unavailable");
  let job = await loadDeliveryJob(database, jobId);
  if (!job || ["succeeded", "failed", "outcome_unknown"].includes(job.status)) {
    return { action: "ack" };
  }
  if (job.status === "finalizing") {
    await database.prepare(`
      UPDATE delivery_jobs SET attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status = 'finalizing'
    `).bind(new Date().toISOString(), job.id).run();
    return finalizeDiscordDelivery(job.id, database, env);
  }
  if (job.status === "verifying") {
    await database.prepare(`
      UPDATE delivery_jobs SET attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status = 'verifying'
    `).bind(new Date().toISOString(), job.id).run();
    return verifyDiscordDelivery(job.id, env, database);
  }
  if (job.status === "processing" && job.action !== "delete") {
    return { action: "retry", delaySeconds: 5 };
  }

  const payload = parseDeliveryPayload(job);
  if (!payload || (job.action !== "delete" && (!job.title || !job.body_markdown))) {
    await setJobState(database, job.id, "failed", "delivery_payload_invalid");
    return { action: "ack" };
  }
  const attachments = job.action === "delete"
    ? []
    : await loadDeliveryAssets(database, media, job, payload.assets);
  const claimStatuses = job.action === "delete"
    ? "('queued', 'retrying', 'processing')"
    : "('queued', 'retrying')";
  const claimed = await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'processing', attempts = attempts + 1,
      error_code = NULL, last_error = NULL, updated_at = ?
    WHERE id = ? AND status IN ${claimStatuses}
  `).bind(new Date().toISOString(), job.id).run();
  if (claimed.meta?.changes !== 1) return { action: "ack" };
  job = { ...job, status: "processing" };

  if (job.action === "create") {
    return createDiscordPost(
      env,
      database,
      job,
      payload.tagIds,
      attachments,
      payload.restore,
    );
  }
  if (job.action === "update") {
    if (!payload.threadId || !payload.starterMessageId) {
      await setJobState(database, job.id, "failed", "discord_mapping_missing");
      return { action: "ack" };
    }
    return updateDiscordPost(
      env,
      database,
      job,
      payload.threadId,
      payload.starterMessageId,
      payload.tagIds,
      attachments,
    );
  }
  return deleteDiscordPost(
    env,
    database,
    job,
    payload.threadId as string,
    payload.starterMessageId as string,
  );
}

type NotificationJob = {
  id: string;
  dedupe_key: string;
  post_id: string;
  version_id: string;
  payload_json: string;
  status: string;
  attempts: number;
  post_status: string;
  current_version_id: string | null;
};

async function loadNotificationJob(database: StudioD1, jobId: string) {
  return database.prepare(`
    SELECT job.id, job.dedupe_key, job.post_id, job.version_id,
      job.payload_json, job.status, job.attempts,
      post.status AS post_status, post.current_version_id
    FROM delivery_jobs AS job
    JOIN studio_posts AS post ON post.id = job.post_id
    WHERE job.id = ? AND job.target = 'notification' AND job.action = 'send'
  `).bind(jobId).first<NotificationJob>();
}

function notificationThreadId(job: NotificationJob) {
  try {
    const payload = JSON.parse(job.payload_json) as unknown;
    if (
      !isRecord(payload) ||
      Object.keys(payload).some((key) => key !== "threadId") ||
      !validDiscordId(payload.threadId)
    ) {
      return null;
    }
    return payload.threadId;
  } catch {
    return null;
  }
}

async function notificationNonce(dedupeKey: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(dedupeKey),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("").slice(0, 25);
}

async function setNotificationState(
  database: StudioD1,
  jobId: string,
  status: string,
  errorCode: string | null,
  remoteId: string | null = null,
) {
  const completedAt = ["succeeded", "failed", "outcome_unknown"].includes(status)
    ? new Date().toISOString()
    : null;
  await database.prepare(`
    UPDATE delivery_jobs
    SET status = ?, error_code = ?, last_error = ?, remote_id = coalesce(?, remote_id),
      updated_at = ?, completed_at = ?
    WHERE id = ? AND target = 'notification' AND action = 'send'
      AND status != 'succeeded'
  `).bind(
    status,
    errorCode,
    errorCode,
    remoteId,
    new Date().toISOString(),
    completedAt,
    jobId,
  ).run();
}

export async function processStudioNotificationJob(
  jobId: string,
  env: PhaseAEnv,
): Promise<StudioQueueOutcome> {
  if (!uuidPattern.test(jobId)) return { action: "ack" };
  const database = env.STUDIO_DB;
  if (!database) throw new Error("notification_unavailable");
  const job = await loadNotificationJob(database, jobId);
  if (!job || ["succeeded", "failed", "outcome_unknown"].includes(job.status)) {
    return { action: "ack" };
  }
  if (
    !job.current_version_id ||
    !["published", "publishing"].includes(job.post_status)
  ) {
    await setNotificationState(
      database,
      job.id,
      "failed",
      "notification_post_not_public",
    );
    return { action: "ack" };
  }
  const threadId = notificationThreadId(job);
  if (!threadId) {
    await setNotificationState(
      database,
      job.id,
      "failed",
      "notification_payload_invalid",
    );
    return { action: "ack" };
  }
  const claimed = await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'processing', attempts = attempts + 1,
      error_code = NULL, last_error = NULL, updated_at = ?
    WHERE id = ? AND target = 'notification' AND action = 'send'
      AND status IN ('queued', 'retrying')
  `).bind(new Date().toISOString(), job.id).run();
  if (claimed.meta?.changes !== 1) return { action: "ack" };

  const content = `<@&${env.DISCORD_NOTIFY_ROLE_ID}> 새 글이 올라왔어요.\n` +
    `https://discord.com/channels/${env.DISCORD_GUILD_ID}/${threadId}`;
  let response: Response;
  try {
    response = await fetch(
      `${DISCORD_API}/channels/${env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID}/messages`,
      {
        method: "POST",
        headers: discordHeaders(env, true),
        body: JSON.stringify({
          content,
          allowed_mentions: { roles: [env.DISCORD_NOTIFY_ROLE_ID] },
          nonce: await notificationNonce(job.dedupe_key),
          enforce_nonce: true,
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch {
    await setNotificationState(
      database,
      job.id,
      "outcome_unknown",
      "notification_network_unknown",
    );
    return { action: "ack" };
  }
  if (response.status === 429) {
    await setNotificationState(
      database,
      job.id,
      "retrying",
      "notification_rate_limited",
    );
    return { action: "retry", delaySeconds: await rateLimitDelay(response) };
  }
  if (response.status >= 500) {
    await setNotificationState(
      database,
      job.id,
      "outcome_unknown",
      "notification_server_unknown",
    );
    return { action: "ack" };
  }
  if (!response.ok) {
    await setNotificationState(
      database,
      job.id,
      "failed",
      `notification_http_${response.status}`,
    );
    return { action: "ack" };
  }
  const message = await response.json() as unknown;
  if (
    !isRecord(message) ||
    !validDiscordId(message.id) ||
    message.channel_id !== env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID ||
    message.content !== content
  ) {
    await setNotificationState(
      database,
      job.id,
      "outcome_unknown",
      "notification_response_mismatch",
    );
    return { action: "ack" };
  }
  await setNotificationState(database, job.id, "succeeded", null, message.id);
  return { action: "ack" };
}

export async function recoverStudioNotificationQueueFailure(
  jobId: string,
  env: PhaseAEnv,
  terminal: boolean,
): Promise<StudioQueueOutcome> {
  const database = env.STUDIO_DB;
  if (!database) return { action: "retry", delaySeconds: 5 };
  const job = await loadNotificationJob(database, jobId);
  if (!job || ["succeeded", "failed", "outcome_unknown"].includes(job.status)) {
    return { action: "ack" };
  }
  if (job.status === "processing") {
    await setNotificationState(
      database,
      job.id,
      "outcome_unknown",
      "notification_outcome_unknown",
    );
    return { action: "ack" };
  }
  if (terminal) {
    await setNotificationState(
      database,
      job.id,
      "failed",
      "notification_retry_exhausted",
    );
    return { action: "ack" };
  }
  return { action: "retry", delaySeconds: 5 };
}

export async function recoverStudioDiscordQueueFailure(
  jobId: string,
  env: PhaseAEnv,
  terminal: boolean,
): Promise<StudioQueueOutcome> {
  const database = env.STUDIO_DB;
  if (!database) return { action: "retry", delaySeconds: 5 };
  const job = await loadDeliveryJob(database, jobId);
  if (!job || ["succeeded", "failed", "outcome_unknown"].includes(job.status)) {
    return { action: "ack" };
  }
  if (terminal) {
    if (job.status === "finalizing") {
      await setJobState(
        database,
        job.id,
        "finalizing",
        "delivery_finalization_exhausted",
      );
      return { action: "retry" };
    }
    const terminalStatus = job.status === "verifying" ||
        (job.status === "processing" && job.action !== "delete")
      ? "outcome_unknown"
      : "failed";
    await setJobState(
      database,
      job.id,
      terminalStatus,
      "delivery_retry_exhausted",
    );
    return { action: "retry" };
  }
  if (job.status === "processing" && job.action !== "delete") {
    await setJobState(database, job.id, "outcome_unknown", "discord_outcome_unknown");
    return { action: "ack" };
  }
  if (job.status === "processing" && job.action === "delete") {
    await setJobState(database, job.id, "retrying", "discord_delete_retry");
  }
  return { action: "retry", delaySeconds: 5 };
}
