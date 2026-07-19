/**
 * Story DB queries and mutations. Server-only helpers behind the server fns in
 * `story-functions.ts`; every function takes the target `StoryDb` explicitly so
 * tests can point them at a temp database.
 *
 * Every mutation bumps `updated_at` on the affected row AND on the owning
 * sequence (the sequence's `updated_at` is the UI's cheap "anything changed"
 * signal). Multi-statement mutations run inside a transaction; the node:sqlite
 * driver is synchronous, so transaction bodies use drizzle's sync execution
 * methods (`.run()` / `.all()` / `.get()`).
 */
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import {
  characters,
  elements,
  frames,
  generations,
  getDb,
  locations,
  sceneCharacters,
  sceneElements,
  scenes,
  sequences,
  shots,
  STORY_DB_FILENAME,
  type Character,
  type Element,
  type ElementKind,
  type Frame,
  type FrameRole,
  type Generation,
  type GenerationTargetType,
  type Location,
  type NewCharacter,
  type NewElement,
  type NewFrame,
  type NewLocation,
  type NewScene,
  type NewSequence,
  type NewShot,
  type Scene,
  type SceneStatus,
  type Sequence,
  type Shot,
  type StoryDb,
} from '../../db'
import { projectDir } from './paths'

// ---------------------------------------------------------------------------
// DB resolution for the current project
// ---------------------------------------------------------------------------

/**
 * The story DB path for the current project: `STORY_DB_PATH` env override
 * (tests), else `<projectDir()>/story.db` — the same project resolution as the
 * legacy storyboard flow. Watcher and server fns must agree on this.
 */
export function currentStoryDbPath(): string {
  const override = process.env.STORY_DB_PATH
  if (override !== undefined && override !== '') return resolve(override)
  return join(projectDir(), STORY_DB_FILENAME)
}

/** Open (cached) handle to the current project's story DB. */
export function storyDb(): StoryDb {
  return getDb(currentStoryDbPath())
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Human-friendly random id: `<prefix>_<10 chars of a-z0-9>`. */
export function newId(prefix: string): string {
  let slug = ''
  for (const byte of randomBytes(10)) {
    slug += ID_ALPHABET[byte % ID_ALPHABET.length] ?? '0'
  }
  return `${prefix}_${slug}`
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type EntityType = 'character' | 'location' | 'element'
export type EntityRow = Character | Location | Element
/** Any row a generation can be selected on. */
export type TargetRow = Frame | Shot | Character | Location | Element

export type SequenceSummary = {
  id: string
  title: string
  logline: string
  sceneCount: number
  shotCount: number
  characterCount: number
  locationCount: number
  elementCount: number
  createdAt: number
  updatedAt: number
}

export type ShotTree = Shot & { frames: Frame[] }
export type SceneTree = Scene & {
  characterIds: string[]
  elementIds: string[]
  shots: ShotTree[]
}
export type SequenceTree = {
  sequence: Sequence
  scenes: SceneTree[]
  characters: Character[]
  locations: Location[]
  elements: Element[]
  generations: Generation[]
}

// The sync-driver transaction handle (same query API as StoryDb).
type Tx = Parameters<Parameters<StoryDb['transaction']>[0]>[0]

// ---------------------------------------------------------------------------
// Internal helpers (sync — used inside transactions)
// ---------------------------------------------------------------------------

function touchSequence(tx: Tx, sequenceId: string, now: number): void {
  tx.update(sequences).set({ updatedAt: now }).where(eq(sequences.id, sequenceId)).run()
}

function sequenceExists(tx: Tx, sequenceId: string): boolean {
  return (
    tx.select({ id: sequences.id }).from(sequences).where(eq(sequences.id, sequenceId)).get() !==
    undefined
  )
}

function sequenceIdOfShot(tx: Tx, shotId: string): string | undefined {
  const row = tx
    .select({ sequenceId: scenes.sequenceId })
    .from(shots)
    .innerJoin(scenes, eq(shots.sceneId, scenes.id))
    .where(eq(shots.id, shotId))
    .get()
  return row?.sequenceId
}

function sequenceIdOfFrame(tx: Tx, frameId: string): string | undefined {
  const row = tx
    .select({ sequenceId: scenes.sequenceId })
    .from(frames)
    .innerJoin(shots, eq(frames.shotId, shots.id))
    .innerJoin(scenes, eq(shots.sceneId, scenes.id))
    .where(eq(frames.id, frameId))
    .get()
  return row?.sequenceId
}

// A scene's location must live in the same sequence; the FK alone only checks
// existence, so cross-sequence links are rejected here.
function assertLocationInSequence(tx: Tx, locationId: string, sequenceId: string): void {
  const row = tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.sequenceId, sequenceId)))
    .get()
  if (row === undefined) {
    throw new Error(`Location ${locationId} does not exist in sequence ${sequenceId}`)
  }
}

function nextSceneOrder(tx: Tx, sequenceId: string): number {
  const row = tx
    .select({ max: sql<number | null>`max(${scenes.orderIndex})` })
    .from(scenes)
    .where(eq(scenes.sequenceId, sequenceId))
    .get()
  return (row?.max ?? -1) + 1
}

function nextShotOrder(tx: Tx, sceneId: string): number {
  const row = tx
    .select({ max: sql<number | null>`max(${shots.orderIndex})` })
    .from(shots)
    .where(eq(shots.sceneId, sceneId))
    .get()
  return (row?.max ?? -1) + 1
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const toCountMap = (rows: { sequenceId: string; n: number }[]): Map<string, number> =>
  new Map(rows.map((r) => [r.sequenceId, r.n]))

export async function listSequenceSummaries(db: StoryDb): Promise<SequenceSummary[]> {
  const seqRows = await db
    .select()
    .from(sequences)
    .orderBy(desc(sequences.updatedAt), asc(sequences.id))
  const sceneCounts = await db
    .select({ sequenceId: scenes.sequenceId, n: count() })
    .from(scenes)
    .groupBy(scenes.sequenceId)
  const shotCounts = await db
    .select({ sequenceId: scenes.sequenceId, n: count() })
    .from(shots)
    .innerJoin(scenes, eq(shots.sceneId, scenes.id))
    .groupBy(scenes.sequenceId)
  const characterCounts = await db
    .select({ sequenceId: characters.sequenceId, n: count() })
    .from(characters)
    .groupBy(characters.sequenceId)
  const locationCounts = await db
    .select({ sequenceId: locations.sequenceId, n: count() })
    .from(locations)
    .groupBy(locations.sequenceId)
  const elementCounts = await db
    .select({ sequenceId: elements.sequenceId, n: count() })
    .from(elements)
    .groupBy(elements.sequenceId)

  const scenesBySeq = toCountMap(sceneCounts)
  const shotsBySeq = toCountMap(shotCounts)
  const charactersBySeq = toCountMap(characterCounts)
  const locationsBySeq = toCountMap(locationCounts)
  const elementsBySeq = toCountMap(elementCounts)

  return seqRows.map((seq) => ({
    id: seq.id,
    title: seq.title,
    logline: seq.logline,
    sceneCount: scenesBySeq.get(seq.id) ?? 0,
    shotCount: shotsBySeq.get(seq.id) ?? 0,
    characterCount: charactersBySeq.get(seq.id) ?? 0,
    locationCount: locationsBySeq.get(seq.id) ?? 0,
    elementCount: elementsBySeq.get(seq.id) ?? 0,
    createdAt: seq.createdAt,
    updatedAt: seq.updatedAt,
  }))
}

export async function getSequenceTree(db: StoryDb, id: string): Promise<SequenceTree | null> {
  const seqRows = await db.select().from(sequences).where(eq(sequences.id, id))
  const sequence = seqRows[0]
  if (sequence === undefined) return null

  const sceneRows = await db
    .select()
    .from(scenes)
    .where(eq(scenes.sequenceId, id))
    .orderBy(asc(scenes.orderIndex), asc(scenes.id))
  const sceneIds = sceneRows.map((s) => s.id)

  const shotRows =
    sceneIds.length > 0
      ? await db
          .select()
          .from(shots)
          .where(inArray(shots.sceneId, sceneIds))
          .orderBy(asc(shots.orderIndex), asc(shots.id))
      : []
  const shotIds = shotRows.map((s) => s.id)

  const frameRows =
    shotIds.length > 0
      ? await db
          .select()
          .from(frames)
          .where(inArray(frames.shotId, shotIds))
          .orderBy(asc(frames.role), asc(frames.id))
      : []

  const characterRows = await db
    .select()
    .from(characters)
    .where(eq(characters.sequenceId, id))
    .orderBy(asc(characters.name), asc(characters.id))
  const locationRows = await db
    .select()
    .from(locations)
    .where(eq(locations.sequenceId, id))
    .orderBy(asc(locations.name), asc(locations.id))
  const elementRows = await db
    .select()
    .from(elements)
    .where(eq(elements.sequenceId, id))
    .orderBy(asc(elements.name), asc(elements.id))

  const characterLinks =
    sceneIds.length > 0
      ? await db.select().from(sceneCharacters).where(inArray(sceneCharacters.sceneId, sceneIds))
      : []
  const elementLinks =
    sceneIds.length > 0
      ? await db.select().from(sceneElements).where(inArray(sceneElements.sceneId, sceneIds))
      : []

  // All generations targeting anything inside this sequence, oldest first.
  const targetIdsByType: [GenerationTargetType, string[]][] = [
    ['frame', frameRows.map((f) => f.id)],
    ['shot', shotIds],
    ['character', characterRows.map((c) => c.id)],
    ['location', locationRows.map((l) => l.id)],
    ['element', elementRows.map((e) => e.id)],
  ]
  const generationConds: SQL[] = []
  for (const [targetType, targetIds] of targetIdsByType) {
    if (targetIds.length === 0) continue
    const cond = and(
      eq(generations.targetType, targetType),
      inArray(generations.targetId, targetIds),
    )
    if (cond !== undefined) generationConds.push(cond)
  }
  const generationFilter = or(...generationConds)
  const generationRows =
    generationConds.length > 0 && generationFilter !== undefined
      ? await db
          .select()
          .from(generations)
          .where(generationFilter)
          .orderBy(asc(generations.createdAt), asc(generations.id))
      : []

  const framesByShot = new Map<string, Frame[]>()
  for (const frame of frameRows) {
    const list = framesByShot.get(frame.shotId)
    if (list === undefined) framesByShot.set(frame.shotId, [frame])
    else list.push(frame)
  }
  const shotsByScene = new Map<string, ShotTree[]>()
  for (const shot of shotRows) {
    const tree: ShotTree = { ...shot, frames: framesByShot.get(shot.id) ?? [] }
    const list = shotsByScene.get(shot.sceneId)
    if (list === undefined) shotsByScene.set(shot.sceneId, [tree])
    else list.push(tree)
  }
  const characterIdsByScene = new Map<string, string[]>()
  for (const link of characterLinks) {
    const list = characterIdsByScene.get(link.sceneId)
    if (list === undefined) characterIdsByScene.set(link.sceneId, [link.characterId])
    else list.push(link.characterId)
  }
  const elementIdsByScene = new Map<string, string[]>()
  for (const link of elementLinks) {
    const list = elementIdsByScene.get(link.sceneId)
    if (list === undefined) elementIdsByScene.set(link.sceneId, [link.elementId])
    else list.push(link.elementId)
  }

  return {
    sequence,
    scenes: sceneRows.map((scene) => ({
      ...scene,
      characterIds: characterIdsByScene.get(scene.id) ?? [],
      elementIds: elementIdsByScene.get(scene.id) ?? [],
      shots: shotsByScene.get(scene.id) ?? [],
    })),
    characters: characterRows,
    locations: locationRows,
    elements: elementRows,
    generations: generationRows,
  }
}

// ---------------------------------------------------------------------------
// Sequence mutations
// ---------------------------------------------------------------------------

export type CreateSequenceInput = {
  id?: string
  title: string
  logline?: string
  script?: string
}

export function createSequenceRow(db: StoryDb, input: CreateSequenceInput): Sequence {
  const now = Date.now()
  const row = db
    .insert(sequences)
    .values({
      id: input.id ?? newId('seq'),
      title: input.title,
      logline: input.logline ?? '',
      script: input.script ?? '',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  if (row === undefined) throw new Error('createSequenceRow: insert returned no row')
  return row
}

export type SequencePatch = { title?: string; logline?: string; script?: string }

export function updateSequenceRow(db: StoryDb, id: string, patch: SequencePatch): Sequence | null {
  const set: Partial<NewSequence> = { updatedAt: Date.now() }
  if (patch.title !== undefined) set.title = patch.title
  if (patch.logline !== undefined) set.logline = patch.logline
  if (patch.script !== undefined) set.script = patch.script
  const row = db.update(sequences).set(set).where(eq(sequences.id, id)).returning().get()
  return row ?? null
}

// ---------------------------------------------------------------------------
// Scene mutations
// ---------------------------------------------------------------------------

export type CreateSceneInput = {
  id?: string
  sequenceId: string
  title: string
  scriptExcerpt?: string
  synopsis?: string
  locationId?: string
  status?: SceneStatus
  notes?: string
  orderIndex?: number
}

export function createSceneRow(db: StoryDb, input: CreateSceneInput): Scene | null {
  return db.transaction((tx) => {
    if (!sequenceExists(tx, input.sequenceId)) return null
    if (input.locationId !== undefined) {
      assertLocationInSequence(tx, input.locationId, input.sequenceId)
    }
    const now = Date.now()
    const row = tx
      .insert(scenes)
      .values({
        id: input.id ?? newId('scn'),
        sequenceId: input.sequenceId,
        orderIndex: input.orderIndex ?? nextSceneOrder(tx, input.sequenceId),
        title: input.title,
        scriptExcerpt: input.scriptExcerpt ?? '',
        synopsis: input.synopsis ?? '',
        locationId: input.locationId ?? null,
        status: input.status ?? 'draft',
        notes: input.notes ?? '',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
    if (row === undefined) throw new Error('createSceneRow: insert returned no row')
    touchSequence(tx, input.sequenceId, now)
    return row
  })
}

export type ScenePatch = {
  title?: string
  scriptExcerpt?: string
  synopsis?: string
  /** `null` clears the location; omit to leave unchanged. */
  locationId?: string | null
  status?: SceneStatus
  notes?: string
  orderIndex?: number
}

export function updateSceneRow(db: StoryDb, id: string, patch: ScenePatch): Scene | null {
  return db.transaction((tx) => {
    const existing = tx.select().from(scenes).where(eq(scenes.id, id)).get()
    if (existing === undefined) return null
    if (typeof patch.locationId === 'string') {
      assertLocationInSequence(tx, patch.locationId, existing.sequenceId)
    }
    const now = Date.now()
    const set: Partial<NewScene> = { updatedAt: now }
    if (patch.title !== undefined) set.title = patch.title
    if (patch.scriptExcerpt !== undefined) set.scriptExcerpt = patch.scriptExcerpt
    if (patch.synopsis !== undefined) set.synopsis = patch.synopsis
    if (patch.locationId !== undefined) set.locationId = patch.locationId
    if (patch.status !== undefined) set.status = patch.status
    if (patch.notes !== undefined) set.notes = patch.notes
    if (patch.orderIndex !== undefined) set.orderIndex = patch.orderIndex
    const row = tx.update(scenes).set(set).where(eq(scenes.id, id)).returning().get()
    touchSequence(tx, existing.sequenceId, now)
    return row ?? null
  })
}

export function deleteSceneRow(db: StoryDb, id: string): boolean {
  return db.transaction((tx) => {
    const existing = tx
      .select({ sequenceId: scenes.sequenceId })
      .from(scenes)
      .where(eq(scenes.id, id))
      .get()
    if (existing === undefined) return false
    tx.delete(scenes).where(eq(scenes.id, id)).run()
    touchSequence(tx, existing.sequenceId, Date.now())
    return true
  })
}

/**
 * Set `order_index` on the sequence's scenes to match the position of each id
 * in `ids`. Ids not belonging to the sequence are ignored. Returns the
 * sequence's scenes in their new order, or null if the sequence is unknown.
 */
export function reorderSceneRows(db: StoryDb, sequenceId: string, ids: string[]): Scene[] | null {
  return db.transaction((tx) => {
    if (!sequenceExists(tx, sequenceId)) return null
    const now = Date.now()
    ids.forEach((id, index) => {
      tx.update(scenes)
        .set({ orderIndex: index, updatedAt: now })
        .where(and(eq(scenes.id, id), eq(scenes.sequenceId, sequenceId)))
        .run()
    })
    touchSequence(tx, sequenceId, now)
    return tx
      .select()
      .from(scenes)
      .where(eq(scenes.sequenceId, sequenceId))
      .orderBy(asc(scenes.orderIndex), asc(scenes.id))
      .all()
  })
}

// ---------------------------------------------------------------------------
// Shot mutations
// ---------------------------------------------------------------------------

export type CreateShotInput = {
  id?: string
  sceneId: string
  description?: string
  prompt?: string
  camera?: string
  durationSeconds?: number | null
  status?: SceneStatus
  notes?: string
  orderIndex?: number
}

export function createShotRow(db: StoryDb, input: CreateShotInput): Shot | null {
  return db.transaction((tx) => {
    const sequenceId = tx
      .select({ sequenceId: scenes.sequenceId })
      .from(scenes)
      .where(eq(scenes.id, input.sceneId))
      .get()?.sequenceId
    if (sequenceId === undefined) return null
    const now = Date.now()
    const row = tx
      .insert(shots)
      .values({
        id: input.id ?? newId('shot'),
        sceneId: input.sceneId,
        orderIndex: input.orderIndex ?? nextShotOrder(tx, input.sceneId),
        description: input.description ?? '',
        prompt: input.prompt ?? '',
        camera: input.camera ?? '',
        durationSeconds: input.durationSeconds ?? null,
        status: input.status ?? 'draft',
        notes: input.notes ?? '',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
    if (row === undefined) throw new Error('createShotRow: insert returned no row')
    touchSequence(tx, sequenceId, now)
    return row
  })
}

export type ShotPatch = {
  description?: string
  prompt?: string
  camera?: string
  /** `null` clears the duration; omit to leave unchanged. */
  durationSeconds?: number | null
  status?: SceneStatus
  notes?: string
  orderIndex?: number
}

export function updateShotRow(db: StoryDb, id: string, patch: ShotPatch): Shot | null {
  return db.transaction((tx) => {
    const sequenceId = sequenceIdOfShot(tx, id)
    if (sequenceId === undefined) return null
    const now = Date.now()
    const set: Partial<NewShot> = { updatedAt: now }
    if (patch.description !== undefined) set.description = patch.description
    if (patch.prompt !== undefined) set.prompt = patch.prompt
    if (patch.camera !== undefined) set.camera = patch.camera
    if (patch.durationSeconds !== undefined) set.durationSeconds = patch.durationSeconds
    if (patch.status !== undefined) set.status = patch.status
    if (patch.notes !== undefined) set.notes = patch.notes
    if (patch.orderIndex !== undefined) set.orderIndex = patch.orderIndex
    const row = tx.update(shots).set(set).where(eq(shots.id, id)).returning().get()
    touchSequence(tx, sequenceId, now)
    return row ?? null
  })
}

export function deleteShotRow(db: StoryDb, id: string): boolean {
  return db.transaction((tx) => {
    const sequenceId = sequenceIdOfShot(tx, id)
    if (sequenceId === undefined) return false
    tx.delete(shots).where(eq(shots.id, id)).run()
    touchSequence(tx, sequenceId, Date.now())
    return true
  })
}

/** Same contract as `reorderSceneRows`, scoped to one scene's shots. */
export function reorderShotRows(db: StoryDb, sceneId: string, ids: string[]): Shot[] | null {
  return db.transaction((tx) => {
    const sequenceId = tx
      .select({ sequenceId: scenes.sequenceId })
      .from(scenes)
      .where(eq(scenes.id, sceneId))
      .get()?.sequenceId
    if (sequenceId === undefined) return null
    const now = Date.now()
    ids.forEach((id, index) => {
      tx.update(shots)
        .set({ orderIndex: index, updatedAt: now })
        .where(and(eq(shots.id, id), eq(shots.sceneId, sceneId)))
        .run()
    })
    touchSequence(tx, sequenceId, now)
    return tx
      .select()
      .from(shots)
      .where(eq(shots.sceneId, sceneId))
      .orderBy(asc(shots.orderIndex), asc(shots.id))
      .all()
  })
}

// ---------------------------------------------------------------------------
// Frame mutations
// ---------------------------------------------------------------------------

export type UpsertFrameInput = {
  shotId: string
  role: FrameRole
  prompt?: string
  notes?: string
}

/**
 * Insert or update the frame at (shotId, role). On update only the provided
 * fields change; the frame id is stable across upserts.
 */
export function upsertFrameRow(db: StoryDb, input: UpsertFrameInput): Frame | null {
  return db.transaction((tx) => {
    const sequenceId = sequenceIdOfShot(tx, input.shotId)
    if (sequenceId === undefined) return null
    const now = Date.now()
    const updateSet: Partial<NewFrame> = { updatedAt: now }
    if (input.prompt !== undefined) updateSet.prompt = input.prompt
    if (input.notes !== undefined) updateSet.notes = input.notes
    const row = tx
      .insert(frames)
      .values({
        id: newId('frm'),
        shotId: input.shotId,
        role: input.role,
        prompt: input.prompt ?? '',
        notes: input.notes ?? '',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({ target: [frames.shotId, frames.role], set: updateSet })
      .returning()
      .get()
    touchSequence(tx, sequenceId, now)
    return row ?? null
  })
}

// ---------------------------------------------------------------------------
// Entity mutations (characters / locations / elements)
// ---------------------------------------------------------------------------

export type EntityPatch = {
  name?: string
  description?: string
  prompt?: string
  notes?: string
  /** Elements only; ignored for characters and locations. */
  kind?: ElementKind
}

// The three entity tables share the promptable-name shape; build the common
// part of an update once. NewCharacter/NewLocation both accept it structurally.
function entityBaseSet(
  patch: EntityPatch,
  now: number,
): Partial<NewCharacter> & Partial<NewLocation> & Partial<NewElement> {
  const set: Partial<NewCharacter> & Partial<NewLocation> & Partial<NewElement> = {
    updatedAt: now,
  }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.description !== undefined) set.description = patch.description
  if (patch.prompt !== undefined) set.prompt = patch.prompt
  if (patch.notes !== undefined) set.notes = patch.notes
  return set
}

export function updateEntityRow(
  db: StoryDb,
  type: EntityType,
  id: string,
  patch: EntityPatch,
): EntityRow | null {
  return db.transaction((tx) => {
    const now = Date.now()
    if (type === 'character') {
      const existing = tx.select().from(characters).where(eq(characters.id, id)).get()
      if (existing === undefined) return null
      const row = tx
        .update(characters)
        .set(entityBaseSet(patch, now))
        .where(eq(characters.id, id))
        .returning()
        .get()
      touchSequence(tx, existing.sequenceId, now)
      return row ?? null
    }
    if (type === 'location') {
      const existing = tx.select().from(locations).where(eq(locations.id, id)).get()
      if (existing === undefined) return null
      const row = tx
        .update(locations)
        .set(entityBaseSet(patch, now))
        .where(eq(locations.id, id))
        .returning()
        .get()
      touchSequence(tx, existing.sequenceId, now)
      return row ?? null
    }
    const existing = tx.select().from(elements).where(eq(elements.id, id)).get()
    if (existing === undefined) return null
    const set: Partial<NewElement> = entityBaseSet(patch, now)
    if (patch.kind !== undefined) set.kind = patch.kind
    const row = tx.update(elements).set(set).where(eq(elements.id, id)).returning().get()
    touchSequence(tx, existing.sequenceId, now)
    return row ?? null
  })
}

// ---------------------------------------------------------------------------
// Scene ↔ entity links
// ---------------------------------------------------------------------------

export type SceneEntityLinkInput = {
  sceneId: string
  entityType: 'character' | 'element'
  entityId: string
}

/**
 * Link a character/element to a scene (idempotent). Returns the bumped scene,
 * or null when the scene or entity is missing or they belong to different
 * sequences.
 */
export function linkSceneEntityRow(db: StoryDb, input: SceneEntityLinkInput): Scene | null {
  return db.transaction((tx) => {
    const scene = tx.select().from(scenes).where(eq(scenes.id, input.sceneId)).get()
    if (scene === undefined) return null
    const now = Date.now()
    if (input.entityType === 'character') {
      const entity = tx
        .select({ sequenceId: characters.sequenceId })
        .from(characters)
        .where(eq(characters.id, input.entityId))
        .get()
      if (entity === undefined || entity.sequenceId !== scene.sequenceId) return null
      tx.insert(sceneCharacters)
        .values({ sceneId: input.sceneId, characterId: input.entityId })
        .onConflictDoNothing()
        .run()
    } else {
      const entity = tx
        .select({ sequenceId: elements.sequenceId })
        .from(elements)
        .where(eq(elements.id, input.entityId))
        .get()
      if (entity === undefined || entity.sequenceId !== scene.sequenceId) return null
      tx.insert(sceneElements)
        .values({ sceneId: input.sceneId, elementId: input.entityId })
        .onConflictDoNothing()
        .run()
    }
    const row = tx
      .update(scenes)
      .set({ updatedAt: now })
      .where(eq(scenes.id, input.sceneId))
      .returning()
      .get()
    touchSequence(tx, scene.sequenceId, now)
    return row ?? null
  })
}

/** Remove a scene↔entity link (idempotent). Null only when the scene is missing. */
export function unlinkSceneEntityRow(db: StoryDb, input: SceneEntityLinkInput): Scene | null {
  return db.transaction((tx) => {
    const scene = tx.select().from(scenes).where(eq(scenes.id, input.sceneId)).get()
    if (scene === undefined) return null
    const now = Date.now()
    if (input.entityType === 'character') {
      tx.delete(sceneCharacters)
        .where(
          and(
            eq(sceneCharacters.sceneId, input.sceneId),
            eq(sceneCharacters.characterId, input.entityId),
          ),
        )
        .run()
    } else {
      tx.delete(sceneElements)
        .where(
          and(
            eq(sceneElements.sceneId, input.sceneId),
            eq(sceneElements.elementId, input.entityId),
          ),
        )
        .run()
    }
    const row = tx
      .update(scenes)
      .set({ updatedAt: now })
      .where(eq(scenes.id, input.sceneId))
      .returning()
      .get()
    touchSequence(tx, scene.sequenceId, now)
    return row ?? null
  })
}

// ---------------------------------------------------------------------------
// Generation selection
// ---------------------------------------------------------------------------

export type SelectGenerationInput = {
  targetType: GenerationTargetType
  targetId: string
  /** `null` clears the selection. */
  generationId: string | null
}

/**
 * Set (or clear) `selected_generation_id` on the target row. Returns the
 * updated row, or null when the target is missing or the generation does not
 * belong to that target.
 */
export function selectGenerationRow(db: StoryDb, input: SelectGenerationInput): TargetRow | null {
  return db.transaction((tx) => {
    if (input.generationId !== null) {
      const generation = tx
        .select()
        .from(generations)
        .where(eq(generations.id, input.generationId))
        .get()
      if (
        generation === undefined ||
        generation.targetType !== input.targetType ||
        generation.targetId !== input.targetId
      ) {
        return null
      }
    }
    const now = Date.now()
    const set = { selectedGenerationId: input.generationId, updatedAt: now }
    switch (input.targetType) {
      case 'frame': {
        const sequenceId = sequenceIdOfFrame(tx, input.targetId)
        if (sequenceId === undefined) return null
        const row = tx
          .update(frames)
          .set(set)
          .where(eq(frames.id, input.targetId))
          .returning()
          .get()
        touchSequence(tx, sequenceId, now)
        return row ?? null
      }
      case 'shot': {
        const sequenceId = sequenceIdOfShot(tx, input.targetId)
        if (sequenceId === undefined) return null
        const row = tx.update(shots).set(set).where(eq(shots.id, input.targetId)).returning().get()
        touchSequence(tx, sequenceId, now)
        return row ?? null
      }
      case 'character': {
        const existing = tx
          .select({ sequenceId: characters.sequenceId })
          .from(characters)
          .where(eq(characters.id, input.targetId))
          .get()
        if (existing === undefined) return null
        const row = tx
          .update(characters)
          .set(set)
          .where(eq(characters.id, input.targetId))
          .returning()
          .get()
        touchSequence(tx, existing.sequenceId, now)
        return row ?? null
      }
      case 'location': {
        const existing = tx
          .select({ sequenceId: locations.sequenceId })
          .from(locations)
          .where(eq(locations.id, input.targetId))
          .get()
        if (existing === undefined) return null
        const row = tx
          .update(locations)
          .set(set)
          .where(eq(locations.id, input.targetId))
          .returning()
          .get()
        touchSequence(tx, existing.sequenceId, now)
        return row ?? null
      }
      case 'element': {
        const existing = tx
          .select({ sequenceId: elements.sequenceId })
          .from(elements)
          .where(eq(elements.id, input.targetId))
          .get()
        if (existing === undefined) return null
        const row = tx
          .update(elements)
          .set(set)
          .where(eq(elements.id, input.targetId))
          .returning()
          .get()
        touchSequence(tx, existing.sequenceId, now)
        return row ?? null
      }
      default:
        return null
    }
  })
}
