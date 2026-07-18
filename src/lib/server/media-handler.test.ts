import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleMediaRequest } from './media-handler'

// End-to-end composition tests for the /api/media web handler: path
// resolution + allowlisting + range handling over a real temp filesystem.

let projectDir: string

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'media-proj-'))
  vi.stubEnv('GENMEDIA_UI_PROJECT', projectDir)
  vi.stubEnv('GENMEDIA_UI_GALLERY', join(projectDir, 'no-gallery-here'))
  await writeFile(join(projectDir, 'clip.mp4'), '0123456789', 'utf-8')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function req(path: string, headers?: Record<string, string>): Request {
  return new Request(`http://x/api/media?path=${encodeURIComponent(path)}`, { headers })
}

describe('handleMediaRequest', () => {
  it('400s without a path', async () => {
    const res = await handleMediaRequest(new Request('http://x/api/media'))
    expect(res.status).toBe(400)
  })

  it('serves a project-relative path with full body', async () => {
    const res = await handleMediaRequest(req('clip.mp4'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('content-length')).toBe('10')
    expect(await res.text()).toBe('0123456789')
  })

  it('403s on traversal out of the allowed roots', async () => {
    const res = await handleMediaRequest(req('../../../../etc/passwd'))
    expect(res.status).toBe(403)
  })

  it('403s on absolute paths outside the roots', async () => {
    const res = await handleMediaRequest(req('/etc/passwd'))
    expect(res.status).toBe(403)
  })

  it('404s on a missing file inside the root', async () => {
    const res = await handleMediaRequest(req('nope.mp4'))
    expect(res.status).toBe(404)
  })

  it('serves a satisfiable range as 206 with correct headers', async () => {
    const res = await handleMediaRequest(req('clip.mp4', { Range: 'bytes=2-5' }))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(res.headers.get('content-length')).toBe('4')
    expect(await res.text()).toBe('2345')
  })

  it('403s a symlink inside the root that targets a file outside it', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'media-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf-8')
    await symlink(join(outside, 'secret.txt'), join(projectDir, 'sneaky.mp4'))
    const res = await handleMediaRequest(req('sneaky.mp4'))
    expect(res.status).toBe(403)
  })

  it('serves a symlink whose target stays inside the root', async () => {
    await symlink(join(projectDir, 'clip.mp4'), join(projectDir, 'alias.mp4'))
    const res = await handleMediaRequest(req('alias.mp4'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('0123456789')
  })

  it('416s an unsatisfiable range', async () => {
    const res = await handleMediaRequest(req('clip.mp4', { Range: 'bytes=99-' }))
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */10')
  })
})
