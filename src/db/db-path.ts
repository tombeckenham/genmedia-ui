/**
 * Story database path resolution. The DB is per project folder:
 * `<projectDir>/story.db`, next to that project's `storyboard.json`.
 *
 * Deliberately free of imports from `src/lib/server/` — the story CLI imports
 * this module too. The project-dir resolution mirrors `projectDir()` in
 * `src/lib/server/paths.ts` (`GENMEDIA_UI_PROJECT` env or cwd).
 */
import path from 'node:path'
import process from 'node:process'

export const STORY_DB_FILENAME = 'story.db'

/** Project folder the story DB lives in: `GENMEDIA_UI_PROJECT` env or cwd. */
export function storyProjectDir(): string {
  const override = process.env.GENMEDIA_UI_PROJECT
  return override !== undefined && override !== '' ? path.resolve(override) : process.cwd()
}

/**
 * Default story DB path: `STORY_DB_PATH` env (full-path override, used by
 * tests), else `<storyProjectDir()>/story.db`. Always absolute.
 */
export function storyDbPath(): string {
  const override = process.env.STORY_DB_PATH
  if (override !== undefined && override !== '') return path.resolve(override)
  return path.join(storyProjectDir(), STORY_DB_FILENAME)
}
