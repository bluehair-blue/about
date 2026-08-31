import {
  draftKinds,
  type DraftKind,
  type PostStatus,
} from "../db/schema";
import { validateStudioMarkdown } from "../lib/studio-markdown";
import type { PhaseAEnv, StudioD1 } from "./phase-a-env";
import {
  createDraftRecord,
  saveDraftRevisionCas,
} from "./studio-domain";

const MAX_REQUEST_BYTES = 16_384;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Draft = {
  postId: string | null;
  revision: number;
  title: string;
  body: string;
  kind: DraftKind;
  topics: string[];
};

type DraftRow = {
  post_id: string;
  post_status: PostStatus;
  version_id: string;
  revision: number;
  title: string;
  body_markdown: string;
  kind: DraftKind;
  updated_at: string;
};

const draftFilters = ["all", "working", "attention"] as const;
type DraftFilter = (typeof draftFilters)[number];

type DraftListRow = {
  post_id: string;
  post_status: PostStatus;
  draft_version_id: string | null;
  title: string;
  revision: number | null;
  saved_at: string;
  kind_label: string;
  topic_labels_json: string;
  current_version_id: string | null;
  discord_thread_id: string | null;
  discord_delivery_state: string | null;
  discord_checked_at: string | null;
  latest_job_status: string | null;
  latest_job_error: string | null;
  latest_job_at: string | null;
  asset_count: number;
  pending_asset_count: number;
  failed_asset_count: number;
  failed_job_status: string | null;
  failed_job_error: string | null;
  failed_job_at: string | null;
  failed_asset_at: string | null;
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

function methodNotAllowed() {
  return new Response("Method not allowed", {
    status: 405,
    headers: { allow: "GET, POST" },
  });
}

function codePointLength(value: string) {
  return Array.from(value).length;
}

function parseDraft(value: unknown): Draft | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "invalid_json_object";
  }

  const input = value as Record<string, unknown>;
  const postId = input.postId === null || input.postId === undefined
    ? null
    : input.postId;
  if (postId !== null && (typeof postId !== "string" || !uuidPattern.test(postId))) {
    return "invalid_post_id";
  }
  if (
    typeof input.revision !== "number" ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0
  ) {
    return "invalid_revision";
  }
  if ((postId === null && input.revision !== 0) || (postId !== null && input.revision < 1)) {
    return "invalid_revision";
  }
  if (typeof input.title !== "string") return "invalid_title";
  const title = input.title.normalize("NFC").trim();
  if (codePointLength(title) < 1 || codePointLength(title) > 100) {
    return "invalid_title";
  }
  if (typeof input.body !== "string") return "invalid_body";
  const body = input.body.normalize("NFC").replace(/\r\n?/gu, "\n");
  if (body.trim() === "" || codePointLength(body) > 2_000) {
    return "invalid_body";
  }
  const invalidMarkdown = validateStudioMarkdown(body);
  if (invalidMarkdown) return invalidMarkdown.code;
  if (typeof input.kind !== "string" || !draftKinds.includes(input.kind as DraftKind)) {
    return "invalid_kind";
  }
  if (!Array.isArray(input.topics) || input.topics.length > 4) {
    return "invalid_topics";
  }
  const suppliedTopics = input.topics;
  if (
    suppliedTopics.some(
      (topic) => typeof topic !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(topic),
    ) ||
    new Set(suppliedTopics).size !== suppliedTopics.length
  ) {
    return "invalid_topics";
  }

  return {
    postId,
    revision: input.revision,
    title,
    body,
    kind: input.kind as DraftKind,
    topics: suppliedTopics as string[],
  };
}

async function activeTopics(
  database: StudioD1,
  topics: string[],
  postId: string | null,
) {
  if (topics.length === 0) return [];
  const placeholders = topics.map(() => "?").join(", ");
  const rows = await database.prepare(`
    SELECT taxonomy.stable_key
    FROM studio_taxonomy AS taxonomy
    WHERE taxonomy.dimension = 'topic'
      AND taxonomy.stable_key IN (${placeholders})
      AND (
        taxonomy.status = 'active'
        OR EXISTS (
          SELECT 1
          FROM studio_posts AS post
          JOIN studio_post_version_topics AS selected
            ON selected.version_id = post.draft_version_id
          WHERE post.id = ? AND selected.taxonomy_id = taxonomy.id
        )
      )
    ORDER BY taxonomy.ordinal ASC, taxonomy.id ASC
  `).bind(...topics, postId).all<{ stable_key: string }>();
  return (rows.results ?? []).map(({ stable_key }) => stable_key);
}

async function readDraft(request: Request, database: StudioD1) {
  const requestedPostId = new URL(request.url).searchParams.get("postId");
  if (requestedPostId !== null && !uuidPattern.test(requestedPostId)) {
    return json({ error: "invalid_post_id" }, 400);
  }

  const row = requestedPostId
    ? await database.prepare(`
        SELECT post.id AS post_id, post.status AS post_status,
          version.id AS version_id, version.revision, version.title,
          version.body_markdown, version.kind, version.updated_at
        FROM studio_posts AS post
        JOIN studio_post_versions AS version ON version.id = post.draft_version_id
        WHERE post.id = ? AND post.status != 'purged'
          AND version.state = 'draft'
      `).bind(requestedPostId).first<DraftRow>()
    : await database.prepare(`
        SELECT post.id AS post_id, post.status AS post_status,
          version.id AS version_id, version.revision, version.title,
          version.body_markdown, version.kind, version.updated_at
        FROM studio_posts AS post
        JOIN studio_post_versions AS version ON version.id = post.draft_version_id
        WHERE post.status IN ('draft', 'published') AND version.state = 'draft'
        ORDER BY post.updated_at DESC, post.id ASC
        LIMIT 1
      `).first<DraftRow>();
  if (!row) {
    return requestedPostId
      ? json({ error: "draft_not_found" }, 404)
      : new Response(null, { status: 204 });
  }

  const topicRows = await database.prepare(`
    SELECT taxonomy.stable_key
    FROM studio_post_version_topics AS selected
    JOIN studio_taxonomy AS taxonomy ON taxonomy.id = selected.taxonomy_id
    WHERE selected.version_id = ? AND taxonomy.dimension = 'topic'
    ORDER BY taxonomy.ordinal ASC
  `).bind(row.version_id).all<{ stable_key: string }>();

  return json({
    postId: row.post_id,
    versionId: row.version_id,
    revision: row.revision,
    title: row.title,
    body: row.body_markdown,
    kind: row.kind,
    topics: (topicRows.results ?? []).map(({ stable_key }) => stable_key),
    savedAt: row.updated_at,
    postStatus: row.post_status,
    editable: row.post_status === "draft" || row.post_status === "published",
  });
}

function attentionReason(row: DraftListRow) {
  if (row.post_status === "withheld") return "post_withheld";
  if (row.failed_job_status === "outcome_unknown") {
    return "delivery_outcome_unknown";
  }
  if (row.failed_job_status === "queue_failed") return "delivery_queue_failed";
  if (row.failed_job_status === "failed") {
    return row.failed_job_error || "delivery_failed";
  }
  if (row.failed_asset_count > 0) return "asset_failed";
  if (row.discord_delivery_state === "drift") return "discord_drift";
  return null;
}

async function listDrafts(database: StudioD1, filter: DraftFilter) {
  const rows = await database.prepare(`
    SELECT post.id AS post_id, post.status AS post_status,
      draft.id AS draft_version_id,
      coalesce(draft.title, current.title, '제목 없음') AS title,
      draft.revision,
      coalesce(draft.updated_at, current.updated_at, post.updated_at) AS saved_at,
      coalesce((
        SELECT taxonomy.label
        FROM studio_taxonomy AS taxonomy
        WHERE taxonomy.dimension = 'kind'
          AND taxonomy.stable_key = coalesce(draft.kind, current.kind)
      ), coalesce(draft.kind, current.kind, '분류 없음')) AS kind_label,
      coalesce((
        SELECT json_group_array(ordered.label)
        FROM (
          SELECT taxonomy.label
          FROM studio_post_version_topics AS selected
          JOIN studio_taxonomy AS taxonomy ON taxonomy.id = selected.taxonomy_id
          WHERE selected.version_id = coalesce(draft.id, current.id)
          ORDER BY taxonomy.ordinal ASC, taxonomy.id ASC
        ) AS ordered
      ), '[]') AS topic_labels_json,
      post.current_version_id,
      post.discord_thread_id,
      post.discord_delivery_state,
      post.discord_checked_at,
      latest_job.status AS latest_job_status,
      latest_job.error_code AS latest_job_error,
      latest_job.updated_at AS latest_job_at,
      (SELECT count(*) FROM studio_assets AS asset
        WHERE asset.post_id = post.id AND asset.status != 'orphan') AS asset_count,
      (SELECT count(*) FROM studio_assets AS asset
        WHERE asset.post_id = post.id
          AND asset.status IN ('uploading', 'processing')) AS pending_asset_count,
      (SELECT count(*) FROM studio_assets AS asset
        WHERE asset.post_id = post.id AND asset.status = 'failed') AS failed_asset_count,
      (SELECT job.status FROM delivery_jobs AS job
        WHERE job.post_id = post.id
          AND job.status IN ('queue_failed', 'failed', 'outcome_unknown')
          AND NOT (
            job.target = 'discord' AND job.action = 'check'
            AND post.discord_checked_at IS NOT NULL
            AND post.discord_checked_at >= job.updated_at
          )
        ORDER BY job.updated_at DESC, job.id DESC LIMIT 1) AS failed_job_status,
      (SELECT job.error_code FROM delivery_jobs AS job
        WHERE job.post_id = post.id
          AND job.status IN ('queue_failed', 'failed', 'outcome_unknown')
          AND NOT (
            job.target = 'discord' AND job.action = 'check'
            AND post.discord_checked_at IS NOT NULL
            AND post.discord_checked_at >= job.updated_at
          )
        ORDER BY job.updated_at DESC, job.id DESC LIMIT 1) AS failed_job_error,
      (SELECT job.updated_at FROM delivery_jobs AS job
        WHERE job.post_id = post.id
          AND job.status IN ('queue_failed', 'failed', 'outcome_unknown')
          AND NOT (
            job.target = 'discord' AND job.action = 'check'
            AND post.discord_checked_at IS NOT NULL
            AND post.discord_checked_at >= job.updated_at
          )
        ORDER BY job.updated_at DESC, job.id DESC LIMIT 1) AS failed_job_at,
      (SELECT asset.updated_at FROM studio_assets AS asset
        WHERE asset.post_id = post.id AND asset.status = 'failed'
        ORDER BY asset.updated_at DESC, asset.id DESC LIMIT 1) AS failed_asset_at
    FROM studio_posts AS post
    LEFT JOIN studio_post_versions AS draft
      ON draft.id = post.draft_version_id AND draft.state = 'draft'
    LEFT JOIN studio_post_versions AS current
      ON current.id = post.current_version_id
    LEFT JOIN delivery_jobs AS latest_job ON latest_job.id = (
      SELECT job.id
      FROM delivery_jobs AS job
      WHERE job.post_id = post.id AND job.target = 'discord'
      ORDER BY job.created_at DESC, job.id DESC
      LIMIT 1
    )
    WHERE post.status != 'purged'
      AND (draft.id IS NOT NULL OR current.id IS NOT NULL)
    ORDER BY
      CASE WHEN post.status = 'withheld'
        OR post.discord_delivery_state = 'drift'
        OR EXISTS (
          SELECT 1 FROM delivery_jobs AS job
          WHERE job.post_id = post.id
            AND job.status IN ('queue_failed', 'failed', 'outcome_unknown')
            AND NOT (
              job.target = 'discord' AND job.action = 'check'
              AND post.discord_checked_at IS NOT NULL
              AND post.discord_checked_at >= job.updated_at
            )
        )
        OR EXISTS (
          SELECT 1 FROM studio_assets AS asset
          WHERE asset.post_id = post.id AND asset.status = 'failed'
        ) THEN 0 ELSE 1 END,
      saved_at DESC, post.id ASC
  `).all<DraftListRow>();

  const all = (rows.results ?? []).map((row) => {
    const reason = attentionReason(row);
    const working = row.draft_version_id !== null &&
      row.post_status !== "archived" &&
      row.post_status !== "purging" &&
      row.post_status !== "purged";
    return {
      postId: row.post_id,
      title: row.title,
      postStatus: row.post_status,
      revision: row.revision,
      savedAt: row.saved_at,
      hasDraft: row.draft_version_id !== null,
      editable: row.draft_version_id !== null &&
        (row.post_status === "draft" || row.post_status === "published"),
      working,
      needsAttention: reason !== null,
      attentionReason: reason,
      attentionAt: row.post_status === "withheld"
        ? row.saved_at
        : row.failed_job_at ?? row.failed_asset_at ??
          (row.discord_delivery_state === "drift" ? row.discord_checked_at : null),
      assetCount: row.asset_count,
      pendingAssetCount: row.pending_asset_count,
      failedAssetCount: row.failed_asset_count,
      kindLabel: row.kind_label,
      topics: (() => {
        try {
          const value = JSON.parse(row.topic_labels_json) as unknown;
          return Array.isArray(value) && value.every((label) => typeof label === "string")
            ? value
            : [];
        } catch {
          return [];
        }
      })(),
      hasCurrentVersion: row.current_version_id !== null,
      hasDiscordThread: row.discord_thread_id !== null,
      discordDeliveryState: row.discord_delivery_state,
      discordCheckedAt: row.discord_checked_at,
      latestDelivery: row.latest_job_status
        ? {
            status: row.latest_job_status,
            error: row.latest_job_error,
            updatedAt: row.latest_job_at,
          }
        : null,
    };
  });
  const items = filter === "working"
    ? all.filter(({ working }) => working)
    : filter === "attention"
    ? all.filter(({ needsAttention }) => needsAttention)
    : all;

  return json({
    filter,
    counts: {
      all: all.length,
      working: all.filter(({ working }) => working).length,
      attention: all.filter(({ needsAttention }) => needsAttention).length,
    },
    items,
  });
}

async function saveDraft(request: Request, database: StudioD1) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const draft = parseDraft(decoded);
  if (typeof draft === "string") return json({ error: draft }, 400);
  const topics = await activeTopics(database, draft.topics, draft.postId);
  if (topics.length !== draft.topics.length) {
    return json({ error: "invalid_topics" }, 409);
  }
  draft.topics = topics;

  const savedAt = new Date().toISOString();
  if (!draft.postId) {
    return json(await createDraftRecord(database, draft, savedAt), 201);
  }

  const result = await saveDraftRevisionCas(
    database,
    draft.postId,
    draft.revision,
    draft,
    savedAt,
  );
  if (result.outcome === "not_found") {
    return json({ error: "draft_not_found" }, 404);
  }
  if (result.outcome === "revision_conflict") {
    return json(
      { error: "revision_conflict", currentRevision: result.currentRevision },
      409,
    );
  }
  return json({
    postId: result.postId,
    versionId: result.versionId,
    revision: result.revision,
    savedAt: result.savedAt,
  });
}

export async function handleStudioDraftRequest(
  request: Request,
  env: PhaseAEnv,
) {
  const database = env.STUDIO_DB;
  if (!database) return json({ error: "draft_storage_unavailable" }, 503);

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const filter = url.searchParams.get("filter");
      if (filter !== null) {
        if (url.searchParams.has("postId") ||
          !draftFilters.includes(filter as DraftFilter)) {
          return json({ error: "invalid_draft_filter" }, 400);
        }
        return listDrafts(database, filter as DraftFilter);
      }
      return readDraft(request, database);
    }
    if (request.method === "POST") return saveDraft(request, database);
    return methodNotAllowed();
  } catch {
    return json({ error: "draft_storage_unavailable" }, 503);
  }
}
