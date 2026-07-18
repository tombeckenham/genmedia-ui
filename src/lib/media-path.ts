// Client-safe helpers for turning file paths into /api/media URLs.

export function mediaSrc(path: string): string {
  return `/api/media?path=${encodeURIComponent(path)}`
}

// Session run file paths are absolute; storyboard takes are stored
// project-relative (the /api/media route resolves them against the project
// dir). The client can't know the project dir, so we lean on the genmedia
// layout convention that generated media lives under a `takes/` directory: an
// absolute path containing a `/takes/` segment is stored from `takes/…`.
// Anything else is kept as-is (the media route also serves absolute paths that
// resolve under the project or gallery dir).
export function toStoredTakePath(path: string): string {
  if (!path.startsWith('/')) return path
  const marker = '/takes/'
  const idx = path.indexOf(marker)
  return idx === -1 ? path : path.slice(idx + 1)
}
