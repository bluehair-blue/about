-- Phase D keeps daily Discord reads in the existing delivery outbox. A check
-- owns one approved version and exact mapping, but never owns an asset or an
-- expected delivery hash because it observes rather than mutates Discord.
PRAGMA legacy_alter_table = ON;
ALTER TABLE delivery_jobs RENAME TO delivery_jobs_check_previous;

CREATE TABLE delivery_jobs (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  dedupe_key TEXT NOT NULL UNIQUE,
  post_id TEXT REFERENCES studio_posts(id) ON DELETE CASCADE,
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
    (
      target = 'discord'
      AND action = 'taxonomy'
      AND post_id IS NULL
      AND version_id IS NULL
      AND asset_id IS NULL
      AND expected_hash IS NULL
      AND delivered_hash IS NULL
    ) OR (
      post_id IS NOT NULL AND (
        (target = 'asset' AND asset_id IS NOT NULL AND action IN ('process', 'delete')) OR
        (target = 'version' AND action = 'cleanup' AND version_id IS NULL AND asset_id IS NULL) OR
        (
          target = 'discord' AND asset_id IS NULL AND (
            action IN ('create', 'update', 'delete') OR (
              action = 'check'
              AND version_id IS NOT NULL
              AND remote_id IS NOT NULL
              AND remote_aux_id IS NOT NULL
              AND expected_hash IS NULL
            )
          )
        ) OR
        (target = 'notification' AND version_id IS NOT NULL AND asset_id IS NULL AND action = 'send') OR
        (target = 'cache' AND asset_id IS NOT NULL AND action = 'purge')
      )
    )
  )
);

INSERT INTO delivery_jobs (
  id, dedupe_key, post_id, version_id, asset_id, target, action,
  payload_json, remote_id, remote_aux_id, remote_attachment_ids, status,
  attempts, expected_hash, delivered_hash, error_code, last_error,
  created_at, updated_at, completed_at
)
SELECT
  id, dedupe_key, post_id, version_id, asset_id, target, action,
  payload_json, remote_id, remote_aux_id, remote_attachment_ids, status,
  attempts, expected_hash, delivered_hash, error_code, last_error,
  created_at, updated_at, completed_at
FROM delivery_jobs_check_previous;

DROP TABLE delivery_jobs_check_previous;
PRAGMA legacy_alter_table = OFF;

CREATE INDEX idx_delivery_jobs_post_created_at
ON delivery_jobs (post_id, created_at DESC, id);

CREATE INDEX idx_delivery_jobs_status_updated_at
ON delivery_jobs (status, updated_at, id);

CREATE INDEX idx_delivery_jobs_asset_created_at
ON delivery_jobs (asset_id, created_at DESC, id)
WHERE asset_id IS NOT NULL;

CREATE INDEX idx_delivery_jobs_post_target_created_at
ON delivery_jobs (post_id, target, created_at DESC, id);

CREATE UNIQUE INDEX idx_delivery_jobs_active_taxonomy
ON delivery_jobs ((1))
WHERE target = 'discord'
  AND action = 'taxonomy'
  AND status NOT IN ('succeeded', 'failed', 'outcome_unknown');

CREATE TRIGGER trg_delivery_jobs_hash_insert
BEFORE INSERT ON delivery_jobs
FOR EACH ROW
WHEN (NEW.expected_hash IS NOT NULL AND (
  length(NEW.expected_hash) != 64
  OR NEW.expected_hash GLOB '*[^0-9a-f]*'
)) OR (NEW.delivered_hash IS NOT NULL AND (
  length(NEW.delivered_hash) != 64
  OR NEW.delivered_hash GLOB '*[^0-9a-f]*'
))
BEGIN
  SELECT RAISE(ABORT, 'delivery_hash_invalid');
END;

CREATE TRIGGER trg_delivery_jobs_owner_insert
BEFORE INSERT ON delivery_jobs
FOR EACH ROW
WHEN (NEW.version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  WHERE version.id = NEW.version_id AND version.post_id = NEW.post_id
)) OR (NEW.asset_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM studio_assets AS asset
  WHERE asset.id = NEW.asset_id AND asset.post_id = NEW.post_id
))
BEGIN
  SELECT RAISE(ABORT, 'delivery_post_mismatch');
END;

CREATE TRIGGER trg_delivery_jobs_owner_update
BEFORE UPDATE OF post_id, version_id, asset_id ON delivery_jobs
FOR EACH ROW
WHEN (NEW.version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  WHERE version.id = NEW.version_id AND version.post_id = NEW.post_id
)) OR (NEW.asset_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM studio_assets AS asset
  WHERE asset.id = NEW.asset_id AND asset.post_id = NEW.post_id
))
BEGIN
  SELECT RAISE(ABORT, 'delivery_post_mismatch');
END;

CREATE TRIGGER trg_delivery_jobs_identity_immutable
BEFORE UPDATE OF
  dedupe_key,
  post_id,
  version_id,
  asset_id,
  target,
  action,
  payload_json,
  expected_hash,
  created_at
ON delivery_jobs
FOR EACH ROW
WHEN NEW.dedupe_key IS NOT OLD.dedupe_key
  OR NEW.post_id IS NOT OLD.post_id
  OR NEW.version_id IS NOT OLD.version_id
  OR NEW.asset_id IS NOT OLD.asset_id
  OR NEW.target IS NOT OLD.target
  OR NEW.action IS NOT OLD.action
  OR NEW.payload_json IS NOT OLD.payload_json
  OR NEW.expected_hash IS NOT OLD.expected_hash
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'delivery_identity_immutable');
END;

CREATE TRIGGER trg_delivery_jobs_candidate_delete
BEFORE DELETE ON delivery_jobs
FOR EACH ROW
WHEN OLD.target = 'discord'
  AND OLD.action IN ('create', 'update')
  AND EXISTS (
    SELECT 1
    FROM studio_post_versions AS version
    JOIN studio_posts AS post ON post.id = version.post_id
    WHERE version.id = OLD.version_id
      AND version.state = 'candidate'
      AND post.status NOT IN ('purging', 'purged')
  )
BEGIN
  SELECT RAISE(ABORT, 'candidate_job_delete_invalid');
END;

CREATE TRIGGER trg_delivery_jobs_hash_update
BEFORE UPDATE OF expected_hash, delivered_hash ON delivery_jobs
FOR EACH ROW
WHEN (NEW.expected_hash IS NOT NULL AND (
  length(NEW.expected_hash) != 64
  OR NEW.expected_hash GLOB '*[^0-9a-f]*'
)) OR (NEW.delivered_hash IS NOT NULL AND (
  length(NEW.delivered_hash) != 64
  OR NEW.delivered_hash GLOB '*[^0-9a-f]*'
))
BEGIN
  SELECT RAISE(ABORT, 'delivery_hash_invalid');
END;
