import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

// Server-only path resolution. The gallery is owned by genmedia-cli
// (~/.genmedia/gallery); the project dir holds storyboard.json + downloaded
// takes. Both are overridable for tests.

export function galleryDir(): string {
  const override = process.env.GENMEDIA_UI_GALLERY
  return override !== undefined && override !== ''
    ? resolve(override)
    : join(homedir(), '.genmedia', 'gallery')
}

export function sessionsDir(): string {
  return join(galleryDir(), 'sessions')
}

export function sessionDataPath(sessionId: string): string {
  return join(sessionsDir(), sessionId, 'data.json')
}

export function lastSessionPath(): string {
  return join(galleryDir(), 'last-session.json')
}

export function projectDir(): string {
  const override = process.env.GENMEDIA_UI_PROJECT
  return override !== undefined && override !== '' ? resolve(override) : process.cwd()
}

export function storyboardPath(): string {
  return join(projectDir(), 'storyboard.json')
}

// Session ids are opaque CLI-generated slugs; reject anything that could
// traverse out of the sessions dir.
export function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && !id.startsWith('.')
}

// /api/media may only serve files under the gallery or the project dir.
export function isAllowedMediaPath(candidate: string): boolean {
  const abs = resolve(candidate)
  return [galleryDir(), projectDir()].some((root) => abs === root || abs.startsWith(root + sep))
}
