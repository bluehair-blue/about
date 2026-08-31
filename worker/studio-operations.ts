import type { PhaseAEnv, StudioD1 } from "./phase-a-env";

const EXPORT_PATH = "/studio/api/export";
const OPERATIONS_PATH = "/studio/api/operations";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

async function exportPost(request: Request, database: StudioD1) {
  const postId = new URL(request.url).searchParams.get("postId");
  if (!postId || !uuidPattern.test(postId)) {
    return json({ error: "invalid_post_id" }, 400);
  }
  const post = await database.prepare(`
    SELECT id, slug, status, draft_version_id, current_version_id,
      discord_thread_id, discord_starter_message_id, discord_delivery_state,
      discord_remote_hash, discord_checked_at, pinned_at, hero_rank,
      curation_revision, archived_at, purged_at, created_at, updated_at
    FROM studio_posts WHERE id = ?
  `).bind(postId).first();
  if (!post) return json({ error: "post_not_found" }, 404);

  const [versions, topics, selections, assets, assetSelections, jobs, taxonomy] =
    await Promise.all([
      database.prepare(`
        SELECT id, post_id, state, revision, source_hash, title, body_markdown,
          kind, locale, schema_version, superseded_at, created_at, updated_at
        FROM studio_post_versions
        WHERE post_id = ? ORDER BY created_at ASC, id ASC
      `).bind(postId).all(),
      database.prepare(`
        SELECT selected.version_id, taxonomy.id AS taxonomy_id,
          taxonomy.dimension, taxonomy.stable_key, taxonomy.label,
          taxonomy.status, taxonomy.ordinal, taxonomy.discord_tag_id
        FROM studio_post_version_topics AS selected
        JOIN studio_post_versions AS version ON version.id = selected.version_id
        JOIN studio_taxonomy AS taxonomy ON taxonomy.id = selected.taxonomy_id
        WHERE version.post_id = ?
        ORDER BY selected.version_id ASC, taxonomy.ordinal ASC, taxonomy.id ASC
      `).bind(postId).all(),
      database.prepare(`
        SELECT version_id, taxonomy_id
        FROM studio_post_version_topics
        WHERE version_id IN (
          SELECT id FROM studio_post_versions WHERE post_id = ?
        )
        ORDER BY version_id ASC, taxonomy_id ASC
      `).bind(postId).all(),
      database.prepare(`
        SELECT id, post_id, status, source_mime, source_bytes, source_sha256,
          width, height, created_prefix, private_source_key,
          discord_r2_key, discord_bytes, discord_sha256,
          discord_width, discord_height, public_r2_key, public_bytes,
          public_sha256, public_width, public_height, first_published_at,
          orphaned_at, processing_error, created_at, updated_at
        FROM studio_assets WHERE post_id = ? ORDER BY created_at ASC, id ASC
      `).bind(postId).all(),
      database.prepare(`
        SELECT selected.version_id, selected.asset_id, selected.ordinal,
          selected.alt
        FROM studio_post_version_assets AS selected
        JOIN studio_post_versions AS version ON version.id = selected.version_id
        WHERE version.post_id = ?
        ORDER BY selected.version_id ASC, selected.ordinal ASC, selected.asset_id ASC
      `).bind(postId).all(),
      database.prepare(`
        SELECT id, dedupe_key, post_id, version_id, asset_id, target, action,
          remote_id, remote_aux_id, remote_attachment_ids, status, attempts,
          expected_hash, delivered_hash, error_code, created_at, updated_at,
          completed_at
        FROM delivery_jobs WHERE post_id = ?
        ORDER BY created_at ASC, id ASC
      `).bind(postId).all(),
      database.prepare(`
        SELECT id, dimension, stable_key, label, status, ordinal,
          discord_tag_id, created_at, updated_at
        FROM studio_taxonomy
        ORDER BY CASE dimension WHEN 'kind' THEN 0 ELSE 1 END,
          ordinal ASC, id ASC
      `).all(),
    ]);

  return json({
    schema: "studio-export/v1",
    exportedAt: new Date().toISOString(),
    privateSourceBytesIncluded: false,
    post,
    versions: versions.results ?? [],
    versionTopics: topics.results ?? [],
    topicLinks: selections.results ?? [],
    assets: assets.results ?? [],
    versionAssets: assetSelections.results ?? [],
    deliveryJobs: jobs.results ?? [],
    taxonomy: taxonomy.results ?? [],
  }, 200, {
    "content-disposition": `attachment; filename="studio-${postId}.json"`,
  });
}

async function operationsStatus(database: StudioD1) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const result = await database.prepare(`
    SELECT
      (SELECT max(completed_at) FROM delivery_jobs
        WHERE status = 'succeeded') AS last_succeeded_at,
      count(*) AS total,
      sum(CASE WHEN status IN ('queue_failed', 'failed', 'outcome_unknown')
        THEN 1 ELSE 0 END) AS failures,
      sum(CASE WHEN status IN (
        'queued', 'processing', 'retrying', 'verifying', 'finalizing'
      ) THEN 1 ELSE 0 END) AS pending,
      avg(CASE WHEN status = 'succeeded' AND completed_at IS NOT NULL
        THEN (julianday(completed_at) - julianday(created_at)) * 86400000 END)
        AS average_processing_ms
    FROM delivery_jobs WHERE created_at >= ?
  `).bind(since).first<{
    last_succeeded_at: string | null;
    total: number;
    failures: number;
    pending: number;
    average_processing_ms: number | null;
  }>();
  const total = Number(result?.total ?? 0);
  const failures = Number(result?.failures ?? 0);
  const average = result?.average_processing_ms;
  return json({
    schema: "studio-operations/v1",
    windowHours: 24,
    checkedAt: new Date().toISOString(),
    lastSucceededAt: result?.last_succeeded_at ?? null,
    total,
    failures,
    failureRate: total === 0 ? 0 : failures / total,
    averageProcessingMs: average === null || average === undefined
      ? null
      : Math.max(0, Math.round(Number(average))),
    pending: Number(result?.pending ?? 0),
  });
}

export async function handleStudioOperationsRequest(
  request: Request,
  env: PhaseAEnv,
) {
  const database = env.STUDIO_DB;
  if (!database) return json({ error: "studio_operations_unavailable" }, 503);
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET" },
    });
  }
  const pathname = new URL(request.url).pathname;
  if (pathname === EXPORT_PATH) return exportPost(request, database);
  if (pathname === OPERATIONS_PATH) return operationsStatus(database);
  return json({ error: "studio_operation_not_found" }, 404);
}
