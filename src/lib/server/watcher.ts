import { watch, type FSWatcher } from 'chokidar'
import { resolve, sep } from 'node:path'
import { galleryDir, lastSessionPath, sessionsDir, storyboardPath } from './paths'

// Module-level singleton file watcher. There is no database — the filesystem is
// the state layer — so a single chokidar instance bridges CLI/agent writes to
// SSE clients. The watcher is created lazily on first subscribe and kept alive
// afterwards (it is cheap and simpler than tearing it down and back up).

export type ChangeScope = 'gallery' | 'storyboard'
type Listener = (scope: ChangeScope) => void

const DEBOUNCE_MS = 120

const listeners = new Set<Listener>()
const debounceTimers = new Map<ChangeScope, ReturnType<typeof setTimeout>>()
let watcher: FSWatcher | undefined

// Pure classification, exported for unit testing. A changed path under the
// gallery dir is a 'gallery' change; the storyboard file itself is a
// 'storyboard' change; anything else is ignored. The `+ sep` guard keeps a
// sibling like `/gallery-backup` from matching `/gallery`.
export function classifyPath(
  changedPath: string,
  roots: { gallery: string; storyboard: string },
): ChangeScope | undefined {
  const abs = resolve(changedPath)
  if (abs === roots.storyboard) return 'storyboard'
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
    }, DEBOUNCE_MS),
  )
}

function ensureWatcher(): void {
  if (watcher !== undefined) return
  // Watched paths may not exist yet on a fresh machine; chokidar tolerates this
  // and will pick them up when they appear. The 'error' handler guarantees a
  // stray fs error never crashes the dev server.
  const instance = watch([sessionsDir(), lastSessionPath(), storyboardPath()], {
    ignoreInitial: true,
    persistent: true,
    depth: 2, // sessions/<id>/data.json sits two levels under sessionsDir()
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  })
  instance.on('all', (_event, changedPath) => {
    const scope = classifyPath(changedPath, { gallery: galleryDir(), storyboard: storyboardPath() })
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
