// Client-safe helpers for turning file paths into /api/media URLs.

export function mediaSrc(path: string): string {
  return `/api/media?path=${encodeURIComponent(path)}`
}

// Session run file paths are absolute; storyboard takes are stored
// project-relative (the /api/media route resolves them against the project
// dir). Relativize only when the path truly lives under the CURRENT project
// dir (supplied by the getProjectInfo server fn) — a path from some other
// project stays absolute rather than being mis-attributed via
// pattern-matching. Absolute paths under the gallery (where session run files
// live) remain servable; anything outside the gallery/current-project roots
// is rejected by /api/media.
export function toStoredTakePath(path: string, projectRoot: string | null): string {
  if (!path.startsWith('/')) return path
  if (typeof projectRoot === 'string' && projectRoot !== '') {
    const root = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`
    if (path.startsWith(root)) return path.slice(root.length)
  }
  return path
}
