import type { TaxonomyDimension } from "../db/schema";
import type {
  PhaseAEnv,
  StudioD1,
  StudioQueueProducer,
} from "./phase-a-env";
import {
  claimTaxonomySyncJob,
  expireTaxonomyProcessingLease,
  finalizeTaxonomySync,
  latestTaxonomySyncJob,
  listTaxonomyCatalog,
  markTaxonomyQueueFailed,
  queueTaxonomyMutation,
  recordTaxonomySyncFailure,
  retryTaxonomySyncJob,
  taxonomySyncJobState,
  type TaxonomyCatalogItem,
  type TaxonomyMutation,
} from "./studio-domain";
import type { StudioQueueOutcome } from "./studio-publishing";

const DISCORD_API = "https://discord.com/api/v10";
const MAX_REQUEST_BYTES = 4_096;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const snowflakePattern = /^\d{17,20}$/;
const stableKeyPattern = /^[a-z][a-z0-9-]{0,31}$/;
const PROCESSING_LEASE_MS = 60_000;

type TaxonomyRequest = TaxonomyMutation | { action: "retry"; jobId: string };

type ForumTag = {
  id: string;
  name: string;
  moderated: boolean;
  emoji_id: string | null;
  emoji_name: string | null;
};

type Forum = { tags: ForumTag[] };

class TaxonomySyncFailure extends Error {
  constructor(
    readonly code: string,
    readonly delaySeconds = 5,
  ) {
    super(code);
  }
}

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

function label(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  if (
    Array.from(normalized).length < 1 ||
    Array.from(normalized).length > 20 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

async function parseRequest(request: Request): Promise<TaxonomyRequest | string> {
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
  if (!isRecord(value) || typeof value.action !== "string") {
    return "invalid_taxonomy_request";
  }

  if (value.action === "sync" && exactKeys(value, ["action"])) {
    return { action: "sync" };
  }
  if (value.action === "add") {
    const normalizedLabel = label(value.label);
    if (
      value.dimension !== "topic" ||
      typeof value.stableKey !== "string" ||
      !stableKeyPattern.test(value.stableKey) ||
      !normalizedLabel ||
      !exactKeys(value, ["action", "dimension", "stableKey", "label"])
    ) {
      return "invalid_taxonomy_request";
    }
    return {
      action: "add",
      dimension: "topic",
      stableKey: value.stableKey,
      label: normalizedLabel,
    };
  }
  if (value.action === "rename") {
    const normalizedLabel = label(value.label);
    if (
      typeof value.taxonomyId !== "string" ||
      !uuidPattern.test(value.taxonomyId) ||
      !normalizedLabel ||
      !exactKeys(value, ["action", "taxonomyId", "label"])
    ) {
      return "invalid_taxonomy_request";
    }
    return {
      action: "rename",
      taxonomyId: value.taxonomyId,
      label: normalizedLabel,
    };
  }
  if (value.action === "reorder") {
    if (
      (value.dimension !== "kind" && value.dimension !== "topic") ||
      !Array.isArray(value.taxonomyIds) ||
      value.taxonomyIds.length > 20 ||
      value.taxonomyIds.some((id) => typeof id !== "string" || !uuidPattern.test(id)) ||
      new Set(value.taxonomyIds).size !== value.taxonomyIds.length ||
      !exactKeys(value, ["action", "dimension", "taxonomyIds"])
    ) {
      return "invalid_taxonomy_request";
    }
    return {
      action: "reorder",
      dimension: value.dimension as TaxonomyDimension,
      taxonomyIds: value.taxonomyIds as string[],
    };
  }
  if (value.action === "archive") {
    if (
      typeof value.taxonomyId !== "string" ||
      !uuidPattern.test(value.taxonomyId) ||
      !exactKeys(value, ["action", "taxonomyId"])
    ) {
      return "invalid_taxonomy_request";
    }
    return { action: "archive", taxonomyId: value.taxonomyId };
  }
  if (value.action === "retry") {
    if (
      typeof value.jobId !== "string" ||
      !uuidPattern.test(value.jobId) ||
      !exactKeys(value, ["action", "jobId"])
    ) {
      return "invalid_taxonomy_request";
    }
    return { action: "retry", jobId: value.jobId };
  }
  return "invalid_taxonomy_request";
}

function parseForum(value: unknown, env: PhaseAEnv): Forum | null {
  if (
    !isRecord(value) ||
    value.id !== env.DISCORD_FORUM_CHANNEL_ID ||
    value.guild_id !== env.DISCORD_GUILD_ID ||
    value.type !== 15 ||
    !Array.isArray(value.available_tags) ||
    value.available_tags.length > 20
  ) {
    return null;
  }
  const tags: ForumTag[] = [];
  for (const item of value.available_tags) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !snowflakePattern.test(item.id) ||
      typeof item.name !== "string" ||
      Array.from(item.name).length > 20 ||
      (item.moderated !== undefined && typeof item.moderated !== "boolean") ||
      (item.emoji_id !== undefined && item.emoji_id !== null &&
        (typeof item.emoji_id !== "string" || !snowflakePattern.test(item.emoji_id))) ||
      (item.emoji_name !== undefined && item.emoji_name !== null &&
        typeof item.emoji_name !== "string")
    ) {
      return null;
    }
    tags.push({
      id: item.id,
      name: item.name.normalize("NFC"),
      moderated: item.moderated ?? false,
      emoji_id: item.emoji_id ?? null,
      emoji_name: item.emoji_name ?? null,
    });
  }
  if (new Set(tags.map(({ id }) => id)).size !== tags.length) return null;
  return { tags };
}

async function forumResponse(
  env: PhaseAEnv,
  init: RequestInit = {},
) {
  let response: Response;
  try {
    response = await fetch(
      `${DISCORD_API}/channels/${env.DISCORD_FORUM_CHANNEL_ID}`,
      {
        ...init,
        headers: {
          authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch {
    throw new TaxonomySyncFailure("discord_forum_unavailable");
  }
  if (response.status === 429) {
    const body = await response.json().catch(() => null) as unknown;
    const retryAfter = isRecord(body) && typeof body.retry_after === "number"
      ? Math.max(1, Math.ceil(body.retry_after))
      : 5;
    throw new TaxonomySyncFailure("discord_rate_limited", retryAfter);
  }
  if (!response.ok) throw new TaxonomySyncFailure("discord_forum_unavailable");
  const forum = parseForum(await response.json(), env);
  if (!forum) throw new TaxonomySyncFailure("discord_forum_mismatch");
  return forum;
}

function desiredTags(catalog: TaxonomyCatalogItem[], forum: Forum) {
  const active = catalog.filter(({ status }) => status === "active");
  if (active.length > 20) throw new TaxonomySyncFailure("taxonomy_limit");
  if (new Set(active.map(({ label }) => label)).size !== active.length) {
    throw new TaxonomySyncFailure("taxonomy_label_ambiguous");
  }
  const byId = new Map(forum.tags.map((tag) => [tag.id, tag]));
  const used = new Set<string>();
  return active.map((item) => {
    let tag = item.discordTagId ? byId.get(item.discordTagId) : undefined;
    if (!tag) {
      const matches = forum.tags.filter((candidate) =>
        !used.has(candidate.id) && candidate.name === item.label
      );
      if (matches.length > 1) {
        throw new TaxonomySyncFailure("discord_tag_ambiguous");
      }
      tag = matches[0];
    }
    if (!tag) return { taxonomyId: item.id, request: { name: item.label } };
    if (used.has(tag.id)) throw new TaxonomySyncFailure("discord_tag_ambiguous");
    used.add(tag.id);
    return {
      taxonomyId: item.id,
      request: {
        id: tag.id,
        name: item.label,
        moderated: tag.moderated,
        emoji_id: tag.emoji_id,
        emoji_name: tag.emoji_name,
      },
    };
  });
}

function forumAlreadyMatches(
  forum: Forum,
  desired: ReturnType<typeof desiredTags>,
) {
  return forum.tags.length === desired.length && desired.every((item, index) =>
    "id" in item.request &&
    forum.tags[index]?.id === item.request.id &&
    forum.tags[index]?.name === item.request.name
  );
}

async function syncForumTaxonomy(
  env: PhaseAEnv,
  catalog: TaxonomyCatalogItem[],
) {
  const current = await forumResponse(env);
  const desired = desiredTags(catalog, current);
  if (!forumAlreadyMatches(current, desired)) {
    await forumResponse(env, {
      method: "PATCH",
      body: JSON.stringify({
        available_tags: desired.map(({ request }) => request),
      }),
    });
  }
  const verified = await forumResponse(env);
  const active = catalog.filter(({ status }) => status === "active");
  if (
    verified.tags.length !== active.length ||
    active.some((item, index) => verified.tags[index]?.name !== item.label)
  ) {
    throw new TaxonomySyncFailure("discord_taxonomy_verification_failed");
  }
  return active.map((item, index) => ({
    taxonomyId: item.id,
    discordTagId: verified.tags[index].id,
  }));
}

async function enqueueTaxonomy(
  database: StudioD1,
  queue: StudioQueueProducer,
  jobId: string,
) {
  try {
    await queue.send({ type: "taxonomy_sync", jobId });
    return true;
  } catch {
    await markTaxonomyQueueFailed(database, jobId, new Date().toISOString());
    return false;
  }
}

async function readCatalog(database: StudioD1) {
  return json({
    taxonomy: await listTaxonomyCatalog(database),
    latestJob: await latestTaxonomySyncJob(database),
  });
}

async function writeCatalog(
  request: Request,
  database: StudioD1,
  queue: StudioQueueProducer,
) {
  const input = await parseRequest(request);
  if (typeof input === "string") {
    return json({ error: input }, input === "request_too_large" ? 413 : 400);
  }
  if (input.action === "retry") {
    const outcome = await retryTaxonomySyncJob(
      database,
      input.jobId,
      new Date().toISOString(),
    );
    if (outcome === "not_found") return json({ error: "job_not_found" }, 404);
    if (outcome === "active") return json({ error: "taxonomy_sync_active" }, 409);
    if (outcome === "succeeded") return json({ jobId: input.jobId, status: "succeeded" });
    const queued = await enqueueTaxonomy(database, queue, input.jobId);
    return queued
      ? json({ jobId: input.jobId, status: "queued" }, 202)
      : json({ error: "queue_send_failed", jobId: input.jobId }, 503);
  }

  const result = await queueTaxonomyMutation(
    database,
    input,
    new Date().toISOString(),
  );
  if (result.outcome === "active_job") {
    return json(
      { error: "taxonomy_sync_active", jobId: result.jobId, status: result.status },
      409,
    );
  }
  if (result.outcome !== "queued") {
    const status = result.outcome === "not_found" ? 404 : 409;
    return json({ error: result.outcome }, status);
  }
  const queued = await enqueueTaxonomy(database, queue, result.jobId);
  return queued
    ? json({ jobId: result.jobId, status: "queued" }, 202)
    : json({ error: "queue_send_failed", jobId: result.jobId }, 503);
}

export async function handleStudioTaxonomyRequest(
  request: Request,
  env: PhaseAEnv,
) {
  const database = env.STUDIO_DB;
  if (!database) return json({ error: "taxonomy_unavailable" }, 503);
  try {
    if (request.method === "GET") return readCatalog(database);
    const queue = env.PUBLISH_QUEUE;
    if (!queue) return json({ error: "taxonomy_unavailable" }, 503);
    if (request.method === "POST") return writeCatalog(request, database, queue);
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, POST" },
    });
  } catch {
    return json({ error: "taxonomy_unavailable" }, 503);
  }
}

export async function processStudioTaxonomyJob(
  jobId: string,
  env: PhaseAEnv,
): Promise<StudioQueueOutcome> {
  if (!uuidPattern.test(jobId)) return { action: "ack" };
  const database = env.STUDIO_DB;
  if (!database) throw new Error("taxonomy_unavailable");
  const claimed = await claimTaxonomySyncJob(
    database,
    jobId,
    new Date().toISOString(),
  );
  if (claimed.outcome === "processing") {
    return { action: "retry", delaySeconds: 5 };
  }
  if (claimed.outcome !== "claimed") return { action: "ack" };

  try {
    const mappings = await syncForumTaxonomy(env, await listTaxonomyCatalog(database));
    if (!await finalizeTaxonomySync(
      database,
      jobId,
      mappings,
      new Date().toISOString(),
    )) {
      throw new TaxonomySyncFailure("taxonomy_finalization_failed");
    }
    return { action: "ack" };
  } catch (error) {
    const failure = error instanceof TaxonomySyncFailure
      ? error
      : new TaxonomySyncFailure("taxonomy_sync_failed");
    await recordTaxonomySyncFailure(
      database,
      jobId,
      failure.code,
      false,
      new Date().toISOString(),
    );
    return { action: "retry", delaySeconds: failure.delaySeconds };
  }
}

export async function recoverStudioTaxonomyQueueFailure(
  jobId: string,
  env: PhaseAEnv,
  terminal: boolean,
): Promise<StudioQueueOutcome> {
  const database = env.STUDIO_DB;
  if (!database) return { action: "retry", delaySeconds: 5 };
  const job = await taxonomySyncJobState(database, jobId);
  if (!job || ["succeeded", "failed", "outcome_unknown"].includes(job.status)) {
    return { action: "ack" };
  }
  if (
    terminal &&
    job.status === "processing" &&
    Date.now() - Date.parse(job.updatedAt) < PROCESSING_LEASE_MS
  ) {
    return { action: "retry", delaySeconds: 5 };
  }
  if (terminal && job.status === "processing") {
    await expireTaxonomyProcessingLease(
      database,
      jobId,
      job.updatedAt,
      new Date().toISOString(),
    );
    return { action: "retry" };
  }
  await recordTaxonomySyncFailure(
    database,
    jobId,
    terminal ? "taxonomy_retry_exhausted" : "taxonomy_sync_failed",
    terminal,
    new Date().toISOString(),
  );
  return terminal ? { action: "retry" } : { action: "retry", delaySeconds: 5 };
}
