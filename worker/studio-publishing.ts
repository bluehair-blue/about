import type {
  PhaseAEnv,
  StudioD1,
  StudioQueueProducer,
  StudioR2,
} from "./phase-a-env";
import { MAX_DISCORD_ATTACHMENT_BYTES } from "./studio-assets";
import {
  createPublishCandidate,
  finalizeVerifiedDelivery,
  isPublishSnapshotCurrent,
  queueArchive,
  type PublishCandidateAsset,
} from "./studio-domain";

const DISCORD_API = "https://discord.com/api/v10";
const MAX_REQUEST_BYTES = 4_096;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PublishAction = "publish" | "delete" | "retry";
type DiscordAction = "create" | "update" | "delete";

type PublishInput = {
  action: PublishAction;
  postId: string;
  jobId: string | null;
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

type PublishAsset = {
  id: string;
  status: string;
  ordinal: number;
  alt: string;
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
  discord_thread_id: string | null;
  discord_remote_hash: string | null;
};

type AssetSummary = {
  asset_count: number;
  not_ready_count: number;
  discord_bytes: number;
};

type JobStatusRow = {
  id: string;
  action: DiscordAction;
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
  if (
    (action !== "publish" && action !== "delete" && action !== "retry") ||
    typeof postId !== "string" ||
    !uuidPattern.test(postId) ||
    (jobId !== null && (typeof jobId !== "string" || !uuidPattern.test(jobId))) ||
    (action === "retry" && jobId === null) ||
    (action !== "retry" && jobId !== null) ||
    Object.keys(value).some((key) => !["action", "postId", "jobId"].includes(key))
  ) {
    return "invalid_publish_request";
  }
  return { action, postId, jobId };
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

async function forumTagIds(
  env: PhaseAEnv,
  database: StudioD1,
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
      available.set(value.name.normalize("NFC"), value.id);
    }
  }

  const updates = taxonomy.flatMap((item) => {
    const tagId = available.get(item.label.normalize("NFC"));
    return tagId && tagId !== item.discord_tag_id
      ? [database.prepare(`
          UPDATE studio_taxonomy
          SET discord_tag_id = ?, updated_at = ?
          WHERE id = ? AND status = 'active'
        `).bind(tagId, new Date().toISOString(), item.id)]
      : [];
  });
  if (updates.length > 0) await database.batch(updates);

  const selectedKeys = new Set([kind, ...topics]);
  const selected = taxonomy.filter((item) => selectedKeys.has(item.stable_key));
  const missing = selected
    .filter((item) => !available.has(item.label.normalize("NFC")))
    .map((item) => item.label);
  if (missing.length > 0) {
    return { error: "discord_tags_missing", missing } as const;
  }
  return {
    tagIds: selected.map((item) => available.get(item.label.normalize("NFC")) as string),
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
) {
  try {
    await queue.send({ type: "discord_delivery", jobId });
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
    database,
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

async function prepareDelete(
  postId: string,
  database: StudioD1,
  queue: StudioQueueProducer,
) {
  const post = await database.prepare(`
    SELECT id, status, current_version_id, discord_thread_id,
      discord_starter_message_id
    FROM studio_posts
    WHERE id = ? AND status = 'published'
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
    return json({ error: "delete_conflict" }, 409);
  }
  if (!archived) {
    return json({ error: "delete_conflict" }, 409);
  }
  const queued = await enqueue(database, queue, archived.jobId);
  return json(
    {
      postId,
      jobId: archived.jobId,
      action: "delete",
      status: queued ? "queued" : "queue_failed",
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
    SELECT id, action, status
    FROM delivery_jobs
    WHERE id = ? AND post_id = ? AND target = 'discord'
  `).bind(jobId, postId).first<{ id: string; action: DiscordAction; status: string }>();
  if (!job) return json({ error: "delivery_job_not_found" }, 404);
  if (!["queued", "queue_failed", "retrying", "failed", "finalizing"].includes(job.status)) {
    return json(
      { error: job.status === "outcome_unknown" ? "outcome_unknown" : "delivery_retry_conflict" },
      409,
    );
  }
  if (job.status !== "queued" && job.status !== "finalizing") {
    const updated = await database.prepare(`
      UPDATE delivery_jobs
      SET status = 'queued', error_code = NULL, last_error = NULL,
        completed_at = NULL, updated_at = ?
      WHERE id = ? AND post_id = ?
        AND status IN ('queue_failed', 'retrying', 'failed')
    `).bind(new Date().toISOString(), jobId, postId).run();
    if (updated.meta?.changes !== 1) {
      return json({ error: "delivery_retry_conflict" }, 409);
    }
  }
  const queued = await enqueue(database, queue, jobId);
  const status = job.status === "finalizing"
    ? "finalizing"
    : queued
    ? "queued"
    : "queue_failed";
  return json(
    { postId, jobId, action: job.action, status },
    queued ? 202 : 503,
  );
}

async function readStatus(request: Request, database: StudioD1) {
  const postId = new URL(request.url).searchParams.get("postId");
  if (!postId || !uuidPattern.test(postId)) {
    return json({ error: "invalid_post_id" }, 400);
  }
  const post = await database.prepare(`
    SELECT id, status, draft_version_id, discord_thread_id, discord_remote_hash
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
    SELECT id, action, status, attempts, error_code, updated_at
    FROM delivery_jobs
    WHERE post_id = ? AND target = 'discord'
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
    remoteHash: post.discord_remote_hash,
    assets: { count: assetCount, notReadyCount, discordBytes },
    budgetBytes: MAX_DISCORD_ATTACHMENT_BYTES,
    canPublish: ["draft", "published"].includes(post.status) &&
      notReadyCount === 0 && discordBytes <= MAX_DISCORD_ATTACHMENT_BYTES,
    canDelete: post.status === "published" && Boolean(post.discord_thread_id),
    latestJob: latest
      ? {
          jobId: latest.id,
          action: latest.action,
          status: latest.status,
          attempts: latest.attempts,
          error: latest.error_code,
          updatedAt: latest.updated_at,
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
    if (input.action === "delete") {
      return await prepareDelete(input.postId, database, queue);
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
      return payload.previousVersionId === null
        ? {
            threadId: null,
            starterMessageId: null,
            tagIds: payload.tagIds as string[],
            assets,
            previousVersionId: null,
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
    SELECT asset.id, asset.status, selected.ordinal, selected.alt, asset.discord_r2_key,
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
      !Number.isSafeInteger(asset.discord_bytes) ||
      asset.discord_bytes < 1 ||
      typeof asset.discord_sha256 !== "string"
    ) {
      throw new Error("assets_not_ready");
    }
    const object = await media.get(asset.discord_r2_key);
    if (!object) throw new Error("discord_derivative_missing");
    const bytes = await object.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    if (bytes.byteLength !== asset.discord_bytes || hash !== asset.discord_sha256) {
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

function messagePayload(job: DeliveryJob, attachments: LoadedAttachment[]) {
  return {
    content: job.body_markdown,
    allowed_mentions: { parse: [] },
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
  await database.prepare(`
    UPDATE delivery_jobs
    SET status = ?, error_code = ?, last_error = ?, updated_at = ?,
      completed_at = CASE WHEN ? IN ('failed', 'outcome_unknown') THEN ? ELSE NULL END
    WHERE id = ? AND target = 'discord' AND status != 'succeeded'
  `).bind(
    status,
    errorCode,
    errorCode,
    new Date().toISOString(),
    status,
    new Date().toISOString(),
    jobId,
  ).run();
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
) {
  const payload = {
    name: job.title,
    message: messagePayload(job, attachments),
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
    return finalizeDiscordDelivery(job.id, database);
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
  return finalizeDiscordDelivery(job.id, database);
}

async function finalizeDiscordDelivery(
  jobId: string,
  database: StudioD1,
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
    (job.action === "create" && payload.previousVersionId !== null) ||
    (job.action === "update" && (
      payload.threadId !== job.remote_id ||
      payload.starterMessageId !== job.remote_aux_id
    ))
  ) {
    await setJobState(database, job.id, "outcome_unknown", "discord_mapping_missing");
    return { action: "ack" };
  }
  const finalized = await finalizeVerifiedDelivery(database, {
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
    return finalizeDiscordDelivery(job.id, database);
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
