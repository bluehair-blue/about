-- Phase B canonical asset manifest and retention cleanup safety.
PRAGMA foreign_keys = ON;

ALTER TABLE studio_assets ADD COLUMN first_published_at TEXT;

-- Preserve an irreversible marker before later retention work removes old
-- version metadata. Once set, automatic cleanup must keep the private source.
UPDATE studio_assets
SET first_published_at = (
  SELECT min(version.updated_at)
  FROM studio_post_version_assets AS selected
  JOIN studio_post_versions AS version ON version.id = selected.version_id
  WHERE selected.asset_id = studio_assets.id
    AND version.state IN ('published', 'superseded')
)
WHERE EXISTS (
  SELECT 1
  FROM studio_post_version_assets AS selected
  JOIN studio_post_versions AS version ON version.id = selected.version_id
  WHERE selected.asset_id = studio_assets.id
    AND version.state IN ('published', 'superseded')
);

-- Version-retention jobs must survive deletion of the expired version so a
-- retry can finish R2 verification and cache eviction from its immutable
-- payload. They therefore keep only the post foreign key.
PRAGMA legacy_alter_table = ON;
ALTER TABLE delivery_jobs RENAME TO delivery_jobs_asset_previous;

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
        (target = 'discord' AND asset_id IS NULL AND action IN ('create', 'update', 'delete')) OR
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
FROM delivery_jobs_asset_previous;

DROP TABLE delivery_jobs_asset_previous;
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

CREATE INDEX idx_studio_post_versions_superseded_at
ON studio_post_versions (superseded_at, id)
WHERE state = 'superseded';

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

CREATE TRIGGER trg_studio_assets_manifest_insert
BEFORE INSERT ON studio_assets
FOR EACH ROW
WHEN NEW.private_source_key != NEW.created_prefix || '/private/' || NEW.id ||
    CASE NEW.source_mime
      WHEN 'image/jpeg' THEN '/source.jpg'
      WHEN 'image/png' THEN '/source.png'
      WHEN 'image/webp' THEN '/source.webp'
      ELSE '/source.invalid'
    END
  OR NEW.discord_r2_key != NEW.created_prefix || '/private/' || NEW.id || '/discord-v1.webp'
  OR NEW.public_r2_key != NEW.created_prefix || '/public/' || NEW.id || '/portfolio-v1.webp'
  OR EXISTS (
    SELECT 1
    FROM studio_assets AS other
    WHERE NEW.private_source_key IN (
        other.private_source_key, other.discord_r2_key, other.public_r2_key
      )
      OR NEW.discord_r2_key IN (
        other.private_source_key, other.discord_r2_key, other.public_r2_key
      )
      OR NEW.public_r2_key IN (
        other.private_source_key, other.discord_r2_key, other.public_r2_key
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'asset_manifest_invalid');
END;

CREATE TRIGGER trg_studio_assets_manifest_update
BEFORE UPDATE OF
  created_prefix,
  source_mime,
  private_source_key,
  discord_r2_key,
  public_r2_key
ON studio_assets
FOR EACH ROW
WHEN NEW.private_source_key != NEW.created_prefix || '/private/' || NEW.id ||
    CASE NEW.source_mime
      WHEN 'image/jpeg' THEN '/source.jpg'
      WHEN 'image/png' THEN '/source.png'
      WHEN 'image/webp' THEN '/source.webp'
      ELSE '/source.invalid'
    END
  OR NEW.discord_r2_key != NEW.created_prefix || '/private/' || NEW.id || '/discord-v1.webp'
  OR NEW.public_r2_key != NEW.created_prefix || '/public/' || NEW.id || '/portfolio-v1.webp'
  OR EXISTS (
    SELECT 1
    FROM studio_assets AS other
    WHERE other.id != NEW.id
      AND (
        NEW.private_source_key IN (
          other.private_source_key, other.discord_r2_key, other.public_r2_key
        )
        OR NEW.discord_r2_key IN (
          other.private_source_key, other.discord_r2_key, other.public_r2_key
        )
        OR NEW.public_r2_key IN (
          other.private_source_key, other.discord_r2_key, other.public_r2_key
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'asset_manifest_invalid');
END;

DROP TRIGGER trg_studio_assets_post_immutable;

CREATE TRIGGER trg_studio_assets_identity_immutable
BEFORE UPDATE OF
  post_id,
  created_prefix,
  title_snapshot,
  width,
  height,
  source_mime,
  source_bytes,
  source_sha256,
  private_source_key,
  discord_r2_key,
  public_r2_key,
  created_at
ON studio_assets
FOR EACH ROW
WHEN NEW.post_id IS NOT OLD.post_id
  OR NEW.created_prefix IS NOT OLD.created_prefix
  OR NEW.title_snapshot IS NOT OLD.title_snapshot
  OR NEW.width IS NOT OLD.width
  OR NEW.height IS NOT OLD.height
  OR NEW.source_mime IS NOT OLD.source_mime
  OR NEW.source_bytes IS NOT OLD.source_bytes
  OR NEW.source_sha256 IS NOT OLD.source_sha256
  OR NEW.private_source_key IS NOT OLD.private_source_key
  OR NEW.discord_r2_key IS NOT OLD.discord_r2_key
  OR NEW.public_r2_key IS NOT OLD.public_r2_key
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'asset_identity_immutable');
END;

CREATE TRIGGER trg_studio_assets_first_published_immutable
BEFORE UPDATE OF first_published_at ON studio_assets
FOR EACH ROW
WHEN OLD.first_published_at IS NOT NULL
  AND NEW.first_published_at IS NOT OLD.first_published_at
BEGIN
  SELECT RAISE(ABORT, 'asset_first_published_immutable');
END;

CREATE TRIGGER trg_studio_assets_status_transition
BEFORE UPDATE OF status ON studio_assets
FOR EACH ROW
WHEN NEW.status != OLD.status
  AND NOT (
    (OLD.status = 'uploading' AND NEW.status IN ('processing', 'failed', 'orphan', 'deleting'))
    OR (OLD.status = 'processing' AND NEW.status IN ('ready', 'failed', 'orphan', 'deleting'))
    OR (OLD.status = 'failed' AND NEW.status IN ('processing', 'orphan', 'deleting'))
    OR (OLD.status = 'ready' AND NEW.status IN ('orphan', 'deleting'))
    OR (OLD.status = 'orphan' AND NEW.status = 'deleting')
  )
BEGIN
  SELECT RAISE(ABORT, 'asset_status_transition_invalid');
END;

CREATE TRIGGER trg_studio_assets_state_insert
BEFORE INSERT ON studio_assets
FOR EACH ROW
WHEN (NEW.status = 'orphan' AND NEW.orphaned_at IS NULL)
  OR (NEW.status NOT IN ('orphan', 'deleting') AND NEW.orphaned_at IS NOT NULL)
  OR (
    NEW.status = 'ready' AND (
      NEW.public_bytes IS NULL
      OR NEW.public_sha256 IS NULL
      OR NEW.public_width IS NULL
      OR NEW.public_height IS NULL
      OR NEW.discord_bytes IS NULL
      OR NEW.discord_sha256 IS NULL
      OR NEW.discord_width IS NULL
      OR NEW.discord_height IS NULL
      OR NEW.processing_error IS NOT NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'asset_state_invalid');
END;

CREATE TRIGGER trg_studio_assets_state_update
BEFORE UPDATE OF
  status,
  orphaned_at,
  public_bytes,
  public_sha256,
  public_width,
  public_height,
  discord_bytes,
  discord_sha256,
  discord_width,
  discord_height,
  processing_error
ON studio_assets
FOR EACH ROW
WHEN (NEW.status = 'orphan' AND NEW.orphaned_at IS NULL)
  OR (NEW.status NOT IN ('orphan', 'deleting') AND NEW.orphaned_at IS NOT NULL)
  OR (
    NEW.status = 'ready' AND (
      NEW.public_bytes IS NULL
      OR NEW.public_sha256 IS NULL
      OR NEW.public_width IS NULL
      OR NEW.public_height IS NULL
      OR NEW.discord_bytes IS NULL
      OR NEW.discord_sha256 IS NULL
      OR NEW.discord_width IS NULL
      OR NEW.discord_height IS NULL
      OR NEW.processing_error IS NOT NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'asset_state_invalid');
END;

CREATE TRIGGER trg_studio_post_version_assets_live_insert
BEFORE INSERT ON studio_post_version_assets
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM studio_assets
  WHERE id = NEW.asset_id AND status IN ('orphan', 'deleting')
)
BEGIN
  SELECT RAISE(ABORT, 'asset_not_attachable');
END;

CREATE TRIGGER trg_studio_post_version_assets_live_update
BEFORE UPDATE OF asset_id ON studio_post_version_assets
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM studio_assets
  WHERE id = NEW.asset_id AND status IN ('orphan', 'deleting')
)
BEGIN
  SELECT RAISE(ABORT, 'asset_not_attachable');
END;

-- Approved snapshots stay immutable except while the retention consumer owns
-- an expired superseded version. The processing job is not version-bound, so
-- it survives the cascade and can complete remote cleanup after a retry.
CREATE TRIGGER trg_studio_post_versions_approved_delete
BEFORE DELETE ON studio_post_versions
FOR EACH ROW
WHEN OLD.state IN ('published', 'superseded')
  AND EXISTS (
    SELECT 1 FROM studio_posts
    WHERE id = OLD.post_id AND status NOT IN ('purging', 'purged')
  )
  AND (
    OLD.state != 'superseded' OR NOT EXISTS (
      SELECT 1
      FROM delivery_jobs AS cleanup
      WHERE cleanup.post_id = OLD.post_id
        AND cleanup.target = 'version'
        AND cleanup.action = 'cleanup'
        AND cleanup.status = 'processing'
        AND json_extract(cleanup.payload_json, '$.versionId') = OLD.id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'approved_version_delete_invalid');
END;

DROP TRIGGER trg_studio_post_version_topics_approved_delete;

CREATE TRIGGER trg_studio_post_version_topics_approved_delete
BEFORE DELETE ON studio_post_version_topics
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  JOIN studio_posts AS post ON post.id = version.post_id
  WHERE version.id = OLD.version_id
    AND (
      version.state IN ('published', 'superseded') OR (
        version.state = 'candidate' AND EXISTS (
          SELECT 1 FROM delivery_jobs WHERE version_id = version.id
        )
      )
    )
    AND post.status NOT IN ('purging', 'purged')
    AND NOT (
      version.state = 'superseded' AND EXISTS (
        SELECT 1
        FROM delivery_jobs AS cleanup
        WHERE cleanup.post_id = version.post_id
          AND cleanup.target = 'version'
          AND cleanup.action = 'cleanup'
          AND cleanup.status = 'processing'
          AND json_extract(cleanup.payload_json, '$.versionId') = version.id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'approved_topics_immutable');
END;

DROP TRIGGER trg_studio_post_version_assets_approved_delete;

CREATE TRIGGER trg_studio_post_version_assets_approved_delete
BEFORE DELETE ON studio_post_version_assets
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  JOIN studio_posts AS post ON post.id = version.post_id
  WHERE version.id = OLD.version_id
    AND (
      version.state IN ('published', 'superseded') OR (
        version.state = 'candidate' AND EXISTS (
          SELECT 1 FROM delivery_jobs WHERE version_id = version.id
        )
      )
    )
    AND post.status NOT IN ('purging', 'purged')
    AND NOT (
      version.state = 'superseded' AND EXISTS (
        SELECT 1
        FROM delivery_jobs AS cleanup
        WHERE cleanup.post_id = version.post_id
          AND cleanup.target = 'version'
          AND cleanup.action = 'cleanup'
          AND cleanup.status = 'processing'
          AND json_extract(cleanup.payload_json, '$.versionId') = version.id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'approved_assets_immutable');
END;

DROP TRIGGER trg_studio_assets_candidate_manifest_immutable;

CREATE TRIGGER trg_studio_assets_approved_manifest_immutable
BEFORE UPDATE OF
  status,
  public_bytes,
  public_sha256,
  public_width,
  public_height,
  discord_bytes,
  discord_sha256,
  discord_width,
  discord_height,
  processing_error,
  orphaned_at
ON studio_assets
FOR EACH ROW
WHEN (
  NEW.status IS NOT OLD.status
  OR NEW.public_bytes IS NOT OLD.public_bytes
  OR NEW.public_sha256 IS NOT OLD.public_sha256
  OR NEW.public_width IS NOT OLD.public_width
  OR NEW.public_height IS NOT OLD.public_height
  OR NEW.discord_bytes IS NOT OLD.discord_bytes
  OR NEW.discord_sha256 IS NOT OLD.discord_sha256
  OR NEW.discord_width IS NOT OLD.discord_width
  OR NEW.discord_height IS NOT OLD.discord_height
  OR NEW.processing_error IS NOT OLD.processing_error
  OR NEW.orphaned_at IS NOT OLD.orphaned_at
)
AND EXISTS (
  SELECT 1
  FROM studio_post_version_assets AS selected
  JOIN studio_post_versions AS version ON version.id = selected.version_id
  WHERE selected.asset_id = OLD.id
    AND (
      version.state IN ('published', 'superseded')
      OR (
        version.state = 'candidate'
        AND EXISTS (
          SELECT 1 FROM delivery_jobs WHERE version_id = version.id
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'approved_asset_manifest_immutable');
END;

CREATE TRIGGER trg_studio_posts_current_asset_manifest
BEFORE UPDATE OF current_version_id, status ON studio_posts
FOR EACH ROW
WHEN NEW.status = 'published'
  AND NEW.current_version_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM studio_post_version_assets AS selected
    JOIN studio_assets AS asset ON asset.id = selected.asset_id
    WHERE selected.version_id = NEW.current_version_id
      AND (
        asset.status != 'ready'
        OR asset.public_bytes IS NULL
        OR asset.public_sha256 IS NULL
        OR asset.public_width IS NULL
        OR asset.public_height IS NULL
        OR asset.discord_bytes IS NULL
        OR asset.discord_sha256 IS NULL
        OR asset.discord_width IS NULL
        OR asset.discord_height IS NULL
        OR asset.first_published_at IS NULL
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'current_asset_manifest_invalid');
END;

-- Exercise every new invariant against upgraded rows before the migration is
-- recorded as applied.
UPDATE studio_assets
SET private_source_key = private_source_key,
  status = status,
  first_published_at = first_published_at;

UPDATE studio_posts SET status = status;

PRAGMA optimize;
