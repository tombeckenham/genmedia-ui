import { watch, type FSWatcher } from 'chokidar'
import { resolve, sep } from 'node:path'
import { galleryDir, lastSessionPath, sessionsDir, storyboardPath } from './paths'
import { currentStoryDbPath } from './story-queries'

// Module-level singleton file watcher. A single chokidar instance bridges
// CLI/agent writes (gallery files, storyboard.json, and the per-project
// story.db SQLite file) to SSE clients. The watcher is created lazily on first
// subscribe and kept alive afterwards (it is cheap and simpler than tearing it
// down and back up).

export type ChangeScope = 'gallery' | 'storyboard' | 'story'
type Listener = (scope: ChangeScope) => void

// WAL writes are chatty (story.db-wal changes on every statement), so the
// story scope debounces a little longer than the JSON-file scopes.
const DEBOUNCE_MS: Record<ChangeScope, number> = { gallery: 120, storyboard: 120, story: 150 }

const listeners = new Set<Listener>()
const debounceTimers = new Map<ChangeScope, ReturnType<typeof setTimeout>>()
let watcher: FSWatcher | undefined

// Pure classification, exported for unit testing. A changed path under the
// gallery dir is a 'gallery' change; the storyboard file itself is a
// 'storyboard' change; the story DB file or one of its SQLite siblings
// (story.db-wal / story.db-shm) is a 'story' change; anything else is ignored.
// The `+ sep` guard keeps a sibling like `/gallery-backup` from matching
// `/gallery`.
export function classifyPath(
  changedPath: string,
  roots: { gallery: string; storyboard: string; storyDb: string },
): ChangeScope | undefined {
  const abs = resolve(changedPath)
  if (abs === roots.storyboard) return 'storyboard'
  if (abs === roots.storyDb || abs.startsWith(roots.storyDb + '-')) return 'story'
  if (abs === roots.gallery || abs.startsWith(roots.gallery + sep)) return 'gallery'
  return undefined
}

function emit(scope: ChangeScope): void {
  const existing = debounceTimers.get(scope)
  if (existing !== undefined) clearTimeout(existing)
  debounceTimers.set(
    scope,
    setTimeout(() => {
      debounceTimers.delete(scope)
      for (const listener of listeners) {
        try {
          listener(scope)
        } catch {
          // A misbehaving listener must not take down the watcher or its peers.
        }
      }
    }, DEBOUNCE_MS[scope]),
  )
}

function ensureWatcher(): void {
  if (watcher !== undefined) return
  // Watched paths may not exist yet on a fresh machine; chokidar tolerates this
  // and will pick them up when they appear (verified for the not-yet-created
  // story.db too). The 'error' handler guarantees a stray fs error never
  // crashes the dev server.
  const storyDb = currentStoryDbPath()
  const instance = watch(
    [sessionsDir(), lastSessionPath(), storyboardPath(), storyDb, `${storyDb}-wal`],
    {
      ignoreInitial: true,
      persistent: true,
      depth: 2, // sessions/<id>/data.json sits two levels under sessionsDir()
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    },
  )
  instance.on('all', (_event, changedPath) => {
    const scope = classifyPath(changedPath, {
      gallery: galleryDir(),
      storyboard: storyboardPath(),
      storyDb,
    })
    if (scope !== undefined) emit(scope)
  })
  instance.on('error', () => {
    // Swallow watcher errors (e.g. transient ENOENT on missing paths).
  })
  watcher = instance
}

// Subscribe to filesystem changes; returns an unsubscribe function. When the
// last subscriber leaves the watcher stays alive but simply has no listeners.
export function subscribe(listener: Listener): () => void {
  ensureWatcher()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
