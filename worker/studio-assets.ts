import type {
  PhaseAEnv,
  StudioD1,
  StudioImageInfo,
  StudioImages,
  StudioR2,
} from "./phase-a-env";
import type { AssetStatus } from "../db/schema";

const ASSETS_PATH = "/studio/api/assets";
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_SOURCE_BYTES + 64 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SourceMime = "image/jpeg" | "image/png" | "image/webp";

type DraftContext = {
  post_id: string;
  version_id: string;
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
  ordinal: number;
  alt: string;
  created_at: string;
};

type DeletingAssetRow = {
  post_id: string;
  version_id: string;
  ordinal: number;
  status: string;
  private_source_key: string;
  discord_r2_key: string;
  public_r2_key: string;
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

async function hashSource(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return { digest, hex };
}

async function draftContext(database: StudioD1, postId: string) {
  return database.prepare(`
    SELECT post.id AS post_id, version.id AS version_id, version.title,
      (
        SELECT count(*)
        FROM studio_post_version_assets
        WHERE version_id = version.id
      ) AS asset_count
    FROM studio_posts AS post
    JOIN studio_post_versions AS version ON version.id = post.draft_version_id
    WHERE post.id = ? AND post.status = 'draft' AND version.state = 'draft'
  `).bind(postId).first<DraftContext>();
}

async function listAssets(request: Request, database: StudioD1) {
  const postId = new URL(request.url).searchParams.get("postId");
  if (!postId || !uuidPattern.test(postId)) {
    return json({ error: "invalid_post_id" }, 400);
  }
  const context = await draftContext(database, postId);
  if (!context) return json({ error: "draft_not_found" }, 404);

  const rows = await database.prepare(`
    SELECT asset.id, asset.status, asset.width, asset.height,
      asset.source_mime, asset.source_bytes, selected.ordinal, selected.alt,
      asset.created_at
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
      ordinal: asset.ordinal,
      alt: asset.alt,
      createdAt: asset.created_at,
    })),
  });
}

function exactUploadFields(form: FormData) {
  const expected = new Set(["postId", "ordinal", "alt", "file"]);
  const keys = [...form.keys()];
  return (
    keys.every((key) => expected.has(key)) &&
    [...expected].every((key) => form.getAll(key).length === 1)
  );
}

async function markFailed(database: StudioD1, assetId: string) {
  try {
    await database.prepare(`
      UPDATE studio_assets
      SET status = 'failed', updated_at = ?
      WHERE id = ? AND status = 'uploading'
    `).bind(new Date().toISOString(), assetId).run();
  } catch {
    // The uploading row and exact key remain recoverable if this write fails.
  }
}

async function uploadSource(
  request: Request,
  database: StudioD1,
  media: StudioR2,
  images: StudioImages,
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
  const ordinalText = form.get("ordinal");
  const alt = normalizeAlt(form.get("alt"));
  const file = form.get("file");
  if (
    typeof postId !== "string" ||
    !uuidPattern.test(postId) ||
    typeof ordinalText !== "string" ||
    !/^\d$/u.test(ordinalText) ||
    !alt ||
    !(file instanceof File)
  ) {
    return json({ error: "invalid_upload_fields" }, 400);
  }
  const ordinal = Number(ordinalText);
  if (file.size < 1 || file.size > MAX_SOURCE_BYTES) {
    return json({ error: "invalid_image_size" }, file.size > MAX_SOURCE_BYTES ? 413 : 400);
  }

  const context = await draftContext(database, postId);
  if (!context) return json({ error: "draft_not_found" }, 404);
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
  const sourceHash = await hashSource(source);

  await database.batch([
    database.prepare(`
      INSERT INTO studio_assets (
        id, post_id, status, created_prefix, title_snapshot, width, height,
        source_mime, source_bytes, source_sha256, private_source_key,
        discord_r2_key, public_r2_key, created_at, updated_at
      ) VALUES (?, ?, 'uploading', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      assetId,
      postId,
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
    ),
    database.prepare(`
      INSERT INTO studio_post_version_assets (version_id, asset_id, ordinal, alt)
      VALUES (?, ?, ?, ?)
    `).bind(context.version_id, assetId, ordinal, alt),
  ]);

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
      await markFailed(database, assetId);
      return json({ error: "asset_storage_failed", assetId }, 503);
    }
  } catch {
    await markFailed(database, assetId);
    return json({ error: "asset_storage_failed", assetId }, 503);
  }

  const updated = await database.prepare(`
    UPDATE studio_assets
    SET status = 'processing', updated_at = ?
    WHERE id = ? AND post_id = ? AND status = 'uploading'
  `).bind(new Date().toISOString(), assetId, postId).run();
  if (updated.meta?.changes !== 1) {
    return json({ error: "asset_manifest_unavailable", assetId }, 503);
  }

  return json(
    {
      assetId,
      status: "processing",
      width: info.width,
      height: info.height,
      sourceMime,
      sourceBytes: source.byteLength,
      ordinal,
      alt,
      createdAt: createdAtText,
    },
    201,
  );
}

async function deleteAsset(
  request: Request,
  assetId: string,
  database: StudioD1,
  media: StudioR2,
) {
  if (!uuidPattern.test(assetId)) return json({ error: "invalid_asset_id" }, 400);
  try {
    const body = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body as object).length !== 0
    ) {
      return json({ error: "invalid_json_object" }, 400);
    }
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const asset = await database.prepare(`
    SELECT asset.post_id, selected.version_id, selected.ordinal, asset.status,
      asset.private_source_key, asset.discord_r2_key, asset.public_r2_key
    FROM studio_assets AS asset
    JOIN studio_posts AS post ON post.id = asset.post_id
    JOIN studio_post_versions AS version ON version.id = post.draft_version_id
    JOIN studio_post_version_assets AS selected
      ON selected.asset_id = asset.id AND selected.version_id = version.id
    WHERE asset.id = ? AND post.status = 'draft' AND version.state = 'draft'
      AND NOT EXISTS (
        SELECT 1
        FROM studio_post_version_assets AS other
        WHERE other.asset_id = asset.id AND other.version_id != version.id
      )
  `).bind(assetId).first<DeletingAssetRow>();
  if (!asset) return json({ error: "asset_not_found" }, 404);
  if (asset.status !== "deleting") {
    const marked = await database.prepare(`
      UPDATE studio_assets
      SET status = 'deleting', updated_at = ?
      WHERE id = ? AND post_id = ? AND status = ?
    `).bind(
      new Date().toISOString(),
      assetId,
      asset.post_id,
      asset.status,
    ).run();
    if (marked.meta?.changes !== 1) {
      return json({ error: "asset_delete_conflict" }, 409);
    }
  }

  try {
    await media.delete([
      asset.private_source_key,
      asset.discord_r2_key,
      asset.public_r2_key,
    ]);
  } catch {
    return json({ error: "asset_delete_failed" }, 503);
  }

  const results = await database.batch([
    database.prepare(`
      DELETE FROM studio_post_version_assets
      WHERE version_id = ? AND asset_id = ?
    `).bind(asset.version_id, assetId),
    database.prepare(`
      UPDATE studio_post_version_assets
      SET ordinal = ordinal + 100
      WHERE version_id = ? AND ordinal > ?
    `).bind(asset.version_id, asset.ordinal),
    database.prepare(`
      UPDATE studio_post_version_assets
      SET ordinal = ordinal - 101
      WHERE version_id = ? AND ordinal >= 100
    `).bind(asset.version_id),
    database.prepare(`
      DELETE FROM studio_assets
      WHERE id = ? AND post_id = ? AND status = 'deleting'
    `).bind(assetId, asset.post_id),
  ]);
  if (results[3]?.meta?.changes !== 1) {
    return json({ error: "asset_manifest_unavailable" }, 503);
  }
  return new Response(null, { status: 204 });
}

export async function handleStudioAssetRequest(
  request: Request,
  env: PhaseAEnv,
) {
  const database = env.STUDIO_DB;
  const media = env.STUDIO_MEDIA;
  const images = env.IMAGES;
  if (!database || !media || !images) {
    return json({ error: "asset_storage_unavailable" }, 503);
  }

  try {
    const pathname = new URL(request.url).pathname;
    if (pathname === ASSETS_PATH) {
      if (request.method === "GET") return listAssets(request, database);
      if (request.method === "POST") {
        return uploadSource(request, database, media, images);
      }
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, POST" },
      });
    }

    const assetId = pathname.slice(`${ASSETS_PATH}/`.length);
    if (!assetId || assetId.includes("/")) {
      return json({ error: "asset_not_found" }, 404);
    }
    if (request.method !== "DELETE") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "DELETE" },
      });
    }
    return deleteAsset(request, assetId, database, media);
  } catch {
    return json({ error: "asset_storage_unavailable" }, 503);
  }
}
