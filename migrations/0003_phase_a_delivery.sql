-- Phase A derivative and delivery outbox. Keep immutable after remote apply.
PRAGMA foreign_keys = ON;

ALTER TABLE studio_assets ADD COLUMN public_bytes INTEGER CHECK (
  public_bytes IS NULL OR public_bytes > 0
);
ALTER TABLE studio_assets ADD COLUMN public_sha256 TEXT CHECK (
  public_sha256 IS NULL OR (
    length(public_sha256) = 64 AND public_sha256 NOT GLOB '*[^0-9a-f]*'
  )
);
ALTER TABLE studio_assets ADD COLUMN public_width INTEGER CHECK (
  public_width IS NULL OR public_width > 0
);
ALTER TABLE studio_assets ADD COLUMN public_height INTEGER CHECK (
  public_height IS NULL OR public_height > 0
);
ALTER TABLE studio_assets ADD COLUMN discord_bytes INTEGER CHECK (
  discord_bytes IS NULL OR discord_bytes > 0
);
ALTER TABLE studio_assets ADD COLUMN discord_sha256 TEXT CHECK (
  discord_sha256 IS NULL OR (
    length(discord_sha256) = 64 AND discord_sha256 NOT GLOB '*[^0-9a-f]*'
  )
);
ALTER TABLE studio_assets ADD COLUMN discord_width INTEGER CHECK (
  discord_width IS NULL OR discord_width > 0
);
ALTER TABLE studio_assets ADD COLUMN discord_height INTEGER CHECK (
  discord_height IS NULL OR discord_height > 0
);
ALTER TABLE studio_assets ADD COLUMN processing_error TEXT;

CREATE TABLE delivery_jobs (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  dedupe_key TEXT NOT NULL UNIQUE,
  post_id TEXT NOT NULL REFERENCES studio_posts(id) ON DELETE CASCADE,
  version_id TEXT REFERENCES studio_post_versions(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES studio_assets(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  remote_id TEXT,
  remote_aux_id TEXT,
  remote_attachment_ids TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'queued',
      'processing',
      'retrying',
      'queue_failed',
      'verifying',
      'finalizing',
      'succeeded',
      'failed',
      'outcome_unknown'
    )
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expected_hash TEXT CHECK (expected_hash IS NULL OR length(expected_hash) = 64),
  delivered_hash TEXT CHECK (delivered_hash IS NULL OR length(delivered_hash) = 64),
  error_code TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (target = 'asset' AND asset_id IS NOT NULL AND action = 'process') OR
    (target = 'discord' AND asset_id IS NULL AND action IN ('create', 'update', 'delete'))
  )
);

CREATE INDEX idx_delivery_jobs_post_created_at
ON delivery_jobs (post_id, created_at DESC, id);

CREATE INDEX idx_delivery_jobs_status_updated_at
ON delivery_jobs (status, updated_at, id);

CREATE UNIQUE INDEX idx_studio_post_versions_active_candidate
ON studio_post_versions (post_id)
WHERE state = 'candidate' AND superseded_at IS NULL;

PRAGMA optimize;
