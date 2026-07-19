import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  characters,
  closeAllDbs,
  elements,
  generations,
  getDb,
  locations,
  type StoryDb,
} from '../../db'
import {
  createSceneRow,
  createSequenceRow,
  createShotRow,
  currentStoryDbPath,
  deleteSceneRow,
  deleteShotRow,
  getSequenceTree,
  linkSceneEntityRow,
  listSequenceSummaries,
  newId,
  reorderSceneRows,
  reorderShotRows,
  selectGenerationRow,
  unlinkSceneEntityRow,
  updateEntityRow,
  updateSceneRow,
  updateSequenceRow,
  updateShotRow,
  upsertFrameRow,
} from './story-queries'

// Deterministic clock so updated_at bumps are observable; tick() advances it.
let now = 1_750_000_000_000
const tick = (): number => {
  now += 1000
  return now
}

let dir = ''
let db: StoryDb

beforeAll(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  dir = mkdtempSync(path.join(tmpdir(), 'story-queries-'))
  db = getDb(path.join(dir, 'story.db'))
})

afterAll(() => {
  vi.restoreAllMocks()
  closeAllDbs()
  rmSync(dir, { recursive: true, force: true })
})

async function sequenceUpdatedAt(id: string): Promise<number | undefined> {
  const tree = await getSequenceTree(db, id)
  return tree?.sequence.updatedAt
}

describe('currentStoryDbPath', () => {
  it('prefers STORY_DB_PATH, then GENMEDIA_UI_PROJECT/story.db', () => {
    const prevDb = process.env.STORY_DB_PATH
    const prevProject = process.env.GENMEDIA_UI_PROJECT
    try {
      process.env.STORY_DB_PATH = './some/story.db'
      expect(currentStoryDbPath()).toBe(path.resolve('./some/story.db'))
      delete process.env.STORY_DB_PATH
      process.env.GENMEDIA_UI_PROJECT = '/tmp/project-x'
      expect(currentStoryDbPath()).toBe(path.resolve('/tmp/project-x', 'story.db'))
    } finally {
      if (prevDb === undefined) delete process.env.STORY_DB_PATH
      else process.env.STORY_DB_PATH = prevDb
      if (prevProject === undefined) delete process.env.GENMEDIA_UI_PROJECT
      else process.env.GENMEDIA_UI_PROJECT = prevProject
    }
  })
})

describe('newId', () => {
  it('generates prefixed, distinct, url-safe ids', () => {
    const a = newId('scn')
    const b = newId('scn')
    expect(a).toMatch(/^scn_[a-z0-9]{10}$/)
    expect(a).not.toBe(b)
  })
})

describe('sequence + scene + shot mutations', () => {
  it('creates a sequence with defaults', () => {
    tick()
    const seq = createSequenceRow(db, { id: 'seq_a', title: 'Alpha' })
    expect(seq).toMatchObject({ id: 'seq_a', title: 'Alpha', logline: '', script: '' })
    expect(seq.createdAt).toBe(now)
    expect(seq.updatedAt).toBe(now)
  })

  it('updates only the provided sequence fields and bumps updated_at', () => {
    tick()
    const updated = updateSequenceRow(db, 'seq_a', { logline: 'A story.' })
    expect(updated?.logline).toBe('A story.')
    expect(updated?.title).toBe('Alpha')
    expect(updated?.updatedAt).toBe(now)
    expect(updateSequenceRow(db, 'seq_missing', { title: 'X' })).toBeNull()
  })

  it('creates scenes with auto-incrementing order and bumps the sequence', async () => {
    tick()
    const s1 = createSceneRow(db, { id: 'scn_a1', sequenceId: 'seq_a', title: 'One' })
    const s2 = createSceneRow(db, { id: 'scn_a2', sequenceId: 'seq_a', title: 'Two' })
    expect(s1?.orderIndex).toBe(0)
    expect(s2?.orderIndex).toBe(1)
    expect(s1?.status).toBe('draft')
    expect(await sequenceUpdatedAt('seq_a')).toBe(now)
    expect(createSceneRow(db, { sequenceId: 'seq_missing', title: 'X' })).toBeNull()
  })

  it('creates shots with auto-incrementing order per scene', async () => {
    tick()
    const sh1 = createShotRow(db, { id: 'shot_a1a', sceneId: 'scn_a1', prompt: 'push in' })
    const sh2 = createShotRow(db, { id: 'shot_a1b', sceneId: 'scn_a1', durationSeconds: 4.5 })
    expect(sh1?.orderIndex).toBe(0)
    expect(sh2?.orderIndex).toBe(1)
    expect(sh2?.durationSeconds).toBe(4.5)
    expect(await sequenceUpdatedAt('seq_a')).toBe(now)
    expect(createShotRow(db, { sceneId: 'scn_missing' })).toBeNull()
  })

  it('patches a shot and bumps shot + sequence updated_at', async () => {
    tick()
    const updated = updateShotRow(db, 'shot_a1a', { camera: 'dolly', durationSeconds: null })
    expect(updated?.camera).toBe('dolly')
    expect(updated?.durationSeconds).toBeNull()
    expect(updated?.prompt).toBe('push in')
    expect(updated?.updatedAt).toBe(now)
    expect(await sequenceUpdatedAt('seq_a')).toBe(now)
    expect(updateShotRow(db, 'shot_missing', { camera: 'x' })).toBeNull()
  })

  it('reorders scenes by id position and ignores foreign ids', async () => {
    tick()
    // A second sequence whose scene must not be hijacked by the reorder.
    createSequenceRow(db, { id: 'seq_b', title: 'Beta' })
    const foreign = createSceneRow(db, { id: 'scn_b1', sequenceId: 'seq_b', title: 'B one' })
    expect(foreign?.orderIndex).toBe(0)

    tick()
    const reordered = reorderSceneRows(db, 'seq_a', ['scn_a2', 'scn_b1', 'scn_a1'])
    expect(reordered?.map((s) => s.id)).toEqual(['scn_a2', 'scn_a1'])
    expect(reordered?.map((s) => s.orderIndex)).toEqual([0, 2])
    const treeB = await getSequenceTree(db, 'seq_b')
    expect(treeB?.scenes[0]?.orderIndex).toBe(0)
    expect(reorderSceneRows(db, 'seq_missing', ['scn_a1'])).toBeNull()
  })

  it('reorders shots within a scene', () => {
    tick()
    const reordered = reorderShotRows(db, 'scn_a1', ['shot_a1b', 'shot_a1a'])
    expect(reordered?.map((s) => s.id)).toEqual(['shot_a1b', 'shot_a1a'])
    expect(reorderShotRows(db, 'scn_missing', ['shot_a1a'])).toBeNull()
  })
})

describe('frames', () => {
  it('upserts on (shot, role) keeping the frame id stable', () => {
    tick()
    const created = upsertFrameRow(db, { shotId: 'shot_a1a', role: 'start', prompt: 'wide, dusk' })
    expect(created?.prompt).toBe('wide, dusk')
    tick()
    const updated = upsertFrameRow(db, { shotId: 'shot_a1a', role: 'start', prompt: 'close-up' })
    expect(updated?.id).toBe(created?.id)
    expect(updated?.prompt).toBe('close-up')
    expect(updated?.createdAt).toBe(created?.createdAt)
    expect(updated?.updatedAt).toBe(now)
    // Omitted fields survive the upsert.
    const notesOnly = upsertFrameRow(db, { shotId: 'shot_a1a', role: 'start', notes: 'n1' })
    expect(notesOnly?.prompt).toBe('close-up')
    expect(notesOnly?.notes).toBe('n1')
    expect(upsertFrameRow(db, { shotId: 'shot_missing', role: 'end' })).toBeNull()
  })
})

describe('entities and scene links', () => {
  it('updates entities via the shared fn and bumps the sequence', async () => {
    await db.insert(characters).values({
      id: 'chr_a',
      sequenceId: 'seq_a',
      name: 'Keeper',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(locations).values({
      id: 'loc_a',
      sequenceId: 'seq_a',
      name: 'Lighthouse',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(elements).values({
      id: 'elm_a',
      sequenceId: 'seq_a',
      name: 'Lamp',
      createdAt: now,
      updatedAt: now,
    })

    tick()
    const chr = updateEntityRow(db, 'character', 'chr_a', { prompt: 'oilskin coat' })
    expect(chr?.prompt).toBe('oilskin coat')
    expect(chr?.updatedAt).toBe(now)
    const elm = updateEntityRow(db, 'element', 'elm_a', { kind: 'creature', name: 'Gull' })
    expect(elm).toMatchObject({ name: 'Gull', kind: 'creature' })
    expect(await sequenceUpdatedAt('seq_a')).toBe(now)
    expect(updateEntityRow(db, 'location', 'loc_missing', { name: 'X' })).toBeNull()
  })

  it('sets and clears the scene location, rejecting cross-sequence locations', () => {
    tick()
    const withLoc = updateSceneRow(db, 'scn_a1', { locationId: 'loc_a' })
    expect(withLoc?.locationId).toBe('loc_a')
    const cleared = updateSceneRow(db, 'scn_a1', { locationId: null })
    expect(cleared?.locationId).toBeNull()
    // loc_a belongs to seq_a; scn_b1 lives in seq_b.
    expect(() => updateSceneRow(db, 'scn_b1', { locationId: 'loc_a' })).toThrow(/does not exist/)
  })

  it('links and unlinks scene entities, rejecting cross-sequence links', async () => {
    tick()
    const linked = linkSceneEntityRow(db, {
      sceneId: 'scn_a1',
      entityType: 'character',
      entityId: 'chr_a',
    })
    expect(linked?.updatedAt).toBe(now)
    // Idempotent — a second link is a no-op, not an error.
    expect(
      linkSceneEntityRow(db, { sceneId: 'scn_a1', entityType: 'character', entityId: 'chr_a' }),
    ).not.toBeNull()
    linkSceneEntityRow(db, { sceneId: 'scn_a1', entityType: 'element', entityId: 'elm_a' })

    let tree = await getSequenceTree(db, 'seq_a')
    let scene = tree?.scenes.find((s) => s.id === 'scn_a1')
    expect(scene?.characterIds).toEqual(['chr_a'])
    expect(scene?.elementIds).toEqual(['elm_a'])

    // chr_a belongs to seq_a — linking it into seq_b's scene must fail.
    expect(
      linkSceneEntityRow(db, { sceneId: 'scn_b1', entityType: 'character', entityId: 'chr_a' }),
    ).toBeNull()

    const unlinked = unlinkSceneEntityRow(db, {
      sceneId: 'scn_a1',
      entityType: 'element',
      entityId: 'elm_a',
    })
    expect(unlinked).not.toBeNull()
    tree = await getSequenceTree(db, 'seq_a')
    scene = tree?.scenes.find((s) => s.id === 'scn_a1')
    expect(scene?.elementIds).toEqual([])
    expect(scene?.characterIds).toEqual(['chr_a'])
  })
})

describe('generations', () => {
  it('selects only a generation that belongs to the target, and clears with null', async () => {
    await db.insert(generations).values([
      {
        id: 'gen_shot',
        targetType: 'shot',
        targetId: 'shot_a1a',
        kind: 'video',
        path: '/takes/shot_a1a/0.mp4',
        createdAt: now,
      },
      {
        id: 'gen_chr',
        targetType: 'character',
        targetId: 'chr_a',
        kind: 'image',
        path: '/takes/chr_a/0.png',
        createdAt: now,
      },
    ])

    tick()
    // Wrong target — rejected, nothing changes.
    expect(
      selectGenerationRow(db, {
        targetType: 'shot',
        targetId: 'shot_a1b',
        generationId: 'gen_shot',
      }),
    ).toBeNull()
    expect(
      selectGenerationRow(db, {
        targetType: 'character',
        targetId: 'chr_a',
        generationId: 'gen_shot',
      }),
    ).toBeNull()

    const shot = selectGenerationRow(db, {
      targetType: 'shot',
      targetId: 'shot_a1a',
      generationId: 'gen_shot',
    })
    expect(shot).toMatchObject({ id: 'shot_a1a', selectedGenerationId: 'gen_shot' })
    expect(await sequenceUpdatedAt('seq_a')).toBe(now)

    const chr = selectGenerationRow(db, {
      targetType: 'character',
      targetId: 'chr_a',
      generationId: 'gen_chr',
    })
    expect(chr).toMatchObject({ id: 'chr_a', selectedGenerationId: 'gen_chr' })

    const clearedRow = selectGenerationRow(db, {
      targetType: 'shot',
      targetId: 'shot_a1a',
      generationId: null,
    })
    expect(clearedRow).toMatchObject({ id: 'shot_a1a', selectedGenerationId: null })
    expect(
      selectGenerationRow(db, { targetType: 'frame', targetId: 'frm_missing', generationId: null }),
    ).toBeNull()
  })
})

describe('tree + summaries', () => {
  it('returns the full ordered tree with generations scoped to the sequence', async () => {
    // seq_b gets its own shot + generation that must NOT leak into seq_a's tree.
    tick()
    createShotRow(db, { id: 'shot_b1a', sceneId: 'scn_b1' })
    await db.insert(generations).values({
      id: 'gen_b',
      targetType: 'shot',
      targetId: 'shot_b1a',
      kind: 'video',
      path: '/takes/shot_b1a/0.mp4',
      createdAt: now,
    })
    upsertFrameRow(db, { shotId: 'shot_a1a', role: 'end', prompt: 'lamp lit' })

    const tree = await getSequenceTree(db, 'seq_a')
    expect(tree).not.toBeNull()
    if (tree === null) return
    expect(tree.sequence.id).toBe('seq_a')
    // Scene order comes from order_index (scn_a2 was reordered to 0 earlier).
    expect(tree.scenes.map((s) => s.id)).toEqual(['scn_a2', 'scn_a1'])
    const scene = tree.scenes.find((s) => s.id === 'scn_a1')
    // Shot order comes from order_index (reordered to b, a earlier).
    expect(scene?.shots.map((s) => s.id)).toEqual(['shot_a1b', 'shot_a1a'])
    const shot = scene?.shots.find((s) => s.id === 'shot_a1a')
    expect(shot?.frames.map((f) => f.role)).toEqual(['end', 'start'])
    expect(tree.characters.map((c) => c.id)).toEqual(['chr_a'])
    expect(tree.locations.map((l) => l.id)).toEqual(['loc_a'])
    expect(tree.elements.map((e) => e.id)).toEqual(['elm_a'])
    // Ordered by (created_at, id) — both were inserted at the same tick.
    expect(tree.generations.map((g) => g.id)).toEqual(['gen_chr', 'gen_shot'])
    expect(await getSequenceTree(db, 'seq_missing')).toBeNull()
  })

  it('lists sequences with counts, most recently updated first', async () => {
    tick()
    updateSequenceRow(db, 'seq_b', { logline: 'bump to the top' })
    const summaries = await listSequenceSummaries(db)
    expect(summaries.map((s) => s.id)).toEqual(['seq_b', 'seq_a'])
    const a = summaries.find((s) => s.id === 'seq_a')
    expect(a).toMatchObject({
      sceneCount: 2,
      shotCount: 2,
      characterCount: 1,
      locationCount: 1,
      elementCount: 1,
    })
    const b = summaries.find((s) => s.id === 'seq_b')
    expect(b).toMatchObject({ sceneCount: 1, shotCount: 1, characterCount: 0 })
  })
})

describe('deletes', () => {
  it('deletes shots and scenes, reporting false for unknown ids', async () => {
    tick()
    expect(deleteShotRow(db, 'shot_a1b')).toBe(true)
    expect(deleteShotRow(db, 'shot_a1b')).toBe(false)
    expect(deleteSceneRow(db, 'scn_a1')).toBe(true)
    expect(deleteSceneRow(db, 'scn_missing')).toBe(false)
    const tree = await getSequenceTree(db, 'seq_a')
    expect(tree?.scenes.map((s) => s.id)).toEqual(['scn_a2'])
    expect(await sequenceUpdatedAt('seq_a')).toBe(now)
  })
})
