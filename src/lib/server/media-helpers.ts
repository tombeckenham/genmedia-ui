// Pure, HTTP-free helpers for the /api/media route so range parsing and
// content-type resolution can be unit tested without spinning up a server.

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
}

export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  const ext = dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

// Result of parsing a single-range `Range` header against a known file size.
// `ok` carries an inclusive byte range; `unsatisfiable` maps to a 416 response;
// `ignore` means the header was malformed or unsupported and the caller should
// serve the full body with a 200.
export type RangeResult =
  | { type: 'ok'; start: number; end: number }
  | { type: 'unsatisfiable' }
  | { type: 'ignore' }

// Supports the single-range forms `bytes=start-end`, `bytes=start-`, and
// `bytes=-suffix`. Multi-range requests and non-byte units are ignored.
export function parseRange(header: string, size: number): RangeResult {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return { type: 'ignore' }

  const [, startStr, endStr] = match
  if (startStr === undefined || endStr === undefined) return { type: 'ignore' }
  if (startStr === '' && endStr === '') return { type: 'ignore' }

  // Suffix range: the last N bytes of the file.
  if (startStr === '') {
    const suffix = Number(endStr)
    if (suffix === 0 || size === 0) return { type: 'unsatisfiable' }
    const start = size > suffix ? size - suffix : 0
    return { type: 'ok', start, end: size - 1 }
  }

  const start = Number(startStr)
  if (start >= size) return { type: 'unsatisfiable' }
  const end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1)
  if (end < start) return { type: 'unsatisfiable' }
  return { type: 'ok', start, end }
}
