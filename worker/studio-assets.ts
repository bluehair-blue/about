import type {
  PhaseAEnv,
  StudioD1,
  StudioImageInfo,
  StudioImages,
  StudioQueueProducer,
  StudioR2,
} from "./phase-a-env";
import { assetStatuses, type AssetStatus } from "../db/schema";

const ASSETS_PATH = "/studio/api/assets";
const ASSET_CLEANUP_PATH = `${ASSETS_PATH}/cleanup`;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_SOURCE_BYTES + 64 * 1024;
const MAX_PORTFOLIO_BYTES = 12 * 1024 * 1024;
export const MAX_DISCORD_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_DISCORD_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const PORTFOLIO_WIDTH = 2_560;
const DISCORD_WIDTH = 2_048;
const CLEANUP_BATCH_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1_000;
const PROCESSING_LEASE_MS = 60_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SourceMime = "image/jpeg" | "image/png" | "image/webp";

type DraftContext = {
  post_id: string;
  version_id: string;
  revision: number;
  title: string;
  asset_count: number;
};

type AssetRow = {
  id: string;
  status: AssetStatus;
  width: number;
  height: number;
  source_mime: SourceMime;
  source_bytes: number;
  public_bytes: number | null;
  discord_bytes: number | null;
  ordinal: number;
  alt: string;
  processing_error: string | null;
  created_at: string;
  updated_at: string;
};

type ProcessingAssetRow = {
  id: string;
  post_id: string;
  status: AssetStatus;
  title_snapshot: string;
  width: number;
  height: number;
  source_sha256: string;
  private_source_key: string;
  discord_r2_key: string;
  public_r2_key: string;
  created_at: string;
  public_bytes: number | null;
  public_sha256: string | null;
  discord_bytes: number | null;
  discord_sha256: string | null;
};

type RetryAssetRow = {
  post_id: string;
  status: AssetStatus;
  job_id: string;
};

type DeletingAssetRow = {
  post_id: string;
  version_id: string;
  revision: number;
  ordinal: number;
  status: string;
  created_prefix: string;
  private_source_key: string;
  discord_r2_key: string;
  public_r2_key: string;
  retained: number;
};

type CleanupCandidateRow = {
  id: string;
  post_id: string;
  job_id: string | null;
  job_status: string | null;
};

type CleanupJobRow = {
  id: string;
  post_id: string;
  asset_id: string;
  status: string;
  asset_status: AssetStatus;
  created_prefix: string;
  private_source_key: string;
  discord_r2_key: string;
  public_r2_key: string;
  orphaned_at: string | null;
  first_published_at: string | null;
};

type PostPurgeAssetRow = {
  id: string;
  created_prefix: string;
  private_source_key: string;
  discord_r2_key: string;
  public_r2_key: string;
};

type PostPurgePayload = {
  mode: "post_purge";
  confirmedTitle: string;
  createdPrefix: string;
  privateSourceKey: string;
  discordR2Key: string;
  publicR2Key: string;
};

type VersionCleanupCandidateRow = {
  id: string;
  post_id: string;
  superseded_at: string;
  job_id: string | null;
  job_status: string | null;
  payload_json: string | null;
  version_exists: number;
  job_updated_at: string | null;
};

type VersionCleanupJobRow = {
  id: string;
  post_id: string;
  status: string;
  payload_json: string;
};

type VersionCleanupAssetRow = {
  id: string;
  status: AssetStatus;
  created_prefix: string;
  private_source_key: string;
  discord_r2_key: string;
  public_r2_key: string;
  first_published_at: string | null;
};

type VersionCleanupPayload = {
  versionId: string;
  supersededAt: string;
  assetIds: string[];
};

type MediaRow = {
  id: string;
  post_id: string;
  post_status: string;
  title_snapshot: string;
  current_post_title: string;
  status: AssetStatus;
  width: number;
  height: number;
  source_mime: SourceMime;
  source_bytes: number;
  public_bytes: number | null;
  discord_bytes: number | null;
  processing_error: string | null;
  created_at: string;
  updated_at: string;
  orphaned_at: string | null;
  first_published_at: string | null;
  reference_count: number;
  cleanup_status: string | null;
  cleanup_error: string | null;
  cleanup_updated_at: string | null;
  total_count: number;
};

type PreviewAssetRow = {
  status: AssetStatus;
  source_mime: SourceMime;
  processing_error: string | null;
  private_source_key: string;
  public_r2_key: string;
  discord_r2_key: string;
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

function codePointLength(value: string) {
  return Array.from(value).length;
}

function normalizeAlt(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const alt = value.normalize("NFC").trim();
  if (
    codePointLength(alt) < 1 ||
    codePointLength(alt) > 1_000 ||
    alt.replace(/\s/gu, "") === "" ||
    /\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(alt)
  ) {
    return null;
  }
  return alt;
}

function normalizeSourceMime(format: string): SourceMime | null {
  switch (format.trim().toLowerCase()) {
    case "jpeg":
    case "jpg":
    case "image/jpeg":
      return "image/jpeg";
    case "png":
    case "image/png":
      return "image/png";
    case "webp":
    case "image/webp":
      return "image/webp";
    default:
      return null;
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function isAnimatedPng(bytes: Uint8Array) {
  if (bytes.length < 8 || ascii(bytes, 1, 3) !== "PNG") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) return false;
    if (ascii(bytes, offset + 4, 4) === "acTL") return true;
    offset += 12 + length;
  }
  return false;
}

function isAnimatedWebp(bytes: Uint8Array) {
  if (
    bytes.length < 12 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP"
  ) {
    return false;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    if (length > bytes.length - offset - 8) return false;
    if (type === "ANIM" || type === "ANMF") return true;
    if (type === "VP8X" && length >= 1 && (bytes[offset + 8] & 0x02) !== 0) {
      return true;
    }
    offset += 8 + length + (length % 2);
  }
  return false;
}

function imageError(info: StudioImageInfo, bytes: Uint8Array) {
  const mime = normalizeSourceMime(info.format);
  if (!mime) return "unsupported_image_format";
  if (
    !Number.isSafeInteger(info.width) ||
    !Number.isSafeInteger(info.height) ||
    info.width < 1 ||
    info.height < 1 ||
    info.width > 8_192 ||
    info.height > 8_192 ||
    info.width * info.height > 40_000_000
  ) {
    return "invalid_image_dimensions";
  }
  if (
    info.fileSize !== undefined &&
    (!Number.isSafeInteger(info.fileSize) || info.fileSize !== bytes.byteLength)
  ) {
    return "invalid_image_size";
  }
  if (
    (mime === "image/png" && isAnimatedPng(bytes)) ||
    (mime === "image/webp" && isAnimatedWebp(bytes))
  ) {
    return "animated_image_not_allowed";
  }
  return null;
}

function titleSnapshot(title: string) {
  const safe = title
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f:/\\?#\[\]@!$&'()*+,;=%]/gu, "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-");
  return Array.from(safe).slice(0, 40).join("") || "untitled";
}

function objectPrefix(postId: string, title: string, date: Date) {
  const iso = date.toISOString();
  const compact = `${iso.slice(0, 19).replace(/[-:]/gu, "")}Z`;
  return `posts/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}/${compact}--${postId}--${titleSnapshot(title)}`;
}

async function hashBytes(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return { digest, hex };
}

async function draftContext(
  database: StudioD1,
  postId: string,
  editableOnly = true,
) {
  return database.prepare(`
    SELECT post.id AS post_id, version.id AS version_id, version.revision,
      version.title,
      (
        SELECT count(*)
        FROM studio_post_version_assets
        WHERE version_id = version.id
      ) AS asset_count
    FROM studio_posts AS post
    JOIN studio_post_versions AS version ON version.id = post.draft_version_id
    WHERE post.id = ?
      AND (${editableOnly ? "post.status IN ('draft', 'published')" : "post.status != 'purged'"})
      AND version.state = 'draft'
  `).bind(postId).first<DraftContext>();
}

async function listAssets(request: Request, database: StudioD1) {
  const postId = new URL(request.url).searchParams.get("postId");
  if (!postId || !uuidPattern.test(postId)) {
    return json({ error: "invalid_post_id" }, 400);
  }
  const context = await draftContext(database, postId, false);
  if (!context) return json({ error: "draft_not_found" }, 404);

  const rows = await database.prepare(`
    SELECT asset.id, asset.status, asset.width, asset.height,
      asset.source_mime, asset.source_bytes, asset.public_bytes,
      asset.discord_bytes, selected.ordinal, selected.alt, asset.created_at,
      asset.processing_error, asset.updated_at
    FROM studio_post_version_assets AS selected
    JOIN studio_assets AS asset ON asset.id = selected.asset_id
    WHERE selected.version_id = ? AND asset.post_id = ?
    ORDER BY selected.ordinal ASC, asset.id ASC
  `).bind(context.version_id, postId).all<AssetRow>();

  return json({
    assets: (rows.results ?? []).map((asset) => ({
      assetId: asset.id,
      status: asset.status,
      width: asset.width,
      height: asset.height,
      sourceMime: asset.source_mime,
      sourceBytes: asset.source_bytes,
      publicBytes: asset.public_bytes,
      discordBytes: asset.discord_bytes,
      ordinal: asset.ordinal,
      alt: asset.alt,
      processingError: asset.processing_error,
      createdAt: asset.created_at,
      updatedAt: asset.updated_at,
    })),
    revision: context.revision,
  });
}

function parseMediaDay(value: string | null) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : date;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/gu, "\\$&");
}

async function listMedia(
  request: Request,
  env: PhaseAEnv,
  database: StudioD1,
) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").normalize("NFC").trim();
  const status = url.searchParams.get("status") ?? "all";
  const from = parseMediaDay(url.searchParams.get("from"));
  const through = parseMediaDay(url.searchParams.get("to"));
  if (
    codePointLength(q) > 100 ||
    (status !== "all" && !assetStatuses.includes(status as AssetStatus)) ||
    from === undefined ||
    through === undefined ||
    (from && through && from > through)
  ) {
    return json({ error: "invalid_media_filter" }, 400);
  }

  const clauses = ["post.status != 'purged'"];
  const values: Array<string | number> = [];
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    clauses.push(`(
      asset.title_snapshot LIKE ? ESCAPE '\\'
      OR coalesce(draft.title, current.title, '') LIKE ? ESCAPE '\\'
    )`);
    values.push(pattern, pattern);
  }
  if (status !== "all") {
    clauses.push("asset.status = ?");
    values.push(status);
  }
  if (from) {
    clauses.push("asset.created_at >= ?");
    values.push(from.toISOString());
  }
  if (through) {
    clauses.push("asset.created_at < ?");
    values.push(new Date(through.valueOf() + DAY_MS).toISOString());
  }

  const rows = await database.prepare(`
    SELECT asset.id, asset.post_id, post.status AS post_status,
      asset.title_snapshot,
      coalesce(draft.title, current.title, asset.title_snapshot) AS current_post_title,
      asset.status, asset.width, asset.height, asset.source_mime,
      asset.source_bytes, asset.public_bytes, asset.discord_bytes,
      asset.processing_error, asset.created_at, asset.updated_at,
      asset.orphaned_at, asset.first_published_at,
      (SELECT count(*) FROM studio_post_version_assets AS selected
        WHERE selected.asset_id = asset.id) AS reference_count,
      cleanup.status AS cleanup_status,
      cleanup.error_code AS cleanup_error,
      cleanup.updated_at AS cleanup_updated_at,
      count(*) OVER () AS total_count
    FROM studio_assets AS asset
    JOIN studio_posts AS post ON post.id = asset.post_id
    LEFT JOIN studio_post_versions AS draft ON draft.id = post.draft_version_id
    LEFT JOIN studio_post_versions AS current ON current.id = post.current_version_id
    LEFT JOIN delivery_jobs AS cleanup
      ON cleanup.dedupe_key = 'asset:' || asset.id || ':cleanup:v1'
    WHERE ${clauses.join(" AND ")}
    ORDER BY asset.created_at DESC, asset.id ASC
    LIMIT 100
  `).bind(...values).all<MediaRow>();

  const orphanDays = retentionDays(env.ASSET_ORPHAN_RETENTION_DAYS);
  const cleanupAvailable = cleanupConfiguration(env) !== null;
  const cutoff = orphanDays
    ? new Date(Date.now() - orphanDays * DAY_MS).toISOString()
    : null;
  const summary = await database.prepare(`
    SELECT sum(CASE
        WHEN ? IS NOT NULL AND asset.orphaned_at <= ? THEN 1 ELSE 0
      END) AS eligible_count,
      min(asset.orphaned_at) AS first_orphaned_at
    FROM studio_assets AS asset
    WHERE asset.status IN ('orphan', 'deleting')
      AND asset.orphaned_at IS NOT NULL
      AND asset.first_published_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM studio_post_version_assets WHERE asset_id = asset.id
      )
  `).bind(cutoff, cutoff).first<{
    eligible_count: number;
    first_orphaned_at: string | null;
  }>();
  const items = rows.results ?? [];
  return json({
    filter: {
      q,
      status,
      from: from ? from.toISOString().slice(0, 10) : "",
      to: through ? through.toISOString().slice(0, 10) : "",
    },
    total: Number(items[0]?.total_count ?? 0),
    truncated: Number(items[0]?.total_count ?? 0) > items.length,
    retention: {
      orphanDays,
      cleanupAvailable,
      eligibleOrphanCount: cutoff ? Number(summary?.eligible_count ?? 0) : 0,
      nextCleanupAt:
        orphanDays && summary?.first_orphaned_at
          ? new Date(
              Date.parse(summary.first_orphaned_at) + orphanDays * DAY_MS,
            ).toISOString()
          : null,
    },
    items: items.map((asset) => {
      const cleanupEligible = Boolean(
        cutoff &&
        asset.status === "orphan" &&
        asset.orphaned_at &&
        asset.orphaned_at <= cutoff &&
        asset.first_published_at === null &&
        asset.reference_count === 0,
      );
      return {
        assetId: asset.id,
        postId: asset.post_id,
        postStatus: asset.post_status,
        titleSnapshot: asset.title_snapshot,
        currentPostTitle: asset.current_post_title,
        status: asset.status,
        width: asset.width,
        height: asset.height,
        sourceMime: asset.source_mime,
        sourceBytes: asset.source_bytes,
        publicBytes: asset.public_bytes,
        discordBytes: asset.discord_bytes,
        processingError: asset.processing_error,
        createdAt: asset.created_at,
        updatedAt: asset.updated_at,
        orphanedAt: asset.orphaned_at,
        publishedOnce: asset.first_published_at !== null,
        referenceCount: Number(asset.reference_count),
        cleanupEligible,
        cleanupJob: asset.cleanup_status
          ? {
              status: asset.cleanup_status,
              error: asset.cleanup_error,
              updatedAt: asset.cleanup_updated_at,
            }
          : null,
      };
    }),
  });
}

async function previewAsset(
  request: Request,
  assetId: string,
  database: StudioD1,
  media: StudioR2,
) {
  if (!uuidPattern.test(assetId)) return json({ error: "invalid_asset_id" }, 400);
  const surface = new URL(request.url).searchParams.get("surface");
  if (surface !== "portfolio" && surface !== "discord") {
    return json({ error: "invalid_preview_surface" }, 400);
  }
  const asset = await database.prepare(`
    SELECT status, source_mime, processing_error, private_source_key,
      public_r2_key, discord_r2_key
    FROM studio_assets
    WHERE id = ? AND status != 'deleting'
  `).bind(assetId).first<PreviewAssetRow>();
  if (!asset || asset.processing_error === "asset_storage_failed") {
    return json({ error: "asset_preview_not_found" }, 404);
  }

  const derivativeKey = surface === "portfolio"
    ? asset.public_r2_key
    : asset.discord_r2_key;
  let object = asset.status === "ready" ? await media.get(derivativeKey) : null;
  let contentType = "image/webp";
  let source = "derivative";
  if (!object) {
    object = await media.get(asset.private_source_key);
    contentType = asset.source_mime;
    source = "private-source";
  }
  if (!object) return json({ error: "asset_preview_not_found" }, 404);
  return new Response(object.body, {
    headers: {
      "cache-control": "private, no-store",
      "content-type": contentType,
      "content-length": String(object.size),
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "x-studio-preview-source": source,
    },
  });
}

type AssetManifestInput = {
  postId: string;
  revision: number;
  assets: Array<{ assetId: string; ordinal: number; alt: string }>;
};

async function parseAssetManifestPatch(
  request: Request,
): Promise<AssetManifestInput | string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
    return "request_too_large";
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16_384) {
    return "request_too_large";
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "invalid_json";
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "invalid_asset_manifest";
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !["postId", "revision", "assets"].includes(key)) ||
    typeof input.postId !== "string" ||
    !uuidPattern.test(input.postId) ||
    typeof input.revision !== "number" ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !Array.isArray(input.assets) ||
    input.assets.length > 10
  ) {
    return "invalid_asset_manifest";
  }
  const assets: AssetManifestInput["assets"] = [];
  for (const [index, value] of input.assets.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return "invalid_asset_manifest";
    }
    const item = value as Record<string, unknown>;
    const alt = typeof item.alt === "string" ? normalizeAlt(item.alt) : null;
    if (
      Object.keys(item).some((key) => !["assetId", "ordinal", "alt"].includes(key)) ||
      typeof item.assetId !== "string" ||
      !uuidPattern.test(item.assetId) ||
      item.ordinal !== index ||
      !alt
    ) {
      return "invalid_asset_manifest";
    }
    assets.push({ assetId: item.assetId, ordinal: index, alt });
  }
  if (new Set(assets.map(({ assetId }) => assetId)).size !== assets.length) {
    return "invalid_asset_manifest";
  }
  return {
    postId: input.postId,
    revision: input.revision,
    assets,
  };
}

async function updateAssetManifest(request: Request, database: StudioD1) {
  const input = await parseAssetManifestPatch(request);
  if (typeof input === "string") {
    return json({ error: input }, input === "request_too_large" ? 413 : 400);
  }
  const context = await draftContext(database, input.postId);
  if (!context) return json({ error: "draft_not_found" }, 404);
  if (context.revision !== input.revision) {
    return json(
      { error: "revision_conflict", currentRevision: context.revision },
      409,
    );
  }
  const selected = await database.prepare(`
    SELECT asset_id
    FROM studio_post_version_assets
    WHERE version_id = ?
    ORDER BY ordinal ASC, asset_id ASC
  `).bind(context.version_id).all<{ asset_id: string }>();
  const currentIds = (selected.results ?? []).map(({ asset_id }) => asset_id).sort();
  const requestedIds = input.assets.map(({ assetId }) => assetId).sort();
  if (
    currentIds.length !== requestedIds.length ||
    currentIds.some((assetId, index) => assetId !== requestedIds[index])
  ) {
    return json({ error: "asset_manifest_conflict" }, 409);
  }
  if (input.assets.length === 0) {
    return json({ revision: input.revision, savedAt: new Date().toISOString() });
  }

  const savedAt = new Date().toISOString();
  const results = await database.batch([
    database.prepare(`
      UPDATE studio_post_version_assets
      SET ordinal = ordinal + 100
      WHERE version_id = ?
        AND EXISTS (
          SELECT 1 FROM studio_post_versions
          WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
        )
    `).bind(
      context.version_id,
      context.version_id,
      input.postId,
      input.revision,
    ),
    ...input.assets.map((asset) => database.prepare(`
      UPDATE studio_post_version_assets
      SET ordinal = ?, alt = ?
      WHERE version_id = ? AND asset_id = ? AND ordinal >= 100
        AND EXISTS (
          SELECT 1 FROM studio_post_versions
          WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
        )
    `).bind(
      asset.ordinal,
      asset.alt,
      context.version_id,
      asset.assetId,
      context.version_id,
      input.postId,
      input.revision,
    )),
    database.prepare(`
      UPDATE studio_post_versions
      SET revision = revision + 1, updated_at = ?
      WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
    `).bind(savedAt, context.version_id, input.postId, input.revision),
  ]);
  const revisionResult = results.at(-1);
  if (
    results[0]?.meta?.changes !== input.assets.length ||
    results.slice(1, -1).some((result) => result.meta?.changes !== 1) ||
    revisionResult?.meta?.changes !== 1
  ) {
    return json({ error: "revision_conflict" }, 409);
  }
  return json({ revision: input.revision + 1, savedAt });
}

function exactUploadFields(form: FormData) {
  const expected = new Set(["postId", "revision", "ordinal", "alt", "file"]);
  const keys = [...form.keys()];
  return (
    keys.every((key) => expected.has(key)) &&
    [...expected].every((key) => form.getAll(key).length === 1)
  );
}

async function markFailed(database: StudioD1, assetId: string, code: string) {
  try {
    await database.prepare(`
      UPDATE studio_assets
      SET status = 'failed', processing_error = ?, updated_at = ?
      WHERE id = ? AND status = 'uploading'
    `).bind(code, new Date().toISOString(), assetId).run();
  } catch {
    // The uploading row and exact key remain recoverable if this write fails.
  }
}

async function uploadSource(
  request: Request,
  database: StudioD1,
  media: StudioR2,
  images: StudioImages,
  queue: StudioQueueProducer,
) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_multipart" }, 400);
  }
  if (!exactUploadFields(form)) {
    return json({ error: "invalid_upload_fields" }, 400);
  }

  const postId = form.get("postId");
  const revisionText = form.get("revision");
  const ordinalText = form.get("ordinal");
  const alt = normalizeAlt(form.get("alt"));
  const file = form.get("file");
  if (
    typeof postId !== "string" ||
    !uuidPattern.test(postId) ||
    typeof revisionText !== "string" ||
    !/^\d+$/u.test(revisionText) ||
    typeof ordinalText !== "string" ||
    !/^\d$/u.test(ordinalText) ||
    !alt ||
    !(file instanceof File)
  ) {
    return json({ error: "invalid_upload_fields" }, 400);
  }
  const expectedRevision = Number(revisionText);
  const ordinal = Number(ordinalText);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    return json({ error: "invalid_revision" }, 400);
  }
  if (file.size < 1 || file.size > MAX_SOURCE_BYTES) {
    return json({ error: "invalid_image_size" }, file.size > MAX_SOURCE_BYTES ? 413 : 400);
  }

  const context = await draftContext(database, postId);
  if (!context) return json({ error: "draft_not_found" }, 404);
  if (context.revision !== expectedRevision) {
    return json(
      { error: "revision_conflict", currentRevision: context.revision },
      409,
    );
  }
  if (context.asset_count >= 10) return json({ error: "asset_limit" }, 409);
  if (ordinal !== context.asset_count) {
    return json({ error: "asset_order_conflict" }, 409);
  }

  const source = await file.arrayBuffer();
  const bytes = new Uint8Array(source);
  let info: StudioImageInfo;
  try {
    info = await images.info(new Blob([source]).stream());
  } catch {
    return json({ error: "invalid_image" }, 400);
  }
  const invalidImage = imageError(info, bytes);
  if (invalidImage) return json({ error: invalidImage }, 400);
  const sourceMime = normalizeSourceMime(info.format) as SourceMime;
  const extension = sourceMime === "image/jpeg"
    ? "jpg"
    : sourceMime === "image/png"
    ? "png"
    : "webp";
  const assetId = crypto.randomUUID();
  const createdAt = new Date();
  const createdAtText = createdAt.toISOString();
  const prefix = objectPrefix(postId, context.title, createdAt);
  const privateSourceKey = `${prefix}/private/${assetId}/source.${extension}`;
  const discordKey = `${prefix}/private/${assetId}/discord-v1.webp`;
  const publicKey = `${prefix}/public/${assetId}/portfolio-v1.webp`;
  const sourceHash = await hashBytes(source);

  let manifest;
  try {
    manifest = await database.batch([
      database.prepare(`
      INSERT INTO studio_assets (
        id, post_id, status, created_prefix, title_snapshot, width, height,
        source_mime, source_bytes, source_sha256, private_source_key,
        discord_r2_key, public_r2_key, created_at, updated_at
      )
      SELECT ?, post.id, 'uploading', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM studio_posts AS post
      JOIN studio_post_versions AS version ON version.id = post.draft_version_id
      WHERE post.id = ? AND post.status IN ('draft', 'published')
        AND version.id = ? AND version.state = 'draft' AND version.revision = ?
    `).bind(
      assetId,
      prefix,
      titleSnapshot(context.title),
      info.width,
      info.height,
      sourceMime,
      source.byteLength,
      sourceHash.hex,
      privateSourceKey,
      discordKey,
      publicKey,
      createdAtText,
      createdAtText,
      postId,
      context.version_id,
      expectedRevision,
    ),
      database.prepare(`
      INSERT INTO studio_post_version_assets (version_id, asset_id, ordinal, alt)
      VALUES (?, ?, ?, ?)
    `).bind(context.version_id, assetId, ordinal, alt),
      database.prepare(`
        UPDATE studio_post_versions
        SET revision = revision + 1, updated_at = ?
        WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
      `).bind(createdAtText, context.version_id, postId, expectedRevision),
    ]);
  } catch {
    const current = await draftContext(database, postId).catch(() => null);
    return current && current.revision !== expectedRevision
      ? json(
          { error: "revision_conflict", currentRevision: current.revision },
          409,
        )
      : json({ error: "asset_manifest_unavailable" }, 503);
  }
  if (manifest[0]?.meta?.changes !== 1 || manifest[2]?.meta?.changes !== 1) {
    return json({ error: "revision_conflict" }, 409);
  }
  const revision = expectedRevision + 1;

  try {
    const stored = await media.put(privateSourceKey, source, {
      onlyIf: new Headers({ "if-none-match": "*" }),
      httpMetadata: { contentType: sourceMime },
      customMetadata: {
        post_id: postId,
        asset_id: assetId,
        created_at: createdAtText,
        title_snapshot: titleSnapshot(context.title),
        source_sha256: sourceHash.hex,
      },
      sha256: sourceHash.digest,
    });
    if (!stored || stored.key !== privateSourceKey || stored.size !== source.byteLength) {
      await markFailed(database, assetId, "asset_storage_failed");
      return json({ error: "asset_storage_failed", assetId, revision, savedAt: createdAtText }, 503);
    }
  } catch {
    await markFailed(database, assetId, "asset_storage_failed");
    return json({ error: "asset_storage_failed", assetId, revision, savedAt: createdAtText }, 503);
  }

  const jobId = crypto.randomUUID();
  const queuedAt = new Date().toISOString();
  let queued;
  try {
    queued = await database.batch([
      database.prepare(`
        UPDATE studio_assets
        SET status = 'processing', processing_error = NULL, updated_at = ?
        WHERE id = ? AND post_id = ? AND status = 'uploading'
      `).bind(queuedAt, assetId, postId),
      database.prepare(`
        INSERT INTO delivery_jobs (
          id, dedupe_key, post_id, version_id, asset_id, target, action,
          status, attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'asset', 'process', 'queued', 0, ?, ?)
      `).bind(
        jobId,
        `asset:${assetId}:process:v1`,
        postId,
        context.version_id,
        assetId,
        queuedAt,
        queuedAt,
      ),
    ]);
  } catch {
    await markFailed(database, assetId, "asset_manifest_unavailable");
    return json({ error: "asset_manifest_unavailable", assetId, revision, savedAt: createdAtText }, 503);
  }
  if (queued[0]?.meta?.changes !== 1) {
    return json({ error: "asset_manifest_unavailable", assetId, revision, savedAt: createdAtText }, 503);
  }

  try {
    await queue.send({ type: "asset_process", jobId, assetId });
  } catch {
    await markAssetQueueFailure(database, jobId, assetId, "queue_send_failed", true);
    return json({ error: "asset_queue_unavailable", assetId, jobId, revision, savedAt: createdAtText }, 503);
  }

  return json(
    {
      assetId,
      jobId,
      status: "processing",
      width: info.width,
      height: info.height,
      sourceMime,
      sourceBytes: source.byteLength,
      ordinal,
      alt,
      createdAt: createdAtText,
      revision,
      savedAt: createdAtText,
    },
    201,
  );
}

function parseEmptyJson(request: Request) {
  return request.json().then((body) =>
    typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      Object.keys(body as object).length === 0
  ).catch(() => false);
}

async function transformDerivative(
  images: StudioImages,
  source: ArrayBuffer,
  limit: number,
  quality: number,
) {
  const transformed = await images
    .input(new Blob([source]).stream())
    .transform({ width: limit, height: limit, fit: "scale-down" })
    .output({ format: "image/webp", quality });
  const response = transformed.response();
  if (!response.ok) throw new Error("image_transform_failed");
  const bytes = await response.arrayBuffer();
  try {
    const info = await images.info(new Blob([bytes]).stream());
    if (
      normalizeSourceMime(info.format) !== "image/webp" ||
      !Number.isSafeInteger(info.width) ||
      !Number.isSafeInteger(info.height) ||
      info.width < 1 ||
      info.height < 1
    ) {
      throw new Error("image_transform_invalid");
    }
    return { bytes, width: info.width, height: info.height };
  } catch {
    throw new Error("image_transform_invalid");
  }
}

async function storeDerivative(
  media: StudioR2,
  key: string,
  bytes: ArrayBuffer,
  metadata: Record<string, string>,
) {
  const hash = await hashBytes(bytes);
  const stored = await media.put(key, bytes, {
    onlyIf: new Headers({ "if-none-match": "*" }),
    httpMetadata: { contentType: "image/webp" },
    customMetadata: metadata,
    sha256: hash.digest,
  });
  if (stored && stored.key === key && stored.size === bytes.byteLength) {
    return hash.hex;
  }
  if (stored) {
    throw new Error("derivative_storage_failed");
  }
  const existing = await media.get(key);
  if (!existing || existing.size !== bytes.byteLength) {
    throw new Error("derivative_collision");
  }
  const existingHash = await hashBytes(await existing.arrayBuffer());
  if (existingHash.hex !== hash.hex) throw new Error("derivative_collision");
  return hash.hex;
}

function assetProcessingCode(error: unknown) {
  const code = error instanceof Error ? error.message : "asset_processing_failed";
  return [
    "source_missing",
    "source_hash_mismatch",
    "image_transform_failed",
    "image_transform_invalid",
    "portfolio_derivative_too_large",
    "discord_derivative_too_large",
    "derivative_storage_failed",
    "derivative_collision",
    "asset_manifest_unavailable",
  ].includes(code)
    ? code
    : "asset_processing_failed";
}

async function markAssetQueueFailure(
  database: StudioD1,
  jobId: string,
  assetId: string,
  code: string,
  terminal: boolean,
) {
  const updatedAt = new Date().toISOString();
  try {
    await database.batch([
      database.prepare(`
        UPDATE delivery_jobs
        SET status = ?, error_code = ?, last_error = ?, updated_at = ?,
          completed_at = CASE WHEN ? = 1 THEN ? ELSE NULL END
        WHERE id = ? AND asset_id = ? AND target = 'asset'
          AND status != 'succeeded'
      `).bind(
        terminal ? "failed" : "retrying",
        code,
        code,
        updatedAt,
        terminal ? 1 : 0,
        updatedAt,
        jobId,
        assetId,
      ),
      database.prepare(`
        UPDATE studio_assets
        SET status = ?, processing_error = ?, updated_at = ?
        WHERE id = ? AND status NOT IN ('ready', 'deleting', 'orphan')
      `).bind(
        terminal ? "failed" : "processing",
        code,
        updatedAt,
        assetId,
      ),
    ]);
  } catch {
    // Queue retry remains the recovery path if D1 is temporarily unavailable.
  }
}

export async function recordStudioAssetQueueFailure(
  jobId: string,
  assetId: string,
  env: PhaseAEnv,
  error: unknown,
  terminal: boolean,
) {
  if (!env.STUDIO_DB) return;
  await markAssetQueueFailure(
    env.STUDIO_DB,
    jobId,
    assetId,
    assetProcessingCode(error),
    terminal,
  );
}

async function parseRevisionJson(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return (
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      Object.keys(body).length === 1 &&
      typeof body.expectedRevision === "number" &&
      Number.isSafeInteger(body.expectedRevision) &&
      body.expectedRevision >= 1
    )
      ? body.expectedRevision
      : null;
  } catch {
    return null;
  }
}

export async function processStudioAssetJob(
  jobId: string,
  assetId: string,
  env: PhaseAEnv,
) {
  if (!uuidPattern.test(jobId) || !uuidPattern.test(assetId)) return;
  const database = env.STUDIO_DB;
  const media = env.STUDIO_MEDIA;
  const images = env.IMAGES;
  if (!database || !media || !images) throw new Error("asset_processing_failed");

  const claimed = await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'processing', attempts = attempts + 1,
      error_code = NULL, last_error = NULL, updated_at = ?
    WHERE id = ? AND asset_id = ? AND target = 'asset' AND action = 'process'
      AND (
        status IN ('queued', 'retrying')
        OR (status = 'processing' AND updated_at <= ?)
      )
  `).bind(
    new Date().toISOString(),
    jobId,
    assetId,
    new Date(Date.now() - PROCESSING_LEASE_MS).toISOString(),
  ).run();
  if (claimed.meta?.changes !== 1) return;

  const asset = await database.prepare(`
    SELECT id, post_id, status, title_snapshot, width, height, source_sha256,
      private_source_key, discord_r2_key, public_r2_key, created_at,
      public_bytes, public_sha256, discord_bytes, discord_sha256
    FROM studio_assets
    WHERE id = ?
  `).bind(assetId).first<ProcessingAssetRow>();
  if (!asset) return;

  if (
    asset.status === "ready" &&
    asset.public_bytes &&
    asset.public_sha256 &&
    asset.discord_bytes &&
    asset.discord_sha256
  ) {
    await database.prepare(`
      UPDATE delivery_jobs
      SET status = 'succeeded', error_code = NULL, last_error = NULL,
        updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'processing'
    `).bind(new Date().toISOString(), new Date().toISOString(), jobId).run();
    return;
  }
  if (asset.status !== "processing") return;

  const sourceObject = await media.get(asset.private_source_key);
  if (!sourceObject) throw new Error("source_missing");
  const source = await sourceObject.arrayBuffer();
  const sourceHash = await hashBytes(source);
  if (sourceHash.hex !== asset.source_sha256) {
    throw new Error("source_hash_mismatch");
  }

  const [portfolio, discord] = await Promise.all([
    transformDerivative(images, source, PORTFOLIO_WIDTH, 85),
    transformDerivative(images, source, DISCORD_WIDTH, 80),
  ]);
  if (portfolio.bytes.byteLength > MAX_PORTFOLIO_BYTES) {
    throw new Error("portfolio_derivative_too_large");
  }
  if (discord.bytes.byteLength > MAX_DISCORD_ASSET_BYTES) {
    throw new Error("discord_derivative_too_large");
  }

  const metadata = {
    post_id: asset.post_id,
    asset_id: asset.id,
    created_at: asset.created_at,
    title_snapshot: asset.title_snapshot,
    source_sha256: asset.source_sha256,
  };
  const publicHash = await storeDerivative(
    media,
    asset.public_r2_key,
    portfolio.bytes,
    metadata,
  );
  const discordHash = await storeDerivative(
    media,
    asset.discord_r2_key,
    discord.bytes,
    metadata,
  );
  const completedAt = new Date().toISOString();
  const ready = await database.prepare(`
    UPDATE studio_assets
    SET status = 'ready', public_bytes = ?, public_sha256 = ?,
      public_width = ?, public_height = ?, discord_bytes = ?,
      discord_sha256 = ?, discord_width = ?, discord_height = ?,
      processing_error = NULL, updated_at = ?
    WHERE id = ? AND status = 'processing'
  `).bind(
    portfolio.bytes.byteLength,
    publicHash,
    portfolio.width,
    portfolio.height,
    discord.bytes.byteLength,
    discordHash,
    discord.width,
    discord.height,
    completedAt,
    assetId,
  ).run();
  if (ready.meta?.changes !== 1) {
    await media.delete([asset.public_r2_key, asset.discord_r2_key]);
    throw new Error("asset_manifest_unavailable");
  }

  await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'succeeded', error_code = NULL, last_error = NULL,
      updated_at = ?, completed_at = ?
    WHERE id = ? AND asset_id = ? AND status = 'processing'
  `).bind(completedAt, completedAt, jobId, assetId).run();
}

async function retryAsset(
  request: Request,
  assetId: string,
  database: StudioD1,
  queue: StudioQueueProducer,
) {
  if (!uuidPattern.test(assetId)) return json({ error: "invalid_asset_id" }, 400);
  if (!(await parseEmptyJson(request))) return json({ error: "invalid_json_object" }, 400);

  const asset = await database.prepare(`
    SELECT asset.post_id, asset.status, job.id AS job_id
    FROM studio_assets AS asset
    JOIN studio_posts AS post ON post.id = asset.post_id
    JOIN delivery_jobs AS job
      ON job.asset_id = asset.id AND job.target = 'asset' AND job.action = 'process'
    WHERE asset.id = ? AND post.status IN ('draft', 'published')
    ORDER BY job.created_at DESC, job.id DESC
    LIMIT 1
  `).bind(assetId).first<RetryAssetRow>();
  if (!asset) return json({ error: "asset_not_found" }, 404);
  if (asset.status === "ready") return json({ error: "asset_already_ready" }, 409);
  if (!assetStatusesCanRetry(asset.status)) {
    return json({ error: "asset_retry_conflict" }, 409);
  }

  const queuedAt = new Date().toISOString();
  await database.batch([
    database.prepare(`
      UPDATE studio_assets
      SET status = 'processing', processing_error = NULL, updated_at = ?
      WHERE id = ? AND status IN ('failed', 'processing')
    `).bind(queuedAt, assetId),
    database.prepare(`
      UPDATE delivery_jobs
      SET status = 'queued', error_code = NULL, last_error = NULL,
        completed_at = NULL, updated_at = ?
      WHERE id = ? AND asset_id = ? AND status != 'succeeded'
    `).bind(queuedAt, asset.job_id, assetId),
  ]);

  try {
    await queue.send({ type: "asset_process", jobId: asset.job_id, assetId });
  } catch {
    await markAssetQueueFailure(
      database,
      asset.job_id,
      assetId,
      "queue_send_failed",
      true,
    );
    return json({ error: "asset_queue_unavailable" }, 503);
  }
  return json({ assetId, jobId: asset.job_id, status: "processing" }, 202);
}

function assetStatusesCanRetry(status: AssetStatus) {
  return status === "failed" || status === "processing";
}

function detachAssetStatements(
  database: StudioD1,
  versionId: string,
  assetId: string,
  ordinal: number,
  postId: string,
  expectedRevision: number,
) {
  return [
    database.prepare(`
      DELETE FROM studio_post_version_assets
      WHERE version_id = ? AND asset_id = ?
        AND EXISTS (
          SELECT 1 FROM studio_post_versions
          WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
        )
    `).bind(versionId, assetId, versionId, postId, expectedRevision),
    database.prepare(`
      UPDATE studio_post_version_assets
      SET ordinal = ordinal + 100
      WHERE version_id = ? AND ordinal > ?
        AND EXISTS (
          SELECT 1 FROM studio_post_versions
          WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
        )
    `).bind(versionId, ordinal, versionId, postId, expectedRevision),
    database.prepare(`
      UPDATE studio_post_version_assets
      SET ordinal = ordinal - 101
      WHERE version_id = ? AND ordinal >= 100
        AND EXISTS (
          SELECT 1 FROM studio_post_versions
          WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
        )
    `).bind(versionId, versionId, postId, expectedRevision),
  ];
}

async function deleteAsset(
  request: Request,
  assetId: string,
  database: StudioD1,
) {
  if (!uuidPattern.test(assetId)) return json({ error: "invalid_asset_id" }, 400);
  const expectedRevision = await parseRevisionJson(request);
  if (expectedRevision === null) return json({ error: "invalid_revision" }, 400);

  const asset = await database.prepare(`
    SELECT asset.post_id, selected.version_id, version.revision,
      selected.ordinal, asset.status,
      asset.created_prefix,
      asset.private_source_key, asset.discord_r2_key, asset.public_r2_key,
      CASE WHEN EXISTS (
        SELECT 1
        FROM studio_post_version_assets AS other
        WHERE other.asset_id = asset.id AND other.version_id != version.id
      ) THEN 1 ELSE 0 END AS retained
    FROM studio_assets AS asset
    JOIN studio_posts AS post ON post.id = asset.post_id
    JOIN studio_post_versions AS version ON version.id = post.draft_version_id
    JOIN studio_post_version_assets AS selected
      ON selected.asset_id = asset.id AND selected.version_id = version.id
    WHERE asset.id = ? AND post.status IN ('draft', 'published')
      AND version.state = 'draft'
  `).bind(assetId).first<DeletingAssetRow>();
  if (!asset) return json({ error: "asset_not_found" }, 404);
  if (asset.revision !== expectedRevision) {
    return json(
      { error: "revision_conflict", currentRevision: asset.revision },
      409,
    );
  }
  const updatedAt = new Date().toISOString();
  if (asset.retained === 1) {
    const results = await database.batch([
      ...detachAssetStatements(
        database,
        asset.version_id,
        assetId,
        asset.ordinal,
        asset.post_id,
        expectedRevision,
      ),
      database.prepare(`
        UPDATE studio_post_versions
        SET revision = revision + 1, updated_at = ?
        WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
      `).bind(updatedAt, asset.version_id, asset.post_id, expectedRevision),
    ]);
    if (results[0]?.meta?.changes !== 1 || results.at(-1)?.meta?.changes !== 1) {
      return json({ error: "revision_conflict" }, 409);
    }
    return json({ revision: expectedRevision + 1, savedAt: updatedAt });
  }
  const orphanedAt = updatedAt;
  const results = await database.batch([
    ...detachAssetStatements(
      database,
      asset.version_id,
      assetId,
      asset.ordinal,
      asset.post_id,
      expectedRevision,
    ),
    database.prepare(`
      UPDATE studio_assets
      SET status = 'orphan', orphaned_at = ?, processing_error = NULL,
        updated_at = ?
      WHERE id = ? AND post_id = ? AND status = ?
        AND NOT EXISTS (
          SELECT 1 FROM studio_post_version_assets WHERE asset_id = ?
        )
    `).bind(
      orphanedAt,
      orphanedAt,
      assetId,
      asset.post_id,
      asset.status,
      assetId,
    ),
    database.prepare(`
      UPDATE delivery_jobs
      SET status = 'failed', error_code = 'asset_orphaned',
        last_error = 'asset_orphaned', updated_at = ?, completed_at = ?
      WHERE asset_id = ? AND target = 'asset' AND action = 'process'
        AND status NOT IN ('succeeded', 'failed', 'outcome_unknown')
    `).bind(orphanedAt, orphanedAt, assetId),
    database.prepare(`
      UPDATE studio_post_versions
      SET revision = revision + 1, updated_at = ?
      WHERE id = ? AND post_id = ? AND state = 'draft' AND revision = ?
    `).bind(updatedAt, asset.version_id, asset.post_id, expectedRevision),
  ]);
  if (
    results[0]?.meta?.changes !== 1 ||
    results[3]?.meta?.changes !== 1 ||
    results.at(-1)?.meta?.changes !== 1
  ) {
    return json({ error: "asset_delete_conflict" }, 409);
  }
  return json({ revision: expectedRevision + 1, savedAt: updatedAt });
}

function retentionDays(value: string | undefined) {
  if (!value || !/^[1-9]\d{0,3}$/u.test(value)) return null;
  const days = Number(value);
  return Number.isSafeInteger(days) && days <= 3_650 ? days : null;
}

function cleanupConfiguration(env: PhaseAEnv) {
  const orphanDays = retentionDays(env.ASSET_ORPHAN_RETENTION_DAYS);
  const rollbackDays = retentionDays(env.VERSION_ROLLBACK_RETENTION_DAYS);
  const zoneId = env.CLOUDFLARE_ZONE_ID;
  const cachePurgeToken = env.CLOUDFLARE_CACHE_PURGE_TOKEN;
  if (
    !orphanDays ||
    !rollbackDays ||
    !env.STUDIO_PUBLIC_ORIGIN ||
    !zoneId ||
    !/^[0-9a-f]{32}$/iu.test(zoneId) ||
    !cachePurgeToken ||
    cachePurgeToken.length < 20 ||
    cachePurgeToken.length > 200 ||
    /\s/u.test(cachePurgeToken)
  ) {
    return null;
  }
  try {
    const origin = new URL(env.STUDIO_PUBLIC_ORIGIN);
    if (
      origin.protocol !== "https:" ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password ||
      origin.origin !== env.STUDIO_PUBLIC_ORIGIN
    ) {
      return null;
    }
    return {
      orphanDays,
      rollbackDays,
      publicOrigin: origin.origin,
      zoneId,
      cachePurgeToken,
    };
  } catch {
    return null;
  }
}

function parsePostPurgePayload(value: string): PostPurgePayload | null {
  try {
    const payload = JSON.parse(value) as unknown;
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 6
    ) {
      return null;
    }
    const item = payload as Record<string, unknown>;
    if (
      item.mode !== "post_purge" ||
      typeof item.confirmedTitle !== "string" ||
      typeof item.createdPrefix !== "string" ||
      typeof item.privateSourceKey !== "string" ||
      typeof item.discordR2Key !== "string" ||
      typeof item.publicR2Key !== "string"
    ) {
      return null;
    }
    return {
      mode: "post_purge",
      confirmedTitle: item.confirmedTitle,
      createdPrefix: item.createdPrefix,
      privateSourceKey: item.privateSourceKey,
      discordR2Key: item.discordR2Key,
      publicR2Key: item.publicR2Key,
    };
  } catch {
    return null;
  }
}

function parseVersionCleanupPayload(value: string): VersionCleanupPayload | null {
  try {
    const payload = JSON.parse(value) as Record<string, unknown>;
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 3 ||
      typeof payload.versionId !== "string" ||
      !uuidPattern.test(payload.versionId) ||
      typeof payload.supersededAt !== "string" ||
      !Number.isFinite(Date.parse(payload.supersededAt)) ||
      !Array.isArray(payload.assetIds) ||
      payload.assetIds.length > 10 ||
      !payload.assetIds.every((id) => typeof id === "string" && uuidPattern.test(id)) ||
      new Set(payload.assetIds).size !== payload.assetIds.length
    ) {
      return null;
    }
    return {
      versionId: payload.versionId,
      supersededAt: payload.supersededAt,
      assetIds: payload.assetIds,
    };
  } catch {
    return null;
  }
}

async function markCleanupQueueFailure(
  database: StudioD1,
  jobId: string,
  assetId: string,
) {
  await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'queue_failed', error_code = 'queue_send_failed',
      last_error = 'queue_send_failed', updated_at = ?
    WHERE id = ? AND asset_id = ? AND target = 'asset' AND action = 'delete'
      AND status = 'queued'
  `).bind(new Date().toISOString(), jobId, assetId).run();
}

async function markVersionCleanupQueueFailure(
  database: StudioD1,
  jobId: string,
) {
  await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'queue_failed', error_code = 'queue_send_failed',
      last_error = 'queue_send_failed', updated_at = ?
    WHERE id = ? AND target = 'version' AND action = 'cleanup'
      AND status = 'queued'
  `).bind(new Date().toISOString(), jobId).run();
}

function purgeTombstoneStatement(
  database: StudioD1,
  postId: string,
  purgedAt: string,
) {
  return database.prepare(`
    UPDATE studio_posts
    SET status = 'purged', draft_version_id = NULL, current_version_id = NULL,
      pinned_at = NULL, hero_rank = NULL, discord_delivery_state = NULL,
      discord_remote_hash = NULL, discord_checked_at = NULL, archived_at = NULL,
      purged_at = ?, updated_at = ?
    WHERE id = ? AND status = 'purging'
      AND NOT EXISTS (SELECT 1 FROM studio_assets WHERE post_id = studio_posts.id)
      AND NOT EXISTS (
        SELECT 1 FROM studio_post_versions WHERE post_id = studio_posts.id
      )
  `).bind(purgedAt, purgedAt, postId);
}

export async function queueStudioPostPurge(
  postId: string,
  confirmedTitle: string,
  env: PhaseAEnv,
  database: StudioD1,
  queue: StudioQueueProducer,
) {
  if (!cleanupConfiguration(env)) {
    return json({ error: "asset_cleanup_configuration_invalid" }, 503);
  }
  const post = await database.prepare(`
    SELECT post.status, version.title
    FROM studio_posts AS post
    LEFT JOIN studio_post_versions AS version ON version.id = post.current_version_id
    WHERE post.id = ? AND post.status IN ('archived', 'purging')
  `).bind(postId).first<{ status: "archived" | "purging"; title: string | null }>();
  if (!post) return json({ error: "purge_not_found" }, 404);

  if (post.status === "purging") {
    const remaining = await database.prepare(`
      SELECT job.id AS job_id, job.asset_id, job.status, job.payload_json
      FROM delivery_jobs AS job
      JOIN studio_assets AS asset ON asset.id = job.asset_id
      WHERE job.post_id = ? AND job.target = 'asset' AND job.action = 'delete'
        AND json_extract(job.payload_json, '$.mode') = 'post_purge'
      ORDER BY asset.id ASC
    `).bind(postId).all<{
      job_id: string;
      asset_id: string;
      status: string;
      payload_json: string;
    }>();
    const jobs = remaining.results ?? [];
    const assetCount = await database.prepare(`
      SELECT count(*) AS count FROM studio_assets WHERE post_id = ?
    `).bind(postId).first<{ count: number }>();
    if (jobs.length !== Number(assetCount?.count ?? 0)) {
      return json({ error: "purge_conflict" }, 409);
    }
    if (
      jobs.some((job) =>
        parsePostPurgePayload(job.payload_json)?.confirmedTitle !== confirmedTitle
      )
    ) {
      return json({ error: "purge_title_mismatch" }, 409);
    }
    if (jobs.length === 0) {
      const finalized = await purgeTombstoneStatement(
        database,
        postId,
        new Date().toISOString(),
      ).run();
      return finalized.meta?.changes === 1
        ? json({ postId, status: "purged", queued: 0 })
        : json({ error: "purge_conflict" }, 409);
    }
    let queued = 0;
    let queueFailed = 0;
    for (const job of jobs) {
      if (["queue_failed", "retrying", "failed"].includes(job.status)) {
        const reset = await database.prepare(`
          UPDATE delivery_jobs
          SET status = 'queued', error_code = NULL, last_error = NULL,
            completed_at = NULL, updated_at = ?
          WHERE id = ? AND status IN ('queue_failed', 'retrying', 'failed')
        `).bind(new Date().toISOString(), job.job_id).run();
        if (reset.meta?.changes !== 1) continue;
      } else if (job.status !== "queued") {
        continue;
      }
      try {
        await queue.send({
          type: "asset_cleanup",
          jobId: job.job_id,
          assetId: job.asset_id,
        });
        queued += 1;
      } catch {
        queueFailed += 1;
        await markCleanupQueueFailure(database, job.job_id, job.asset_id);
      }
    }
    return json(
      { postId, status: "purging", queued, queueFailed },
      queueFailed > 0 ? 503 : 202,
    );
  }

  if (post.title !== confirmedTitle) {
    return json({ error: "purge_title_mismatch" }, 409);
  }
  const assets = await database.prepare(`
    SELECT id, created_prefix, private_source_key, discord_r2_key, public_r2_key
    FROM studio_assets
    WHERE post_id = ?
    ORDER BY id ASC
  `).bind(postId).all<PostPurgeAssetRow>();
  const rows = assets.results ?? [];
  const purgingAt = new Date().toISOString();
  const jobs = rows.map((asset) => ({
    id: crypto.randomUUID(),
    asset,
    payload: JSON.stringify({
      mode: "post_purge",
      confirmedTitle,
      createdPrefix: asset.created_prefix,
      privateSourceKey: asset.private_source_key,
      discordR2Key: asset.discord_r2_key,
      publicR2Key: asset.public_r2_key,
    } satisfies PostPurgePayload),
  }));
  const statements = [
    database.prepare(`
      UPDATE studio_posts
      SET status = 'purging', draft_version_id = NULL, current_version_id = NULL,
        pinned_at = NULL, hero_rank = NULL, updated_at = ?
      WHERE id = ? AND status = 'archived'
        AND EXISTS (
          SELECT 1 FROM studio_post_versions
          WHERE id = studio_posts.current_version_id AND title = ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM delivery_jobs
          WHERE post_id = studio_posts.id
            AND target != 'notification'
            AND status NOT IN ('succeeded', 'failed', 'outcome_unknown')
        )
    `).bind(purgingAt, postId, confirmedTitle),
    ...jobs.map(({ id, asset, payload }) => database.prepare(`
      INSERT INTO delivery_jobs (
        id, dedupe_key, post_id, asset_id, target, action, payload_json,
        status, attempts, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, 'asset', 'delete', ?, 'queued', 0, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM studio_posts WHERE id = ? AND status = 'purging'
      )
    `).bind(
      id,
      `purge:${postId}:${asset.id}`,
      postId,
      asset.id,
      payload,
      purgingAt,
      purgingAt,
      postId,
    )),
    database.prepare(`
      DELETE FROM studio_post_versions
      WHERE post_id = ?
        AND EXISTS (
          SELECT 1 FROM studio_posts WHERE id = ? AND status = 'purging'
        )
    `).bind(postId, postId),
    ...(rows.length === 0
      ? [purgeTombstoneStatement(database, postId, purgingAt)]
      : []),
  ];
  let transitioned;
  try {
    transitioned = await database.batch(statements);
  } catch {
    return json({ error: "purge_conflict" }, 409);
  }
  if (
    transitioned[0]?.meta?.changes !== 1 ||
    jobs.some((_, index) => transitioned[index + 1]?.meta?.changes !== 1)
  ) {
    return json({ error: "purge_conflict" }, 409);
  }
  if (rows.length === 0) {
    return transitioned.at(-1)?.meta?.changes === 1
      ? json({ postId, status: "purged", queued: 0 })
      : json({ error: "purge_conflict" }, 409);
  }

  let queued = 0;
  let queueFailed = 0;
  for (const job of jobs) {
    try {
      await queue.send({ type: "asset_cleanup", jobId: job.id, assetId: job.asset.id });
      queued += 1;
    } catch {
      queueFailed += 1;
      await markCleanupQueueFailure(database, job.id, job.asset.id);
    }
  }
  return json(
    { postId, status: "purging", queued, queueFailed },
    queueFailed > 0 ? 503 : 202,
  );
}

async function parseCleanupAssetId(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return undefined;
    }
    const keys = Object.keys(body);
    if (keys.length === 0) return null;
    return keys.length === 1 &&
        keys[0] === "assetId" &&
        typeof body.assetId === "string" &&
        uuidPattern.test(body.assetId)
      ? body.assetId
      : undefined;
  } catch {
    return undefined;
  }
}

async function queueExpiredRetentionCleanup(
  request: Request,
  env: PhaseAEnv,
  database: StudioD1,
  queue: StudioQueueProducer,
) {
  const requestedAssetId = await parseCleanupAssetId(request);
  if (requestedAssetId === undefined) {
    return json({ error: "invalid_json_object" }, 400);
  }
  const config = cleanupConfiguration(env);
  if (!config) return json({ error: "asset_cleanup_configuration_invalid" }, 503);
  const cutoff = new Date(Date.now() - config.orphanDays * DAY_MS).toISOString();
  const assetRows = await database.prepare(`
    SELECT asset.id, asset.post_id, cleanup.id AS job_id,
      cleanup.status AS job_status
    FROM studio_assets AS asset
    LEFT JOIN delivery_jobs AS cleanup
      ON cleanup.dedupe_key = 'asset:' || asset.id || ':cleanup:v1'
    WHERE asset.status IN ('orphan', 'deleting')
      AND asset.orphaned_at IS NOT NULL
      AND asset.orphaned_at <= ?
      AND asset.first_published_at IS NULL
      AND (? IS NULL OR asset.id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM studio_post_version_assets WHERE asset_id = asset.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM delivery_jobs AS active
        WHERE active.asset_id = asset.id
          AND active.id IS NOT cleanup.id
          AND active.status NOT IN ('succeeded', 'failed', 'outcome_unknown')
      )
    ORDER BY asset.orphaned_at ASC, asset.id ASC
    LIMIT ?
  `).bind(
    cutoff,
    requestedAssetId,
    requestedAssetId,
    CLEANUP_BATCH_SIZE,
  ).all<CleanupCandidateRow>();

  const versionCutoff = new Date(
    Date.now() - config.rollbackDays * DAY_MS,
  ).toISOString();
  const versionRows: { results?: VersionCleanupCandidateRow[] } = requestedAssetId
    ? { results: [] }
    : await database.prepare(`
    SELECT * FROM (
      SELECT version.id, version.post_id, version.superseded_at,
        cleanup.id AS job_id, cleanup.status AS job_status,
        cleanup.payload_json, 1 AS version_exists,
        cleanup.updated_at AS job_updated_at
      FROM studio_post_versions AS version
      JOIN studio_posts AS post ON post.id = version.post_id
      LEFT JOIN delivery_jobs AS cleanup
        ON cleanup.dedupe_key = 'version:' || version.id || ':cleanup:' || version.superseded_at
      WHERE version.state = 'superseded'
        AND version.superseded_at IS NOT NULL
        AND version.superseded_at <= ?
        AND post.current_version_id IS NOT version.id
        AND post.draft_version_id IS NOT version.id
        AND NOT EXISTS (
          SELECT 1
          FROM delivery_jobs AS active
          WHERE active.version_id = version.id
            AND active.status NOT IN ('succeeded', 'failed', 'outcome_unknown')
        )
      UNION ALL
      SELECT json_extract(cleanup.payload_json, '$.versionId') AS id,
        cleanup.post_id,
        json_extract(cleanup.payload_json, '$.supersededAt') AS superseded_at,
        cleanup.id AS job_id, cleanup.status AS job_status,
        cleanup.payload_json, 0 AS version_exists,
        cleanup.updated_at AS job_updated_at
      FROM delivery_jobs AS cleanup
      WHERE cleanup.target = 'version' AND cleanup.action = 'cleanup'
        AND cleanup.status IN ('queued', 'processing', 'retrying', 'queue_failed', 'failed')
        AND json_type(cleanup.payload_json, '$.versionId') = 'text'
        AND json_extract(cleanup.payload_json, '$.supersededAt') <= ?
        AND NOT EXISTS (
          SELECT 1 FROM studio_post_versions
          WHERE id = json_extract(cleanup.payload_json, '$.versionId')
        )
    )
    ORDER BY superseded_at ASC, id ASC
    LIMIT ?
  `).bind(
    versionCutoff,
    versionCutoff,
    CLEANUP_BATCH_SIZE,
  ).all<VersionCleanupCandidateRow>();

  let queued = 0;
  let queueFailed = 0;
  for (const candidate of assetRows.results ?? []) {
    if (candidate.job_status === "processing") continue;
    const jobId = candidate.job_id ?? crypto.randomUUID();
    const queuedAt = new Date().toISOString();
    if (!candidate.job_id) {
      const inserted = await database.prepare(`
        INSERT INTO delivery_jobs (
          id, dedupe_key, post_id, asset_id, target, action, status,
          attempts, created_at, updated_at
        )
        SELECT ?, ?, asset.post_id, asset.id, 'asset', 'delete', 'queued',
          0, ?, ?
        FROM studio_assets AS asset
        WHERE asset.id = ? AND asset.status IN ('orphan', 'deleting')
          AND asset.orphaned_at IS NOT NULL AND asset.orphaned_at <= ?
          AND asset.first_published_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM studio_post_version_assets WHERE asset_id = asset.id
          )
      `).bind(
        jobId,
        `asset:${candidate.id}:cleanup:v1`,
        queuedAt,
        queuedAt,
        candidate.id,
        cutoff,
      ).run();
      if (inserted.meta?.changes !== 1) continue;
    } else if (["queue_failed", "retrying", "failed"].includes(candidate.job_status ?? "")) {
      const requeued = await database.prepare(`
        UPDATE delivery_jobs
        SET status = 'queued', error_code = NULL, last_error = NULL,
          completed_at = NULL, updated_at = ?
        WHERE id = ? AND asset_id = ? AND target = 'asset' AND action = 'delete'
          AND status IN ('queue_failed', 'retrying', 'failed')
          AND EXISTS (
            SELECT 1 FROM studio_assets AS asset
            WHERE asset.id = ? AND asset.status IN ('orphan', 'deleting')
              AND asset.orphaned_at IS NOT NULL AND asset.orphaned_at <= ?
              AND asset.first_published_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM studio_post_version_assets
                WHERE asset_id = asset.id
              )
          )
      `).bind(queuedAt, jobId, candidate.id, candidate.id, cutoff).run();
      if (requeued.meta?.changes !== 1) continue;
    } else if (candidate.job_status !== "queued") {
      continue;
    }

    try {
      await queue.send({ type: "asset_cleanup", jobId, assetId: candidate.id });
      queued += 1;
    } catch {
      queueFailed += 1;
      await markCleanupQueueFailure(database, jobId, candidate.id);
    }
  }

  for (const candidate of versionRows.results ?? []) {
    if (candidate.job_status === "processing" && candidate.version_exists === 1) continue;
    if (
      candidate.job_status === "processing" &&
      candidate.job_updated_at &&
      Date.now() - Date.parse(candidate.job_updated_at) < PROCESSING_LEASE_MS
    ) {
      continue;
    }
    let payload = candidate.payload_json;
    if (candidate.job_id) {
      const parsed = payload ? parseVersionCleanupPayload(payload) : null;
      if (
        !parsed ||
        parsed.versionId !== candidate.id ||
        parsed.supersededAt !== candidate.superseded_at
      ) {
        continue;
      }
    } else {
      const selected = await database.prepare(`
        SELECT asset_id
        FROM studio_post_version_assets
        WHERE version_id = ?
        ORDER BY ordinal ASC
      `).bind(candidate.id).all<{ asset_id: string }>();
      payload = JSON.stringify({
        versionId: candidate.id,
        supersededAt: candidate.superseded_at,
        assetIds: (selected.results ?? []).map(({ asset_id }) => asset_id),
      });
    }
    if (!payload) continue;
    const dedupeKey = `version:${candidate.id}:cleanup:${candidate.superseded_at}`;
    const jobId = candidate.job_id ?? crypto.randomUUID();
    const queuedAt = new Date().toISOString();
    if (!candidate.job_id) {
      const inserted = await database.prepare(`
        INSERT INTO delivery_jobs (
          id, dedupe_key, post_id, target, action, payload_json,
          status, attempts, created_at, updated_at
        )
        SELECT ?, ?, version.post_id, 'version', 'cleanup', ?,
          'queued', 0, ?, ?
        FROM studio_post_versions AS version
        JOIN studio_posts AS post ON post.id = version.post_id
        WHERE version.id = ? AND version.state = 'superseded'
          AND version.superseded_at = ? AND version.superseded_at <= ?
          AND post.current_version_id IS NOT version.id
          AND post.draft_version_id IS NOT version.id
          AND NOT EXISTS (
            SELECT 1
            FROM delivery_jobs AS active
            WHERE active.version_id = version.id
              AND active.status NOT IN ('succeeded', 'failed', 'outcome_unknown')
          )
      `).bind(
        jobId,
        dedupeKey,
        payload,
        queuedAt,
        queuedAt,
        candidate.id,
        candidate.superseded_at,
        versionCutoff,
      ).run();
      if (inserted.meta?.changes !== 1) continue;
    } else if (["queue_failed", "retrying", "failed"].includes(candidate.job_status ?? "")) {
      const requeued = await database.prepare(`
        UPDATE delivery_jobs
        SET status = 'queued', error_code = NULL, last_error = NULL,
          completed_at = NULL, updated_at = ?
        WHERE id = ? AND post_id = ? AND target = 'version' AND action = 'cleanup'
          AND payload_json = ? AND status IN ('queue_failed', 'retrying', 'failed')
          AND (
            EXISTS (
              SELECT 1
              FROM studio_post_versions AS version
              JOIN studio_posts AS post ON post.id = version.post_id
              WHERE version.id = ? AND version.state = 'superseded'
                AND version.superseded_at = ? AND version.superseded_at <= ?
                AND post.current_version_id IS NOT version.id
                AND post.draft_version_id IS NOT version.id
                AND NOT EXISTS (
                  SELECT 1
                  FROM delivery_jobs AS active
                  WHERE active.version_id = version.id
                    AND active.status NOT IN ('succeeded', 'failed', 'outcome_unknown')
                )
            ) OR (
              json_extract(payload_json, '$.versionId') = ?
              AND NOT EXISTS (
                SELECT 1 FROM studio_post_versions WHERE id = ?
              )
            )
          )
      `).bind(
        queuedAt,
        jobId,
        candidate.post_id,
        payload,
        candidate.id,
        candidate.superseded_at,
        versionCutoff,
        candidate.id,
        candidate.id,
      ).run();
      if (requeued.meta?.changes !== 1) continue;
    } else if (
      candidate.job_status !== "queued" &&
      !(candidate.job_status === "processing" && candidate.version_exists === 0)
    ) {
      continue;
    }

    try {
      await queue.send({
        type: "version_cleanup",
        jobId,
        versionId: candidate.id,
      });
      queued += 1;
    } catch {
      queueFailed += 1;
      await markVersionCleanupQueueFailure(database, jobId);
    }
  }
  return json(
    {
      queued,
      queueFailed,
      scanned: (assetRows.results?.length ?? 0) + (versionRows.results?.length ?? 0),
      ...(requestedAssetId ? { requestedAssetId } : {}),
    },
    queueFailed > 0 ? 503 : 202,
  );
}

export async function enqueueScheduledRetentionCleanup(env: PhaseAEnv) {
  const database = env.STUDIO_DB;
  const queue = env.PUBLISH_QUEUE;
  if (!database || !queue) throw new Error("asset_cleanup_unavailable");
  const response = await queueExpiredRetentionCleanup(
    new Request("https://studio.invalid/studio/api/assets/cleanup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    env,
    database,
    queue,
  );
  const result = await response.json() as unknown;
  if (!response.ok) {
    const error = typeof result === "object" && result !== null &&
        !Array.isArray(result) && typeof (result as { error?: unknown }).error === "string"
      ? (result as { error: string }).error
      : "asset_cleanup_unavailable";
    throw new Error(error);
  }
  return result;
}

function cleanupErrorCode(error: unknown) {
  const code = error instanceof Error ? error.message : "asset_cleanup_failed";
  return [
    "asset_cleanup_configuration_invalid",
    "asset_cleanup_ineligible",
    "asset_delete_failed",
    "asset_delete_unverified",
    "asset_prefix_not_empty",
    "asset_cache_purge_failed",
    "asset_manifest_unavailable",
    "post_purge_manifest_invalid",
    "post_purge_conflict",
  ].includes(code) ? code : "asset_cleanup_failed";
}

async function recordCleanupFailure(
  database: StudioD1,
  jobId: string,
  assetId: string,
  code: string,
  terminal: boolean,
) {
  const updatedAt = new Date().toISOString();
  await database.batch([
    database.prepare(`
      UPDATE delivery_jobs
      SET status = ?, error_code = ?, last_error = ?, updated_at = ?,
        completed_at = CASE WHEN ? = 1 THEN ? ELSE NULL END
      WHERE id = ? AND asset_id = ? AND target = 'asset' AND action = 'delete'
        AND status != 'succeeded'
    `).bind(
      terminal ? "failed" : "retrying",
      code,
      code,
      updatedAt,
      terminal ? 1 : 0,
      updatedAt,
      jobId,
      assetId,
    ),
    database.prepare(`
      UPDATE studio_assets
      SET processing_error = ?, updated_at = ?
      WHERE id = ? AND status IN ('orphan', 'deleting')
    `).bind(code, updatedAt, assetId),
  ]);
}

async function assetPrefixesEmpty(media: StudioR2, asset: CleanupJobRow) {
  const prefixes = [
    `${asset.created_prefix}/private/${asset.asset_id}/`,
    `${asset.created_prefix}/public/${asset.asset_id}/`,
  ];
  const listed = await Promise.all(
    prefixes.map((prefix) => media.list({ prefix, limit: 1 })),
  );
  if (listed.some((page) => page.truncated || page.objects.length !== 0)) {
    throw new Error("asset_prefix_not_empty");
  }
}

async function purgePublicAssetCache(
  config: NonNullable<ReturnType<typeof cleanupConfiguration>>,
  assetId: string,
) {
  const url = `${config.publicOrigin}/media/${assetId}/portfolio-v1.webp`;
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/purge_cache`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.cachePurgeToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ files: [url] }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    const result = await response.json() as { success?: unknown };
    if (!response.ok || result.success !== true) {
      throw new Error("asset_cache_purge_failed");
    }
  } catch {
    throw new Error("asset_cache_purge_failed");
  }
}

async function processPostPurgeAsset(
  database: StudioD1,
  media: StudioR2,
  config: NonNullable<ReturnType<typeof cleanupConfiguration>>,
  jobId: string,
  assetId: string,
  payload: PostPurgePayload,
) {
  const asset = await database.prepare(`
    SELECT job.id, job.post_id, job.asset_id, job.status,
      asset.status AS asset_status, asset.created_prefix,
      asset.private_source_key, asset.discord_r2_key, asset.public_r2_key,
      asset.orphaned_at, asset.first_published_at
    FROM delivery_jobs AS job
    JOIN studio_assets AS asset ON asset.id = job.asset_id
    JOIN studio_posts AS post ON post.id = job.post_id
    WHERE job.id = ? AND job.asset_id = ? AND job.status = 'processing'
      AND job.target = 'asset' AND job.action = 'delete'
      AND post.status = 'purging' AND asset.post_id = post.id
      AND NOT EXISTS (
        SELECT 1 FROM studio_post_version_assets WHERE asset_id = asset.id
      )
  `).bind(jobId, assetId).first<CleanupJobRow>();
  if (
    !asset ||
    payload.createdPrefix !== asset.created_prefix ||
    payload.privateSourceKey !== asset.private_source_key ||
    payload.discordR2Key !== asset.discord_r2_key ||
    payload.publicR2Key !== asset.public_r2_key
  ) {
    throw new Error("post_purge_manifest_invalid");
  }

  try {
    await media.delete([
      payload.privateSourceKey,
      payload.discordR2Key,
      payload.publicR2Key,
    ]);
  } catch {
    throw new Error("asset_delete_failed");
  }
  const remaining = await Promise.all([
    media.get(payload.privateSourceKey),
    media.get(payload.discordR2Key),
    media.get(payload.publicR2Key),
  ]);
  if (remaining.some(Boolean)) throw new Error("asset_delete_unverified");
  await assetPrefixesEmpty(media, asset);
  await purgePublicAssetCache(config, assetId);

  const purgedAt = new Date().toISOString();
  const finalized = await database.batch([
    database.prepare(`
      DELETE FROM studio_assets
      WHERE id = ? AND post_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM studio_post_version_assets
          WHERE asset_id = studio_assets.id
        )
        AND EXISTS (
          SELECT 1 FROM delivery_jobs
          WHERE id = ? AND asset_id = studio_assets.id
            AND target = 'asset' AND action = 'delete' AND status = 'processing'
            AND json_extract(payload_json, '$.mode') = 'post_purge'
        )
        AND EXISTS (
          SELECT 1 FROM studio_posts
          WHERE id = studio_assets.post_id AND status = 'purging'
        )
    `).bind(assetId, asset.post_id, jobId),
    purgeTombstoneStatement(database, asset.post_id, purgedAt),
  ]);
  if (finalized[0]?.meta?.changes !== 1) {
    throw new Error("post_purge_conflict");
  }
  return { action: "ack" as const };
}

export async function processStudioAssetCleanupJob(
  jobId: string,
  assetId: string,
  env: PhaseAEnv,
) {
  if (!uuidPattern.test(jobId) || !uuidPattern.test(assetId)) {
    return { action: "ack" as const };
  }
  const database = env.STUDIO_DB;
  const media = env.STUDIO_MEDIA;
  const config = cleanupConfiguration(env);
  if (!database || !media || !config) {
    throw new Error("asset_cleanup_configuration_invalid");
  }
  const claimedAt = new Date().toISOString();
  const claimed = await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'processing', attempts = attempts + 1,
      error_code = NULL, last_error = NULL, updated_at = ?
    WHERE id = ? AND asset_id = ? AND target = 'asset' AND action = 'delete'
      AND (
        status IN ('queued', 'retrying')
        OR (status = 'processing' AND updated_at <= ?)
      )
  `).bind(
    claimedAt,
    jobId,
    assetId,
    new Date(Date.now() - PROCESSING_LEASE_MS).toISOString(),
  ).run();
  if (claimed.meta?.changes !== 1) return { action: "ack" as const };

  const claimedJob = await database.prepare(`
    SELECT payload_json
    FROM delivery_jobs
    WHERE id = ? AND asset_id = ? AND target = 'asset' AND action = 'delete'
      AND status = 'processing'
  `).bind(jobId, assetId).first<{ payload_json: string }>();
  const purgePayload = claimedJob
    ? parsePostPurgePayload(claimedJob.payload_json)
    : null;
  if (purgePayload) {
    return processPostPurgeAsset(
      database,
      media,
      config,
      jobId,
      assetId,
      purgePayload,
    );
  }

  const cutoff = new Date(Date.now() - config.orphanDays * DAY_MS).toISOString();
  const asset = await database.prepare(`
    SELECT job.id, job.post_id, job.asset_id, job.status,
      asset.status AS asset_status, asset.created_prefix,
      asset.private_source_key, asset.discord_r2_key, asset.public_r2_key,
      asset.orphaned_at, asset.first_published_at
    FROM delivery_jobs AS job
    JOIN studio_assets AS asset ON asset.id = job.asset_id
    WHERE job.id = ? AND job.asset_id = ? AND job.status = 'processing'
      AND job.target = 'asset' AND job.action = 'delete'
      AND asset.status IN ('orphan', 'deleting')
      AND asset.orphaned_at IS NOT NULL AND asset.orphaned_at <= ?
      AND asset.first_published_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM studio_post_version_assets WHERE asset_id = asset.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM delivery_jobs AS active
        WHERE active.asset_id = asset.id AND active.id != job.id
          AND active.status NOT IN ('succeeded', 'failed', 'outcome_unknown')
      )
  `).bind(jobId, assetId, cutoff).first<CleanupJobRow>();
  if (!asset) throw new Error("asset_cleanup_ineligible");

  const marked = await database.prepare(`
    UPDATE studio_assets
    SET status = 'deleting', processing_error = NULL, updated_at = ?
    WHERE id = ? AND status IN ('orphan', 'deleting')
      AND first_published_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM studio_post_version_assets WHERE asset_id = studio_assets.id
      )
  `).bind(claimedAt, assetId).run();
  if (marked.meta?.changes !== 1) throw new Error("asset_cleanup_ineligible");

  try {
    await media.delete([
      asset.private_source_key,
      asset.discord_r2_key,
      asset.public_r2_key,
    ]);
  } catch {
    throw new Error("asset_delete_failed");
  }
  const remaining = await Promise.all([
    media.get(asset.private_source_key),
    media.get(asset.discord_r2_key),
    media.get(asset.public_r2_key),
  ]);
  if (remaining.some(Boolean)) throw new Error("asset_delete_unverified");
  await assetPrefixesEmpty(media, asset);
  await purgePublicAssetCache(config, assetId);

  const removed = await database.prepare(`
    DELETE FROM studio_assets
    WHERE id = ? AND status = 'deleting' AND first_published_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM studio_post_version_assets WHERE asset_id = studio_assets.id
      )
      AND EXISTS (
        SELECT 1 FROM delivery_jobs
        WHERE id = ? AND asset_id = studio_assets.id
          AND target = 'asset' AND action = 'delete' AND status = 'processing'
      )
  `).bind(assetId, jobId).run();
  if (removed.meta?.changes !== 1) throw new Error("asset_manifest_unavailable");
  return { action: "ack" as const };
}

export async function recoverStudioAssetCleanupFailure(
  jobId: string,
  assetId: string,
  env: PhaseAEnv,
  error: unknown,
  terminal: boolean,
) {
  if (!env.STUDIO_DB) return { action: "retry" as const, delaySeconds: 5 };
  await recordCleanupFailure(
    env.STUDIO_DB,
    jobId,
    assetId,
    cleanupErrorCode(error),
    terminal,
  );
  return terminal
    ? { action: "retry" as const }
    : { action: "retry" as const, delaySeconds: 5 };
}

function sameAssetIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

async function verifyRetiredAssetPrefixes(
  media: StudioR2,
  asset: VersionCleanupAssetRow,
) {
  const [privateObjects, publicObjects] = await Promise.all([
    media.list({
      prefix: `${asset.created_prefix}/private/${asset.id}/`,
      limit: 2,
    }),
    media.list({
      prefix: `${asset.created_prefix}/public/${asset.id}/`,
      limit: 1,
    }),
  ]);
  if (
    privateObjects.truncated ||
    privateObjects.objects.length !== 1 ||
    privateObjects.objects[0]?.key !== asset.private_source_key
  ) {
    throw new Error("asset_private_archive_invalid");
  }
  if (publicObjects.truncated || publicObjects.objects.length !== 0) {
    throw new Error("asset_prefix_not_empty");
  }
}

async function recordVersionCleanupFailure(
  database: StudioD1,
  jobId: string,
  code: string,
  terminal: boolean,
) {
  const updatedAt = new Date().toISOString();
  const job = await database.prepare(`
    SELECT payload_json
    FROM delivery_jobs
    WHERE id = ? AND target = 'version' AND action = 'cleanup'
  `).bind(jobId).first<{ payload_json: string }>();
  const payload = job ? parseVersionCleanupPayload(job.payload_json) : null;
  const statements = [
    database.prepare(`
      UPDATE delivery_jobs
      SET status = ?, error_code = ?, last_error = ?, updated_at = ?,
        completed_at = CASE WHEN ? = 1 THEN ? ELSE NULL END
      WHERE id = ? AND target = 'version' AND action = 'cleanup'
        AND status != 'succeeded'
    `).bind(
      terminal ? "failed" : "retrying",
      code,
      code,
      updatedAt,
      terminal ? 1 : 0,
      updatedAt,
      jobId,
    ),
    ...(payload?.assetIds ?? []).map((assetId) => database.prepare(`
      UPDATE studio_assets
      SET processing_error = ?, updated_at = ?
      WHERE id = ? AND status = 'orphan' AND first_published_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM studio_post_version_assets
          WHERE asset_id = studio_assets.id
        )
    `).bind(code, updatedAt, assetId)),
  ];
  await database.batch(statements);
}

export async function processStudioVersionCleanupJob(
  jobId: string,
  versionId: string,
  env: PhaseAEnv,
) {
  if (!uuidPattern.test(jobId) || !uuidPattern.test(versionId)) {
    return { action: "ack" as const };
  }
  const database = env.STUDIO_DB;
  const media = env.STUDIO_MEDIA;
  const config = cleanupConfiguration(env);
  if (!database || !media || !config) {
    throw new Error("asset_cleanup_configuration_invalid");
  }

  const claimedAt = new Date().toISOString();
  const claimed = await database.prepare(`
    UPDATE delivery_jobs
    SET status = 'processing', attempts = attempts + 1,
      error_code = NULL, last_error = NULL, updated_at = ?
    WHERE id = ? AND target = 'version' AND action = 'cleanup'
      AND (
        status IN ('queued', 'retrying')
        OR (status = 'processing' AND updated_at <= ?)
      )
  `).bind(
    claimedAt,
    jobId,
    new Date(Date.now() - PROCESSING_LEASE_MS).toISOString(),
  ).run();
  if (claimed.meta?.changes !== 1) return { action: "ack" as const };

  const job = await database.prepare(`
    SELECT id, post_id, status, payload_json
    FROM delivery_jobs
    WHERE id = ? AND target = 'version' AND action = 'cleanup'
      AND status = 'processing'
  `).bind(jobId).first<VersionCleanupJobRow>();
  const payload = job ? parseVersionCleanupPayload(job.payload_json) : null;
  if (!job || !payload || payload.versionId !== versionId) {
    throw new Error("version_cleanup_manifest_invalid");
  }
  const cutoff = new Date(Date.now() - config.rollbackDays * DAY_MS).toISOString();
  if (payload.supersededAt > cutoff) {
    throw new Error("version_cleanup_ineligible");
  }
  const version = await database.prepare(`
    SELECT version.id, version.post_id, version.state, version.superseded_at,
      post.current_version_id, post.draft_version_id
    FROM studio_post_versions AS version
    JOIN studio_posts AS post ON post.id = version.post_id
    WHERE version.id = ? AND version.post_id = ?
  `).bind(versionId, job.post_id).first<{
    id: string;
    post_id: string;
    state: string;
    superseded_at: string | null;
    current_version_id: string | null;
    draft_version_id: string | null;
  }>();

  if (version) {
    if (
      version.state !== "superseded" ||
      version.superseded_at !== payload.supersededAt ||
      version.superseded_at > cutoff ||
      version.current_version_id === versionId ||
      version.draft_version_id === versionId
    ) {
      throw new Error("version_cleanup_ineligible");
    }
    const selected = await database.prepare(`
      SELECT selected.asset_id, asset.first_published_at
      FROM studio_post_version_assets AS selected
      JOIN studio_assets AS asset ON asset.id = selected.asset_id
      WHERE selected.version_id = ?
      ORDER BY selected.ordinal ASC
    `).bind(versionId).all<{ asset_id: string; first_published_at: string | null }>();
    const selectedRows = selected.results ?? [];
    if (
      !sameAssetIds(selectedRows.map(({ asset_id }) => asset_id), payload.assetIds) ||
      selectedRows.some(({ first_published_at }) => first_published_at === null)
    ) {
      throw new Error("version_cleanup_manifest_invalid");
    }
    const active = await database.prepare(`
      SELECT count(*) AS count
      FROM delivery_jobs
      WHERE version_id = ?
        AND status NOT IN ('succeeded', 'failed', 'outcome_unknown')
    `).bind(versionId).first<{ count: number }>();
    if ((active?.count ?? 0) !== 0) throw new Error("version_cleanup_ineligible");

    const retiredAt = new Date().toISOString();
    const retired = await database.batch([
      database.prepare(`
        DELETE FROM studio_post_versions
        WHERE id = ? AND post_id = ? AND state = 'superseded'
          AND superseded_at = ? AND superseded_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM studio_posts
            WHERE id = ?
              AND (current_version_id = ? OR draft_version_id = ?)
          )
          AND NOT EXISTS (
            SELECT 1 FROM delivery_jobs
            WHERE version_id = ?
              AND status NOT IN ('succeeded', 'failed', 'outcome_unknown')
          )
          AND EXISTS (
            SELECT 1 FROM delivery_jobs
            WHERE id = ? AND post_id = ? AND target = 'version'
              AND action = 'cleanup' AND status = 'processing'
              AND json_extract(payload_json, '$.versionId') = ?
          )
      `).bind(
        versionId,
        job.post_id,
        payload.supersededAt,
        cutoff,
        job.post_id,
        versionId,
        versionId,
        versionId,
        jobId,
        job.post_id,
        versionId,
      ),
      ...payload.assetIds.map((assetId) => database.prepare(`
        UPDATE studio_assets
        SET status = 'orphan', orphaned_at = coalesce(orphaned_at, ?),
          processing_error = NULL, updated_at = ?
        WHERE id = ? AND post_id = ? AND status = 'ready'
          AND first_published_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM studio_post_version_assets
            WHERE asset_id = studio_assets.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM delivery_jobs
            WHERE asset_id = studio_assets.id
              AND status NOT IN ('succeeded', 'failed', 'outcome_unknown')
          )
      `).bind(retiredAt, retiredAt, assetId, job.post_id)),
    ]);
    if (retired[0]?.meta?.changes !== 1) {
      throw new Error("version_cleanup_conflict");
    }
  }

  for (const assetId of payload.assetIds) {
    const asset = await database.prepare(`
      SELECT id, status, created_prefix, private_source_key,
        discord_r2_key, public_r2_key, first_published_at
      FROM studio_assets
      WHERE id = ? AND post_id = ? AND status = 'orphan'
        AND first_published_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM studio_post_version_assets
          WHERE asset_id = studio_assets.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM delivery_jobs
          WHERE asset_id = studio_assets.id
            AND status NOT IN ('succeeded', 'failed', 'outcome_unknown')
        )
    `).bind(assetId, job.post_id).first<VersionCleanupAssetRow>();
    if (!asset) continue;
    if (!(await media.get(asset.private_source_key))) {
      throw new Error("asset_private_source_missing");
    }
    try {
      await media.delete([asset.discord_r2_key, asset.public_r2_key]);
    } catch {
      throw new Error("asset_delete_failed");
    }
    const remaining = await Promise.all([
      media.get(asset.discord_r2_key),
      media.get(asset.public_r2_key),
    ]);
    if (remaining.some(Boolean)) throw new Error("asset_delete_unverified");
    await verifyRetiredAssetPrefixes(media, asset);
    await purgePublicAssetCache(config, asset.id);
  }

  const completedAt = new Date().toISOString();
  const completed = await database.batch([
    database.prepare(`
      UPDATE delivery_jobs
      SET status = 'succeeded', error_code = NULL, last_error = NULL,
        updated_at = ?, completed_at = ?
      WHERE id = ? AND target = 'version' AND action = 'cleanup'
        AND status = 'processing'
    `).bind(completedAt, completedAt, jobId),
    ...payload.assetIds.map((assetId) => database.prepare(`
      UPDATE studio_assets
      SET processing_error = NULL, updated_at = ?
      WHERE id = ? AND status = 'orphan' AND first_published_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM studio_post_version_assets
          WHERE asset_id = studio_assets.id
        )
    `).bind(completedAt, assetId)),
  ]);
  if (completed[0]?.meta?.changes !== 1) {
    throw new Error("version_cleanup_conflict");
  }
  return { action: "ack" as const };
}

export async function recoverStudioVersionCleanupFailure(
  jobId: string,
  env: PhaseAEnv,
  error: unknown,
  terminal: boolean,
) {
  if (!env.STUDIO_DB) return { action: "retry" as const, delaySeconds: 5 };
  const rawCode = error instanceof Error ? error.message : "version_cleanup_failed";
  const code = [
    "asset_cleanup_configuration_invalid",
    "version_cleanup_manifest_invalid",
    "version_cleanup_ineligible",
    "version_cleanup_conflict",
    "asset_private_source_missing",
    "asset_private_archive_invalid",
    "asset_delete_failed",
    "asset_delete_unverified",
    "asset_prefix_not_empty",
    "asset_cache_purge_failed",
  ].includes(rawCode) ? rawCode : "version_cleanup_failed";
  await recordVersionCleanupFailure(env.STUDIO_DB, jobId, code, terminal);
  return terminal
    ? { action: "retry" as const }
    : { action: "retry" as const, delaySeconds: 5 };
}

export async function handleStudioAssetRequest(
  request: Request,
  env: PhaseAEnv,
) {
  const database = env.STUDIO_DB;
  const media = env.STUDIO_MEDIA;
  const images = env.IMAGES;
  const queue = env.PUBLISH_QUEUE;
  if (!database || !media || !images || !queue) {
    return json({ error: "asset_storage_unavailable" }, 503);
  }

  try {
    const pathname = new URL(request.url).pathname;
    if (pathname === ASSETS_PATH) {
      if (request.method === "GET") {
        return new URL(request.url).searchParams.get("view") === "media"
          ? listMedia(request, env, database)
          : listAssets(request, database);
      }
      if (request.method === "POST") {
        return uploadSource(request, database, media, images, queue);
      }
      if (request.method === "PATCH") {
        return updateAssetManifest(request, database);
      }
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, POST, PATCH" },
      });
    }

    if (pathname === ASSET_CLEANUP_PATH) {
      if (request.method === "POST") {
        return queueExpiredRetentionCleanup(request, env, database, queue);
      }
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "POST" },
      });
    }

    const remainder = pathname.slice(`${ASSETS_PATH}/`.length);
    const [assetId, action, ...extra] = remainder.split("/");
    if (!assetId || extra.length > 0 || (action && action !== "preview")) {
      return json({ error: "asset_not_found" }, 404);
    }
    if (action === "preview") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "GET" },
        });
      }
      return previewAsset(request, assetId, database, media);
    }
    if (request.method === "POST") {
      return retryAsset(request, assetId, database, queue);
    }
    if (request.method !== "DELETE") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "POST, DELETE" },
      });
    }
    return deleteAsset(request, assetId, database);
  } catch {
    return json({ error: "asset_storage_unavailable" }, 503);
  }
}
