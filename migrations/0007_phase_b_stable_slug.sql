-- Phase B stable canonical slug safety. Keep immutable after remote apply.
-- Existing non-draft rows must be explicitly backfilled with the runtime
-- Unicode slug rule before this migration is applied.
PRAGMA foreign_keys = ON;

CREATE TRIGGER trg_phase_b_preflight_stable_slug
BEFORE UPDATE OF slug, status ON studio_posts
FOR EACH ROW
WHEN (NEW.status != 'draft' AND NEW.slug IS NULL)
  OR (
    NEW.slug IS NOT NULL AND (
      length(NEW.slug) <= 10
      OR substr(NEW.slug, -10) != ('--' || lower(substr(NEW.id, 1, 8)))
      OR NEW.slug != lower(NEW.slug)
      OR substr(NEW.slug, 1, 1) = '-'
      OR substr(NEW.slug, length(NEW.slug) - 10, 1) = '-'
      OR instr(substr(NEW.slug, 1, length(NEW.slug) - 10), '--') > 0
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'stable_slug_invalid');
END;

UPDATE studio_posts SET slug = slug, status = status;

DROP TRIGGER trg_phase_b_preflight_stable_slug;

CREATE TRIGGER trg_studio_posts_stable_slug_insert
BEFORE INSERT ON studio_posts
FOR EACH ROW
WHEN (NEW.status != 'draft' AND NEW.slug IS NULL)
  OR (
    NEW.slug IS NOT NULL AND (
      length(NEW.slug) <= 10
      OR substr(NEW.slug, -10) != ('--' || lower(substr(NEW.id, 1, 8)))
      OR NEW.slug != lower(NEW.slug)
      OR substr(NEW.slug, 1, 1) = '-'
      OR substr(NEW.slug, length(NEW.slug) - 10, 1) = '-'
      OR instr(substr(NEW.slug, 1, length(NEW.slug) - 10), '--') > 0
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'stable_slug_invalid');
END;

CREATE TRIGGER trg_studio_posts_stable_slug_update
BEFORE UPDATE OF slug, status ON studio_posts
FOR EACH ROW
WHEN (NEW.status != 'draft' AND NEW.slug IS NULL)
  OR (
    NEW.slug IS NOT NULL AND (
      length(NEW.slug) <= 10
      OR substr(NEW.slug, -10) != ('--' || lower(substr(NEW.id, 1, 8)))
      OR NEW.slug != lower(NEW.slug)
      OR substr(NEW.slug, 1, 1) = '-'
      OR substr(NEW.slug, length(NEW.slug) - 10, 1) = '-'
      OR instr(substr(NEW.slug, 1, length(NEW.slug) - 10), '--') > 0
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'stable_slug_invalid');
END;

CREATE TRIGGER trg_studio_posts_stable_slug_immutable
BEFORE UPDATE OF slug ON studio_posts
FOR EACH ROW
WHEN OLD.slug IS NOT NULL AND NEW.slug IS NOT OLD.slug
BEGIN
  SELECT RAISE(ABORT, 'stable_slug_immutable');
END;

PRAGMA optimize;
