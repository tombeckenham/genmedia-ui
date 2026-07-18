import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { allowedRealMediaRoots, isAllowedMediaPath, isUnderRoot, projectDir } from './paths'
import { contentTypeFor, parseRange } from './media-helpers'

// Serves media files (video/image/audio) from the gallery or project dir with
// HTTP range support so the browser can seek within videos. Files get rewritten
// by the CLI, so responses are never cached.
//
// Exposed as a plain (Request) => Response web handler because it's mounted
// twice: as a TanStack Start server route AND as a specific nitro route in
// server/routes/. The nitro registration matters: nitro's dev middleware
// classifies requests with Sec-Fetch-Dest: image/video as static assets and
// bypasses the TanStack catch-all entirely unless a specific nitro route
// matches — without it, <img>/<video> elements 404 while fetch() works.

function fileBody(path: string, range?: { start: number; end: number }): ReadableStream {
  const nodeStream = range === undefined ? createReadStream(path) : createReadStream(path, range)
  // Node's Readable.toWeb returns a node:stream/web ReadableStream that is a
  // valid Response body at runtime but is nominally incompatible with the DOM
  // ReadableStream the types expect (SharedArrayBuffer variance). This is the
  // one deliberate cast where we know more than the compiler.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Readable.toWeb(nodeStream) as unknown as ReadableStream
}

export async function handleMediaRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rawPath = url.searchParams.get('path')
  if (rawPath === null || rawPath === '') {
    return new Response('Missing path parameter', { status: 400 })
  }

  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(projectDir(), rawPath)
  // Cheap lexical pre-check; the authoritative check below runs on realpaths.
  if (!isAllowedMediaPath(resolved)) {
    return new Response('Forbidden', { status: 403 })
  }

  // Resolve symlinks BEFORE the allowlist decision and serve the realpath, so
  // a link inside an allowed root can't smuggle a target outside it.
  let real: string
  try {
    real = await realpath(resolved)
  } catch {
    return new Response('Not found', { status: 404 })
  }
  if (!isUnderRoot(real, await allowedRealMediaRoots())) {
    return new Response('Forbidden', { status: 403 })
  }

  let stats
  try {
    stats = await stat(real)
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return new Response('Not found', { status: 404 })
    }
    throw err
  }
  if (!stats.isFile()) {
    return new Response('Not found', { status: 404 })
  }

  const size = stats.size
  const baseHeaders: Record<string, string> = {
    'Content-Type': contentTypeFor(resolved),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  }

  const rangeHeader = request.headers.get('range')
  if (rangeHeader !== null) {
    const range = parseRange(rangeHeader, size)
    if (range.type === 'unsatisfiable') {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` },
      })
    }
    if (range.type === 'ok') {
      const { start, end } = range
      return new Response(fileBody(real, { start, end }), {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
        },
      })
    }
    // range.type === 'ignore': malformed header, fall through to full body.
  }

  return new Response(fileBody(real), {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(size) },
  })
}
