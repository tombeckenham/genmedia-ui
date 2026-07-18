/**
 * Story database access. Server-only: import from server functions, server
 * routes, or CLI scripts — never from client components.
 *
 * One database per project folder (`<projectDir>/story.db` — see
 * `src/db/db-path.ts`); open handles are cached per resolved path so multiple
 * project DBs can be open at once. The idempotent migration in
 * `src/db/ddl.ts` is applied on open. Lazy only — no top-level side effects.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite'
import { storyDbPath } from './db-path.ts'
import { SCHEMA_SQL } from './ddl.ts'

export * from './db-path.ts'
export * from './schema.ts'

export type StoryDb = NodeSQLiteDatabase & { $client: DatabaseSync }

/** Open (and migrate) a story database at an explicit path. Prefer `getDb()`. */
export function createDb(dbPath: string): StoryDb {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const client = new DatabaseSync(dbPath)
  client.exec('PRAGMA journal_mode = WAL;')
  client.exec('PRAGMA foreign_keys = ON;')
  // Two writers share this DB (the dev server's cached connection and the
  // story CLI run by the agent). Without a busy timeout a write that collides
  // with the other connection's write transaction fails instantly with
  // "database is locked" instead of waiting.
  client.exec('PRAGMA busy_timeout = 5000;')
  client.exec(SCHEMA_SQL)
  client.exec(
    "INSERT INTO meta (key, value) VALUES ('schema_version', '1') ON CONFLICT (key) DO NOTHING;",
  )
  return drizzle({ client })
}

const cache = new Map<string, StoryDb>()

/**
 * Lazily open the story database for `dbPath` (default: `storyDbPath()`
 * resolution). WAL, foreign keys ON, migrated. Handles are cached per
 * resolved path — multiple project DBs can be open at once.
 */
export function getDb(dbPath?: string): StoryDb {
  const resolved = path.resolve(dbPath ?? storyDbPath())
  let db = cache.get(resolved)
  if (db === undefined) {
    db = createDb(resolved)
    cache.set(resolved, db)
  }
  return db
}

/** Close (and evict) the cached connection for a path (default resolution). */
export function closeDb(dbPath?: string): void {
  const resolved = path.resolve(dbPath ?? storyDbPath())
  const db = cache.get(resolved)
  if (db !== undefined) {
    db.$client.close()
    cache.delete(resolved)
  }
}

/** Close every cached connection (tests / graceful shutdown). */
export function closeAllDbs(): void {
  for (const db of cache.values()) db.$client.close()
  cache.clear()
}
