-- Phase B canonical schema invariants. Keep immutable after remote apply.
-- Roll back only with a new forward migration that drops the affected object.
PRAGMA foreign_keys = ON;

-- Validate every legacy Phase A row before rebuilding any table. These
-- no-op updates make the temporary guards inspect existing rows, not only
-- writes that happen after this migration.
CREATE TRIGGER trg_phase_b_preflight_source_hash
BEFORE UPDATE OF source_hash ON studio_post_versions
FOR EACH ROW
WHEN length(NEW.source_hash) != 64
  OR NEW.source_hash GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'source_hash_invalid');
END;

CREATE TRIGGER trg_phase_b_preflight_topics
BEFORE UPDATE OF version_id, taxonomy_id ON studio_post_version_topics
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM studio_taxonomy AS taxonomy
  WHERE taxonomy.id = NEW.taxonomy_id AND taxonomy.dimension = 'topic'
) OR (
  SELECT count(*)
  FROM studio_post_version_topics
  WHERE version_id = NEW.version_id
) > 4
BEGIN
  SELECT RAISE(ABORT, 'legacy_topic_invariant_invalid');
END;

CREATE TRIGGER trg_phase_b_preflight_assets
BEFORE UPDATE OF version_id, asset_id ON studio_post_version_assets
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  JOIN studio_assets AS asset ON asset.id = NEW.asset_id
  WHERE version.id = NEW.version_id AND version.post_id = asset.post_id
) OR (
  SELECT count(*)
  FROM studio_post_version_assets
  WHERE version_id = NEW.version_id
) > 10
BEGIN
  SELECT RAISE(ABORT, 'legacy_asset_invariant_invalid');
END;

CREATE TRIGGER trg_phase_b_preflight_delivery
BEFORE UPDATE OF
  post_id,
  version_id,
  asset_id,
  expected_hash,
  delivered_hash
ON delivery_jobs
FOR EACH ROW
WHEN (NEW.version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  WHERE version.id = NEW.version_id AND version.post_id = NEW.post_id
)) OR (NEW.asset_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM studio_assets AS asset
  WHERE asset.id = NEW.asset_id AND asset.post_id = NEW.post_id
)) OR (NEW.expected_hash IS NOT NULL AND (
  length(NEW.expected_hash) != 64
  OR NEW.expected_hash GLOB '*[^0-9a-f]*'
)) OR (NEW.delivered_hash IS NOT NULL AND (
  length(NEW.delivered_hash) != 64
  OR NEW.delivered_hash GLOB '*[^0-9a-f]*'
)) OR (
  NEW.target = 'discord'
  AND NEW.action IN ('create', 'update')
  AND NEW.status NOT IN ('succeeded', 'failed', 'outcome_unknown')
)
BEGIN
  SELECT RAISE(ABORT, 'legacy_delivery_invariant_invalid');
END;

UPDATE studio_post_versions
SET source_hash = source_hash;

UPDATE studio_post_version_topics
SET version_id = version_id, taxonomy_id = taxonomy_id;

UPDATE studio_post_version_assets
SET version_id = version_id, asset_id = asset_id;

UPDATE delivery_jobs
SET post_id = post_id,
  version_id = version_id,
  asset_id = asset_id,
  expected_hash = expected_hash,
  delivered_hash = delivered_hash;

DROP TRIGGER trg_phase_b_preflight_source_hash;
DROP TRIGGER trg_phase_b_preflight_topics;
DROP TRIGGER trg_phase_b_preflight_assets;
DROP TRIGGER trg_phase_b_preflight_delivery;

CREATE INDEX idx_studio_post_versions_post_state_updated_at
ON studio_post_versions (post_id, state, updated_at DESC, id);

CREATE INDEX idx_studio_assets_status_orphaned_at
ON studio_assets (status, orphaned_at, id)
WHERE orphaned_at IS NOT NULL;

CREATE INDEX idx_studio_post_version_assets_asset_version
ON studio_post_version_assets (asset_id, version_id);

-- SQLite cannot widen a table CHECK in place. Rebuild the outbox without
-- changing existing columns or rows, then add the Phase B external effects.
CREATE TABLE delivery_jobs_phase_b (
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
    (target = 'asset' AND asset_id IS NOT NULL AND action IN ('process', 'delete')) OR
    (target = 'discord' AND asset_id IS NULL AND action IN ('create', 'update', 'delete')) OR
    (target = 'notification' AND version_id IS NOT NULL AND asset_id IS NULL AND action = 'send') OR
    (target = 'cache' AND asset_id IS NOT NULL AND action = 'purge')
  )
);

INSERT INTO delivery_jobs_phase_b (
  id,
  dedupe_key,
  post_id,
  version_id,
  asset_id,
  target,
  action,
  payload_json,
  remote_id,
  remote_aux_id,
  remote_attachment_ids,
  status,
  attempts,
  expected_hash,
  delivered_hash,
  error_code,
  last_error,
  created_at,
  updated_at,
  completed_at
)
SELECT
  id,
  dedupe_key,
  post_id,
  version_id,
  asset_id,
  target,
  action,
  payload_json,
  remote_id,
  remote_aux_id,
  remote_attachment_ids,
  status,
  attempts,
  expected_hash,
  delivered_hash,
  error_code,
  last_error,
  created_at,
  updated_at,
  completed_at
FROM delivery_jobs;

DROP TABLE delivery_jobs;
ALTER TABLE delivery_jobs_phase_b RENAME TO delivery_jobs;

CREATE INDEX idx_delivery_jobs_post_created_at
ON delivery_jobs (post_id, created_at DESC, id);

CREATE INDEX idx_delivery_jobs_status_updated_at
ON delivery_jobs (status, updated_at, id);

CREATE INDEX idx_delivery_jobs_asset_created_at
ON delivery_jobs (asset_id, created_at DESC, id)
WHERE asset_id IS NOT NULL;

CREATE INDEX idx_delivery_jobs_post_target_created_at
ON delivery_jobs (post_id, target, created_at DESC, id);

CREATE UNIQUE INDEX idx_studio_posts_single_pin
ON studio_posts ((1))
WHERE pinned_at IS NOT NULL AND status != 'purged';

CREATE UNIQUE INDEX idx_studio_posts_hero_rank
ON studio_posts (hero_rank)
WHERE hero_rank IS NOT NULL AND status != 'purged';

CREATE TRIGGER trg_studio_posts_draft_pointer
BEFORE UPDATE OF draft_version_id ON studio_posts
FOR EACH ROW
WHEN NEW.draft_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  WHERE version.id = NEW.draft_version_id
    AND version.post_id = NEW.id
    AND version.state = 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'draft_pointer_invalid');
END;

CREATE TRIGGER trg_studio_posts_current_pointer
BEFORE UPDATE OF current_version_id ON studio_posts
FOR EACH ROW
WHEN NEW.current_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  WHERE version.id = NEW.current_version_id
    AND version.post_id = NEW.id
    AND version.state = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'current_pointer_invalid');
END;

CREATE TRIGGER trg_studio_posts_current_delivery
BEFORE UPDATE OF current_version_id ON studio_posts
FOR EACH ROW
WHEN NEW.current_version_id IS NOT OLD.current_version_id
  AND EXISTS (
    SELECT 1
    FROM delivery_jobs AS active_job
    WHERE active_job.post_id = NEW.id
      AND active_job.target = 'discord'
      AND active_job.action IN ('create', 'update')
      AND active_job.status NOT IN ('succeeded', 'failed', 'outcome_unknown')
  )
  AND (
    NOT EXISTS (
      SELECT 1
      FROM delivery_jobs AS verified_job
      WHERE verified_job.post_id = NEW.id
        AND verified_job.version_id IS NEW.current_version_id
        AND verified_job.target = 'discord'
        AND verified_job.action IN ('create', 'update')
        AND verified_job.status = 'finalizing'
        AND verified_job.expected_hash IS NOT NULL
        AND verified_job.delivered_hash = verified_job.expected_hash
    )
    OR EXISTS (
      SELECT 1
      FROM delivery_jobs AS conflicting_job
      WHERE conflicting_job.post_id = NEW.id
        AND conflicting_job.target = 'discord'
        AND conflicting_job.action IN ('create', 'update')
        AND conflicting_job.status NOT IN ('succeeded', 'failed', 'outcome_unknown')
        AND conflicting_job.version_id IS NOT NEW.current_version_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'current_delivery_conflict');
END;

CREATE TRIGGER trg_studio_posts_discord_mapping_delivery
BEFORE UPDATE OF discord_thread_id, discord_starter_message_id ON studio_posts
FOR EACH ROW
WHEN (
    NEW.discord_thread_id IS NOT OLD.discord_thread_id
    OR NEW.discord_starter_message_id IS NOT OLD.discord_starter_message_id
  )
  AND EXISTS (
    SELECT 1
    FROM delivery_jobs AS active_job
    WHERE active_job.post_id = NEW.id
      AND active_job.target = 'discord'
      AND active_job.action IN ('create', 'update')
      AND active_job.status NOT IN ('succeeded', 'failed', 'outcome_unknown')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM delivery_jobs AS verified_job
    WHERE verified_job.post_id = NEW.id
      AND verified_job.target = 'discord'
      AND verified_job.action IN ('create', 'update')
      AND verified_job.status = 'finalizing'
      AND verified_job.expected_hash IS NOT NULL
      AND verified_job.delivered_hash = verified_job.expected_hash
      AND verified_job.remote_id IS NEW.discord_thread_id
      AND verified_job.remote_aux_id IS NEW.discord_starter_message_id
  )
BEGIN
  SELECT RAISE(ABORT, 'discord_mapping_delivery_conflict');
END;

CREATE TRIGGER trg_studio_posts_active_candidate_delete
BEFORE DELETE ON studio_posts
FOR EACH ROW
WHEN OLD.status NOT IN ('purging', 'purged')
  AND EXISTS (
    SELECT 1
    FROM studio_post_versions AS version
    JOIN delivery_jobs AS job ON job.version_id = version.id
    WHERE version.post_id = OLD.id
      AND version.state = 'candidate'
      AND job.target = 'discord'
      AND job.action IN ('create', 'update')
  )
BEGIN
  SELECT RAISE(ABORT, 'active_post_delete_invalid');
END;

CREATE TRIGGER trg_studio_post_versions_pointer_ownership
BEFORE UPDATE OF post_id, state ON studio_post_versions
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM studio_posts AS post
  WHERE (
    post.draft_version_id = OLD.id AND (
      NEW.post_id != post.id OR NEW.state != 'draft'
    )
  ) OR (
    post.current_version_id = OLD.id AND (
      NEW.post_id != post.id OR NEW.state NOT IN ('published', 'superseded')
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'version_pointer_invalid');
END;

CREATE TRIGGER trg_studio_post_versions_post_immutable
BEFORE UPDATE OF post_id ON studio_post_versions
FOR EACH ROW
WHEN NEW.post_id != OLD.post_id
BEGIN
  SELECT RAISE(ABORT, 'version_post_immutable');
END;

CREATE TRIGGER trg_studio_post_versions_approved_state
BEFORE UPDATE OF state ON studio_post_versions
FOR EACH ROW
WHEN OLD.state IN ('published', 'superseded')
  AND NEW.state NOT IN ('published', 'superseded')
BEGIN
  SELECT RAISE(ABORT, 'approved_state_invalid');
END;

CREATE TRIGGER trg_studio_post_versions_candidate_state
BEFORE UPDATE OF state ON studio_post_versions
FOR EACH ROW
WHEN OLD.state = 'candidate'
  AND EXISTS (
    SELECT 1 FROM delivery_jobs WHERE version_id = OLD.id
  )
  AND (
    NEW.state NOT IN ('candidate', 'published') OR (
      NEW.state = 'published' AND NOT EXISTS (
        SELECT 1
        FROM delivery_jobs AS verified_job
        WHERE verified_job.version_id = OLD.id
          AND verified_job.target = 'discord'
          AND verified_job.action IN ('create', 'update')
          AND verified_job.status = 'finalizing'
          AND verified_job.expected_hash IS NOT NULL
          AND verified_job.delivered_hash = verified_job.expected_hash
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'candidate_state_invalid');
END;

CREATE TRIGGER trg_studio_post_versions_candidate_delete
BEFORE DELETE ON studio_post_versions
FOR EACH ROW
WHEN OLD.state = 'candidate'
  AND EXISTS (
    SELECT 1 FROM delivery_jobs WHERE version_id = OLD.id
  )
  AND EXISTS (
    SELECT 1
    FROM studio_posts
    WHERE id = OLD.post_id AND status NOT IN ('purging', 'purged')
  )
BEGIN
  SELECT RAISE(ABORT, 'candidate_version_delete_invalid');
END;

CREATE TRIGGER trg_studio_post_versions_approved_immutable
BEFORE UPDATE OF
  post_id,
  revision,
  source_hash,
  title,
  body_markdown,
  kind,
  locale,
  created_at,
  schema_version
ON studio_post_versions
FOR EACH ROW
WHEN OLD.state IN ('published', 'superseded') OR (
  OLD.state = 'candidate' AND EXISTS (
    SELECT 1 FROM delivery_jobs WHERE version_id = OLD.id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'approved_version_immutable');
END;

CREATE TRIGGER trg_studio_post_versions_source_hash_insert
BEFORE INSERT ON studio_post_versions
FOR EACH ROW
WHEN length(NEW.source_hash) != 64
  OR NEW.source_hash GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'source_hash_invalid');
END;

CREATE TRIGGER trg_studio_post_versions_source_hash_update
BEFORE UPDATE OF source_hash ON studio_post_versions
FOR EACH ROW
WHEN length(NEW.source_hash) != 64
  OR NEW.source_hash GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'source_hash_invalid');
END;

CREATE TRIGGER trg_studio_post_version_topics_topic_insert
BEFORE INSERT ON studio_post_version_topics
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM studio_taxonomy AS taxonomy
  WHERE taxonomy.id = NEW.taxonomy_id AND taxonomy.dimension = 'topic'
)
BEGIN
  SELECT RAISE(ABORT, 'topic_taxonomy_required');
END;

CREATE TRIGGER trg_studio_post_version_topics_topic_update
BEFORE UPDATE OF taxonomy_id ON studio_post_version_topics
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM studio_taxonomy AS taxonomy
  WHERE taxonomy.id = NEW.taxonomy_id AND taxonomy.dimension = 'topic'
)
BEGIN
  SELECT RAISE(ABORT, 'topic_taxonomy_required');
END;

CREATE TRIGGER trg_studio_post_version_topics_limit_insert
BEFORE INSERT ON studio_post_version_topics
FOR EACH ROW
WHEN (
  SELECT count(*)
  FROM studio_post_version_topics
  WHERE version_id = NEW.version_id
) >= 4
BEGIN
  SELECT RAISE(ABORT, 'topic_limit_exceeded');
END;

CREATE TRIGGER trg_studio_post_version_topics_limit_update
BEFORE UPDATE OF version_id ON studio_post_version_topics
FOR EACH ROW
WHEN NEW.version_id != OLD.version_id AND (
  SELECT count(*)
  FROM studio_post_version_topics
  WHERE version_id = NEW.version_id
) >= 4
BEGIN
  SELECT RAISE(ABORT, 'topic_limit_exceeded');
END;

CREATE TRIGGER trg_studio_post_version_topics_approved_insert
BEFORE INSERT ON studio_post_version_topics
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  WHERE version.id = NEW.version_id
    AND (
      version.state IN ('published', 'superseded') OR (
        version.state = 'candidate' AND EXISTS (
          SELECT 1 FROM delivery_jobs WHERE version_id = version.id
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'approved_topics_immutable');
END;

CREATE TRIGGER trg_studio_post_version_topics_approved_update
BEFORE UPDATE ON studio_post_version_topics
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  WHERE version.id IN (OLD.version_id, NEW.version_id)
    AND (
      version.state IN ('published', 'superseded') OR (
        version.state = 'candidate' AND EXISTS (
          SELECT 1 FROM delivery_jobs WHERE version_id = version.id
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'approved_topics_immutable');
END;

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
)
BEGIN
  SELECT RAISE(ABORT, 'approved_topics_immutable');
END;

CREATE TRIGGER trg_studio_post_version_assets_approved_insert
BEFORE INSERT ON studio_post_version_assets
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  WHERE version.id = NEW.version_id
    AND (
      version.state IN ('published', 'superseded') OR (
        version.state = 'candidate' AND EXISTS (
          SELECT 1 FROM delivery_jobs WHERE version_id = version.id
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'approved_assets_immutable');
END;

CREATE TRIGGER trg_studio_post_version_assets_post_insert
BEFORE INSERT ON studio_post_version_assets
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  JOIN studio_assets AS asset ON asset.id = NEW.asset_id
  WHERE version.id = NEW.version_id AND version.post_id = asset.post_id
)
BEGIN
  SELECT RAISE(ABORT, 'asset_post_mismatch');
END;

CREATE TRIGGER trg_studio_post_version_assets_post_update
BEFORE UPDATE OF version_id, asset_id ON studio_post_version_assets
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  JOIN studio_assets AS asset ON asset.id = NEW.asset_id
  WHERE version.id = NEW.version_id AND version.post_id = asset.post_id
)
BEGIN
  SELECT RAISE(ABORT, 'asset_post_mismatch');
END;

CREATE TRIGGER trg_studio_post_version_assets_limit_insert
BEFORE INSERT ON studio_post_version_assets
FOR EACH ROW
WHEN (
  SELECT count(*)
  FROM studio_post_version_assets
  WHERE version_id = NEW.version_id
) >= 10
BEGIN
  SELECT RAISE(ABORT, 'asset_limit_exceeded');
END;

CREATE TRIGGER trg_studio_post_version_assets_limit_update
BEFORE UPDATE OF version_id ON studio_post_version_assets
FOR EACH ROW
WHEN NEW.version_id != OLD.version_id AND (
  SELECT count(*)
  FROM studio_post_version_assets
  WHERE version_id = NEW.version_id
) >= 10
BEGIN
  SELECT RAISE(ABORT, 'asset_limit_exceeded');
END;

CREATE TRIGGER trg_studio_post_version_assets_approved_update
BEFORE UPDATE ON studio_post_version_assets
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM studio_post_versions AS version
  WHERE version.id IN (OLD.version_id, NEW.version_id)
    AND (
      version.state IN ('published', 'superseded') OR (
        version.state = 'candidate' AND EXISTS (
          SELECT 1 FROM delivery_jobs WHERE version_id = version.id
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'approved_assets_immutable');
END;

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
)
BEGIN
  SELECT RAISE(ABORT, 'approved_assets_immutable');
END;

CREATE TRIGGER trg_studio_assets_post_immutable
BEFORE UPDATE OF post_id ON studio_assets
FOR EACH ROW
WHEN NEW.post_id != OLD.post_id
BEGIN
  SELECT RAISE(ABORT, 'asset_post_immutable');
END;

CREATE TRIGGER trg_studio_assets_candidate_manifest_immutable
BEFORE UPDATE OF
  status,
  discord_r2_key,
  discord_bytes,
  discord_sha256,
  discord_width,
  discord_height
ON studio_assets
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM studio_post_version_assets AS selected
  JOIN studio_post_versions AS version ON version.id = selected.version_id
  JOIN delivery_jobs AS job ON job.version_id = version.id
  WHERE selected.asset_id = OLD.id
    AND version.state = 'candidate'
    AND job.target = 'discord'
    AND job.action IN ('create', 'update')
)
BEGIN
  SELECT RAISE(ABORT, 'candidate_asset_manifest_immutable');
END;

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

PRAGMA optimize;
