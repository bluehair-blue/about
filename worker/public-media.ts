import { findPublicAsset } from "../lib/public-projection";
import type { PhaseAEnv } from "./phase-a-env";

const mediaPathPattern =
  /^\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/portfolio-v1\.webp$/iu;

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function plain(status: number, message: string, allow?: string) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  if (allow) headers.set("allow", allow);
  return new Response(message, { status, headers });
}

export function publicMediaAssetId(pathname: string) {
  return mediaPathPattern.exec(pathname)?.[1] ?? null;
}

export async function handlePublicMedia(
  request: Request,
  assetId: string,
  env: PhaseAEnv,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return plain(405, "Method not allowed", "GET, HEAD");
  }
  if (!env.STUDIO_DB || !env.STUDIO_MEDIA) {
    return plain(503, "Public media is not configured");
  }

  const asset = await findPublicAsset(env.STUDIO_DB, assetId);
  if (!asset) return plain(404, "Not found");
  const object = await env.STUDIO_MEDIA.get(asset.public_r2_key);
  if (
    !object ||
    object.size !== Number(asset.public_bytes) ||
    !object.checksums?.sha256 ||
    hex(object.checksums.sha256) !== asset.public_sha256
  ) {
    return plain(404, "Not found");
  }

  const etag = `"${asset.public_sha256}"`;
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-length": String(asset.public_bytes),
    "content-type": "image/webp",
    etag,
    "x-content-type-options": "nosniff",
  });
  if (request.headers.get("if-none-match") === etag) {
    headers.delete("content-length");
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
}
