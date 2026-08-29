-- Phase A draft slice. Keep this migration immutable after remote apply.
PRAGMA foreign_keys = ON;

CREATE TABLE studio_posts (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  slug TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft',
      'publishing',
      'published',
      'withheld',
      'unpublished',
      'archiving',
      'archived',
      'restoring',
      'purging',
      'purged'
    )
  ),
  draft_version_id TEXT UNIQUE REFERENCES studio_post_versions(id) ON DELETE RESTRICT,
  current_version_id TEXT UNIQUE REFERENCES studio_post_versions(id) ON DELETE RESTRICT,
  pinned_at TEXT,
  hero_rank INTEGER CHECK (hero_rank IS NULL OR hero_rank >= 0),
  discord_thread_id TEXT UNIQUE,
  discord_starter_message_id TEXT UNIQUE,
  discord_delivery_state TEXT,
  discord_remote_hash TEXT,
  discord_checked_at TEXT,
  archived_at TEXT,
  purged_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE studio_post_versions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  post_id TEXT NOT NULL REFERENCES studio_posts(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('draft', 'candidate', 'published', 'superseded')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  body_markdown TEXT NOT NULL CHECK (length(body_markdown) BETWEEN 1 AND 2000),
  kind TEXT NOT NULL CHECK (kind IN ('update', 'work')),
  locale TEXT NOT NULL DEFAULT 'ko',
  superseded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1)
);

CREATE TABLE studio_taxonomy (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  dimension TEXT NOT NULL CHECK (dimension IN ('kind', 'topic')),
  stable_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  discord_tag_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (dimension, ordinal)
);

CREATE TABLE studio_post_version_topics (
  version_id TEXT NOT NULL REFERENCES studio_post_versions(id) ON DELETE CASCADE,
  taxonomy_id TEXT NOT NULL REFERENCES studio_taxonomy(id) ON DELETE RESTRICT,
  PRIMARY KEY (version_id, taxonomy_id)
);

CREATE UNIQUE INDEX idx_studio_post_versions_active_draft
ON studio_post_versions (post_id)
WHERE state = 'draft' AND superseded_at IS NULL;

CREATE INDEX idx_studio_posts_status_updated_at
ON studio_posts (status, updated_at DESC);

CREATE INDEX idx_studio_taxonomy_dimension_status_ordinal
ON studio_taxonomy (dimension, status, ordinal);

INSERT INTO studio_taxonomy (
  id, dimension, stable_key, label, status, ordinal, created_at, updated_at
) VALUES
  ('e7cc01af-0403-4cbe-8e24-a33236121a2f', 'kind', 'update', '업데이트', 'active', 0, datetime('now'), datetime('now')),
  ('d29a3b5c-2548-49c0-8d61-fdfb98a85f9b', 'kind', 'work', '작업', 'active', 1, datetime('now'), datetime('now')),
  ('4b01a85d-bfdc-44ac-9e1a-cbf2755e5e45', 'topic', 'character', '캐릭터', 'active', 0, datetime('now'), datetime('now')),
  ('5eda310a-7ed6-4fcc-a714-4779f8dcc898', 'topic', 'world', '세계관', 'active', 1, datetime('now'), datetime('now')),
  ('43ca7d47-bdbd-4b01-a44e-d94e4598787d', 'topic', 'illustration', '일러스트', 'active', 2, datetime('now'), datetime('now')),
  ('10efe52e-2137-438a-bcf7-d758a2f110ca', 'topic', 'development', '개발', 'active', 3, datetime('now'), datetime('now'));

PRAGMA optimize;
