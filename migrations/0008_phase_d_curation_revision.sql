-- Phase D curation CAS. Keep immutable after remote apply.
-- Roll back only with a new forward migration.
PRAGMA foreign_keys = ON;

ALTER TABLE studio_posts
ADD COLUMN curation_revision INTEGER NOT NULL DEFAULT 0
CHECK (curation_revision >= 0);

-- Lifecycle writes are spread across publish, archive, restore and purge paths.
-- Advance the shared curation token whenever any curation-relevant state moves,
-- unless the caller already advanced it atomically in the same statement.
CREATE TRIGGER trg_studio_posts_curation_revision
AFTER UPDATE OF status, current_version_id, pinned_at, hero_rank ON studio_posts
FOR EACH ROW
WHEN NEW.curation_revision = OLD.curation_revision
  AND (
    NEW.status IS NOT OLD.status
    OR NEW.current_version_id IS NOT OLD.current_version_id
    OR NEW.pinned_at IS NOT OLD.pinned_at
    OR NEW.hero_rank IS NOT OLD.hero_rank
  )
BEGIN
  UPDATE studio_posts
  SET curation_revision = curation_revision + 1
  WHERE id = NEW.id;
END;

PRAGMA optimize;
