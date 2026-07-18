import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyStoryboard } from '../schemas/storyboard'
import { readStoryboardOnDisk, writeVerdict } from './storyboard-io'

async function tmpPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'sb-io-')), 'storyboard.json')
}

describe('readStoryboardOnDisk', () => {
  it('reports missing when there is no file', async () => {
    expect(await readStoryboardOnDisk(await tmpPath())).toEqual({ kind: 'missing' })
  })

  it('reads a valid doc', async () => {
    const p = await tmpPath()
    const doc = emptyStoryboard('t')
    await writeFile(p, JSON.stringify(doc), 'utf-8')
    expect(await readStoryboardOnDisk(p)).toEqual({ kind: 'ok', doc })
  })

  it('reports invalid for torn/unparseable JSON', async () => {
    const p = await tmpPath()
    await writeFile(p, '{"schema_version":1,"title":"half-writ', 'utf-8')
    expect(await readStoryboardOnDisk(p)).toEqual({ kind: 'invalid' })
  })

  it('reports invalid for valid JSON that fails the schema', async () => {
    const p = await tmpPath()
    await writeFile(p, JSON.stringify({ schema_version: 99, future: true }), 'utf-8')
    expect(await readStoryboardOnDisk(p)).toEqual({ kind: 'invalid' })
  })
})

describe('writeVerdict', () => {
  const doc = { ...emptyStoryboard('t'), updated_at: 1000 }

  it('allows a write when updated_at matches', () => {
    expect(writeVerdict({ kind: 'ok', doc }, 1000)).toBe('ok')
  })

  it('conflicts when disk moved past the client base', () => {
    expect(writeVerdict({ kind: 'ok', doc }, 999)).toBe('conflict')
  })

  it('conflicts when the client saw no doc but one now exists', () => {
    expect(writeVerdict({ kind: 'ok', doc }, null)).toBe('conflict')
  })

  it('never clobbers an invalid/unverifiable doc (non-retryable)', () => {
    expect(writeVerdict({ kind: 'invalid' }, 1000)).toBe('unreadable')
    expect(writeVerdict({ kind: 'invalid' }, null)).toBe('unreadable')
  })

  it('allows recreating a vanished file', () => {
    expect(writeVerdict({ kind: 'missing' }, 1000)).toBe('ok')
    expect(writeVerdict({ kind: 'missing' }, null)).toBe('ok')
  })
})
