-- Phase A private source upload slice. Keep immutable after remote apply.
PRAGMA foreign_keys = ON;

CREATE TABLE studio_assets (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  post_id TEXT NOT NULL REFERENCES studio_posts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (
    status IN ('uploading', 'processing', 'ready', 'orphan', 'failed', 'deleting')
  ),
  created_prefix TEXT NOT NULL,
  title_snapshot TEXT NOT NULL CHECK (length(title_snapshot) BETWEEN 1 AND 40),
  width INTEGER NOT NULL CHECK (width > 0 AND width <= 8192),
  height INTEGER NOT NULL CHECK (height > 0 AND height <= 8192),
  source_mime TEXT NOT NULL CHECK (
    source_mime IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  source_bytes INTEGER NOT NULL CHECK (source_bytes > 0 AND source_bytes <= 20971520),
  source_sha256 TEXT NOT NULL CHECK (
    length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  private_source_key TEXT NOT NULL UNIQUE,
  discord_r2_key TEXT NOT NULL UNIQUE,
  public_r2_key TEXT NOT NULL UNIQUE,
  orphaned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (width * height <= 40000000)
);

CREATE TABLE studio_post_version_assets (
  version_id TEXT NOT NULL REFERENCES studio_post_versions(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES studio_assets(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  alt TEXT NOT NULL CHECK (length(alt) BETWEEN 1 AND 1000),
  PRIMARY KEY (version_id, asset_id),
  UNIQUE (version_id, ordinal)
);

CREATE INDEX idx_studio_assets_post_created_at
ON studio_assets (post_id, created_at, id);

PRAGMA optimize;
