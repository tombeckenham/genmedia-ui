/**
 * Canonical DDL for the story database, applied idempotently on open.
 *
 * This string MUST stay byte-identical to `src/db/schema.sql` (enforced by
 * `src/db/db.test.ts`) and structurally in sync with the drizzle table
 * definitions in `src/db/schema.ts`.
 */
export const SCHEMA_SQL = `-- Story database schema (schema_version 1).
-- Canonical DDL: keep byte-identical to the SCHEMA_SQL constant in src/db/ddl.ts
-- and structurally in sync with the drizzle definitions in src/db/schema.ts.

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sequences (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  logline TEXT NOT NULL DEFAULT '',
  script TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('frame', 'shot', 'character', 'location', 'element')),
  target_id TEXT NOT NULL,
  request_id TEXT NOT NULL DEFAULT '',
  endpoint_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
  path TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS generations_target_idx ON generations (target_type, target_id);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES sequences (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  selected_generation_id TEXT REFERENCES generations (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES sequences (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  selected_generation_id TEXT REFERENCES generations (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS elements (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES sequences (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'prop',
  selected_generation_id TEXT REFERENCES generations (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES sequences (id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  script_excerpt TEXT NOT NULL DEFAULT '',
  synopsis TEXT NOT NULL DEFAULT '',
  location_id TEXT REFERENCES locations (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  camera TEXT NOT NULL DEFAULT '',
  duration_seconds REAL,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  selected_generation_id TEXT REFERENCES generations (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS frames (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shots (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('start', 'end')),
  prompt TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  selected_generation_id TEXT REFERENCES generations (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (shot_id, role)
);

CREATE TABLE IF NOT EXISTS scene_characters (
  scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  PRIMARY KEY (scene_id, character_id)
);

CREATE TABLE IF NOT EXISTS scene_elements (
  scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
  element_id TEXT NOT NULL REFERENCES elements (id) ON DELETE CASCADE,
  PRIMARY KEY (scene_id, element_id)
);
`
