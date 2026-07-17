import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { atomicWriteJson, readJsonFile } from './fs'
import {
  galleryDir,
  isAllowedMediaPath,
  isSafeSessionId,
  projectDir,
  storyboardPath,
} from './paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('fs helpers', () => {
  it('readJsonFile returns null for a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'genmedia-ui-'))
    await expect(readJsonFile(join(dir, 'nope.json'))).resolves.toBeNull()
  })

  it('readJsonFile throws on malformed JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'genmedia-ui-'))
    const p = join(dir, 'bad.json')
    await writeFile(p, '{not json', 'utf-8')
    await expect(readJsonFile(p)).rejects.toThrow()
  })

  it('atomicWriteJson writes parseable JSON and leaves no temp files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'genmedia-ui-'))
    const p = join(dir, 'nested', 'storyboard.json')
    await atomicWriteJson(p, { hello: 'world' })
    expect(JSON.parse(await readFile(p, 'utf-8'))).toEqual({ hello: 'world' })
    const leftovers = (await readdir(join(dir, 'nested'))).filter((f) => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })
})

describe('path resolution', () => {
  it('honors GENMEDIA_UI_GALLERY and GENMEDIA_UI_PROJECT overrides', () => {
    vi.stubEnv('GENMEDIA_UI_GALLERY', '/tmp/fake-gallery')
    vi.stubEnv('GENMEDIA_UI_PROJECT', '/tmp/fake-project')
    expect(galleryDir()).toBe('/tmp/fake-gallery')
    expect(projectDir()).toBe('/tmp/fake-project')
    expect(storyboardPath()).toBe('/tmp/fake-project/storyboard.json')
  })

  it('defaults projectDir to cwd', () => {
    vi.stubEnv('GENMEDIA_UI_PROJECT', '')
    expect(projectDir()).toBe(process.cwd())
  })

  it('validates session ids', () => {
    expect(isSafeSessionId('a49672967c0c')).toBe(true)
    expect(isSafeSessionId('..')).toBe(false)
    expect(isSafeSessionId('a/b')).toBe(false)
    expect(isSafeSessionId('.hidden')).toBe(false)
    expect(isSafeSessionId('')).toBe(false)
  })

  it('restricts media paths to gallery and project roots', () => {
    vi.stubEnv('GENMEDIA_UI_GALLERY', '/tmp/fake-gallery')
    vi.stubEnv('GENMEDIA_UI_PROJECT', '/tmp/fake-project')
    expect(isAllowedMediaPath('/tmp/fake-gallery/sessions/x/data.json')).toBe(true)
    expect(isAllowedMediaPath('/tmp/fake-project/takes/scene-01/still.png')).toBe(true)
    expect(isAllowedMediaPath('/tmp/fake-gallery-evil/file.png')).toBe(false)
    expect(isAllowedMediaPath('/etc/passwd')).toBe(false)
    expect(isAllowedMediaPath('/tmp/fake-gallery/../secrets')).toBe(false)
  })
})
