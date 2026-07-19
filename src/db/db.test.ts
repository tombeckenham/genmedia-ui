import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SCHEMA_SQL } from './ddl'
import {
  characters,
  closeAllDbs,
  elements,
  frames,
  generations,
  getDb,
  locations,
  meta,
  sceneCharacters,
  sceneElements,
  scenes,
  sequences,
  shots,
  storyDbPath,
  type StoryDb,
} from './index'

const NOW = 1_700_000_000_000

let dir = ''
let dbFile = ''
let db: StoryDb

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'story-db-'))
  dbFile = path.join(dir, 'story.db')
  process.env.STORY_DB_PATH = dbFile
  db = getDb()
})

afterAll(() => {
  closeAllDbs()
  delete process.env.STORY_DB_PATH
  rmSync(dir, { recursive: true, force: true })
})

describe('db path resolution & caching', () => {
  it('resolves STORY_DB_PATH and caches handles per resolved path', () => {
    expect(storyDbPath()).toBe(path.resolve(dbFile))
    expect(getDb()).toBe(db)
    expect(getDb(dbFile)).toBe(db)
    const other = getDb(path.join(dir, 'other.db'))
    expect(other).not.toBe(db)
    expect(getDb(path.join(dir, 'other.db'))).toBe(other)
  })
})

describe('migration', () => {
  it('is idempotent and records schema_version = 1', async () => {
    db.$client.exec(SCHEMA_SQL) // re-applying must not throw
    const rows = await db.select().from(meta).where(eq(meta.key, 'schema_version'))
    expect(rows).toEqual([{ key: 'schema_version', value: '1' }])
  })

  it('keeps schema.sql byte-identical to SCHEMA_SQL in ddl.ts', () => {
    // jsdom env: import.meta.url is not a file: URL, so resolve from the repo root
    const sqlFile = readFileSync(path.join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf8')
    expect(sqlFile).toBe(SCHEMA_SQL)
  })
})

describe('story tree', () => {
  it('round-trips a sequence → scene → shot → frames tree with entities and a generation', async () => {
    await db.insert(sequences).values({
      id: 'seq_test',
      title: 'Lighthouse',
      logline: 'A keeper faces the storm.',
      script: 'FADE IN...',
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.insert(locations).values({
      id: 'loc_light',
      sequenceId: 'seq_test',
      name: 'Lighthouse',
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.insert(characters).values({
      id: 'chr_keeper',
      sequenceId: 'seq_test',
      name: 'The Keeper',
      prompt: 'weathered face, oilskin coat',
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.insert(elements).values({
      id: 'elm_lamp',
      sequenceId: 'seq_test',
      name: 'Fresnel lamp',
      kind: 'prop',
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.insert(scenes).values({
      id: 'scn_01',
      sequenceId: 'seq_test',
      orderIndex: 0,
      title: 'Arrival',
      locationId: 'loc_light',
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.insert(shots).values({
      id: 'shot_01a',
      sceneId: 'scn_01',
      orderIndex: 0,
      prompt: 'slow push-in on the lighthouse',
      durationSeconds: 4.5,
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.insert(frames).values([
      {
        id: 'frm_01a_start',
        shotId: 'shot_01a',
        role: 'start',
        prompt: 'wide shot, dusk',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'frm_01a_end',
        shotId: 'shot_01a',
        role: 'end',
        prompt: 'close on the lamp',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ])
    await db.insert(sceneCharacters).values({ sceneId: 'scn_01', characterId: 'chr_keeper' })
    await db.insert(sceneElements).values({ sceneId: 'scn_01', elementId: 'elm_lamp' })
    await db.insert(generations).values({
      id: 'gen_1',
      targetType: 'frame',
      targetId: 'frm_01a_start',
      kind: 'image',
      path: '/takes/frm_01a_start/0.png',
      params: '{"seed":42}',
      createdAt: NOW,
    })
    await db
      .update(frames)
      .set({ selectedGenerationId: 'gen_1', updatedAt: NOW + 1 })
      .where(eq(frames.id, 'frm_01a_start'))

    const frameRows = await db.select().from(frames).where(eq(frames.shotId, 'shot_01a'))
    expect(frameRows).toHaveLength(2)
    const start = frameRows.find((f) => f.role === 'start')
    expect(start?.selectedGenerationId).toBe('gen_1')
    expect(start?.prompt).toBe('wide shot, dusk')

    const shotRows = await db.select().from(shots).where(eq(shots.sceneId, 'scn_01'))
    expect(shotRows).toHaveLength(1)
    expect(shotRows[0]?.status).toBe('draft')
    expect(shotRows[0]?.durationSeconds).toBe(4.5)
  })

  it('rejects a second frame with the same (shot_id, role)', async () => {
    let err: unknown = null
    try {
      await db.insert(frames).values({
        id: 'frm_dup',
        shotId: 'shot_01a',
        role: 'start',
        createdAt: NOW,
        updatedAt: NOW,
      })
    } catch (e) {
      err = e
    }
    // drizzle wraps the driver error; the UNIQUE constraint detail is on cause
    expect(err).toBeInstanceOf(Error)
    const cause = err instanceof Error ? err.cause : undefined
    expect(String(cause)).toMatch(/UNIQUE/i)
    const rows = await db.select().from(frames).where(eq(frames.shotId, 'shot_01a'))
    expect(rows).toHaveLength(2)
  })

  it('sets scenes.location_id to NULL when the location is deleted', async () => {
    await db.delete(locations).where(eq(locations.id, 'loc_light'))
    const sceneRows = await db.select().from(scenes).where(eq(scenes.id, 'scn_01'))
    expect(sceneRows).toHaveLength(1)
    expect(sceneRows[0]?.locationId).toBeNull()
  })

  it('cascade-deletes scenes, shots, frames, entities, and links with the sequence', async () => {
    await db.delete(sequences).where(eq(sequences.id, 'seq_test'))
    expect(await db.select().from(scenes)).toHaveLength(0)
    expect(await db.select().from(shots)).toHaveLength(0)
    expect(await db.select().from(frames)).toHaveLength(0)
    expect(await db.select().from(characters)).toHaveLength(0)
    expect(await db.select().from(elements)).toHaveLength(0)
    expect(await db.select().from(sceneCharacters)).toHaveLength(0)
    expect(await db.select().from(sceneElements)).toHaveLength(0)
    // generations are polymorphic (no FK to targets) and survive on purpose
    expect(await db.select().from(generations)).toHaveLength(1)
  })
})
