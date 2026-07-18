/**
 * Story CLI — the skills' write path into the per-project story database.
 *
 * Usage: `bun run story <command> [flags]` (or `bunx tsx scripts/story.ts ...`).
 * Every command prints JSON to stdout; failures exit non-zero with a JSON
 * error object on stderr. No interactive prompts.
 *
 * Global flags on every command:
 *   --db <path>       exact DB file
 *   --project <dir>   uses <dir>/story.db
 * Default (via `storyDbPath()`): `STORY_DB_PATH` env if set (tests), else
 * `$GENMEDIA_UI_PROJECT/story.db` if that env is set, else `./story.db` in
 * the cwd (skills run from inside the project folder).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { randomBytes } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  characters,
  ELEMENT_KINDS,
  elements,
  FRAME_ROLES,
  frames,
  GENERATION_KINDS,
  GENERATION_TARGET_TYPES,
  generations,
  getDb,
  locations,
  SCENE_STATUSES,
  sceneCharacters,
  sceneElements,
  scenes,
  sequences,
  shots,
  STORY_DB_FILENAME,
  storyDbPath,
  type Character,
  type Element,
  type ElementKind,
  type Frame,
  type Generation,
  type GenerationTargetType,
  type Location,
  type Scene,
  type Sequence,
  type Shot,
  type StoryDb,
} from '../src/db/index.ts'

// ---------------------------------------------------------------------------
// Errors & output

class CliError extends Error {
  readonly details: unknown

  constructor(message: string, details?: unknown) {
    super(message)
    this.name = 'CliError'
    this.details = details
  }
}

function fail(message: string, details?: unknown): never {
  throw new CliError(message, details)
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

// ---------------------------------------------------------------------------
// Arg parsing helpers (node:util parseArgs — dependency-free)

type ArgValues = Record<string, string | boolean | Array<string | boolean> | undefined>

type OptionSpec = Record<string, { type: 'string' | 'boolean'; multiple?: boolean }>

function parseCmd(args: string[], extra: OptionSpec): { values: ArgValues; positionals: string[] } {
  const { values, positionals } = parseArgs({
    args,
    options: { db: { type: 'string' }, project: { type: 'string' }, ...extra },
    strict: true,
    allowPositionals: true,
  })
  return { values, positionals }
}

function optStr(values: ArgValues, key: string): string | undefined {
  const v = values[key]
  return typeof v === 'string' ? v : undefined
}

function reqStr(values: ArgValues, key: string): string {
  const v = optStr(values, key)
  if (v === undefined) fail(`missing required flag --${key}`)
  return v
}

function optBool(values: ArgValues, key: string): boolean {
  return values[key] === true
}

function optNum(values: ArgValues, key: string): number | undefined {
  const v = optStr(values, key)
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) fail(`--${key} must be a number, got: ${v}`)
  return n
}

function optInt(values: ArgValues, key: string): number | undefined {
  const n = optNum(values, key)
  if (n !== undefined && !Number.isInteger(n)) fail(`--${key} must be an integer`)
  return n
}

function strList(values: ArgValues, key: string): string[] {
  const v = values[key]
  if (v === undefined) return []
  const arr = Array.isArray(v) ? v : [v]
  return arr.filter((x): x is string => typeof x === 'string')
}

function asOneOf<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  return allowed.find((a): boolean => a === value)
}

function reqEnum<T extends string>(values: ArgValues, key: string, allowed: readonly T[]): T {
  const v = reqStr(values, key)
  return asOneOf(v, allowed) ?? fail(`--${key} must be one of: ${allowed.join(', ')} (got: ${v})`)
}

function noPositionals(positionals: string[]): void {
  if (positionals.length > 0) fail(`unexpected arguments: ${positionals.join(' ')}`)
}

// ---------------------------------------------------------------------------
// DB resolution

function resolveDbPath(values: ArgValues): string {
  const db = optStr(values, 'db')
  if (db !== undefined) return path.resolve(db)
  const project = optStr(values, 'project')
  if (project !== undefined) return path.resolve(project, STORY_DB_FILENAME)
  return storyDbPath()
}

function openDb(values: ArgValues): StoryDb {
  return getDb(resolveDbPath(values))
}

/** Manual transaction: the node:sqlite driver is synchronous underneath, so
 * awaited drizzle calls complete before the next statement — a raw
 * BEGIN/COMMIT pair on the shared connection is safe. */
async function withTransaction<T>(db: StoryDb, fn: () => Promise<T>): Promise<T> {
  db.$client.exec('BEGIN IMMEDIATE')
  try {
    const result = await fn()
    db.$client.exec('COMMIT')
    return result
  } catch (err) {
    db.$client.exec('ROLLBACK')
    throw err
  }
}

// ---------------------------------------------------------------------------
// Tables, ids, shared lookups

const TABLE_NAMES = [
  'sequences',
  'scenes',
  'shots',
  'frames',
  'characters',
  'locations',
  'elements',
  'generations',
] as const
type TableName = (typeof TABLE_NAMES)[number]

const TARGET_TABLE: Record<GenerationTargetType, TableName> = {
  frame: 'frames',
  shot: 'shots',
  character: 'characters',
  location: 'locations',
  element: 'elements',
}

/** Reverse of TARGET_TABLE: which generation target_type a table's rows are. */
const TABLE_TARGET_TYPE: Partial<Record<TableName, GenerationTargetType>> = {
  frames: 'frame',
  shots: 'shot',
  characters: 'character',
  locations: 'location',
  elements: 'element',
}

type EntityType = 'character' | 'location' | 'element'
const ENTITY_TYPES = ['character', 'location', 'element'] as const
const ENTITY_TABLE: Record<EntityType, TableName> = {
  character: 'characters',
  location: 'locations',
  element: 'elements',
}
const ENTITY_PREFIX: Record<EntityType, string> = {
  character: 'chr',
  location: 'loc',
  element: 'elm',
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

function randomSlug(): string {
  return randomBytes(4).toString('hex')
}

/** Table names are always from the TABLE_NAMES whitelist — safe to interpolate. */
function idExists(db: StoryDb, table: TableName, id: string): boolean {
  return db.$client.prepare(`SELECT 1 AS one FROM ${table} WHERE id = ?`).get(id) !== undefined
}

/** Human-friendly unique id: `<prefix>_<slug>` with `_2`, `_3`, ... on collision. */
function genId(db: StoryDb, table: TableName, prefix: string, base: string): string {
  const slug = slugify(base)
  const stem = slug === '' ? `${prefix}_${randomSlug()}` : `${prefix}_${slug}`
  if (!idExists(db, table, stem)) return stem
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}_${n}`
    if (!idExists(db, table, candidate)) return candidate
  }
}

/** Explicit --id: must not collide. Otherwise generate. */
function pickId(
  db: StoryDb,
  table: TableName,
  prefix: string,
  base: string,
  explicit: string | undefined,
): string {
  if (explicit !== undefined) {
    if (idExists(db, table, explicit)) fail(`${table} id already exists: ${explicit}`)
    return explicit
  }
  return genId(db, table, prefix, base)
}

/** The ancestor sequence id for any row (undefined if the row is orphaned). */
function sequenceIdOf(db: StoryDb, table: TableName, id: string): string | undefined {
  if (table === 'generations') {
    const row = db.$client
      .prepare('SELECT target_type AS tt, target_id AS ti FROM generations WHERE id = ?')
      .get(id)
    const tt = row?.['tt']
    const ti = row?.['ti']
    if (typeof tt !== 'string' || typeof ti !== 'string') return undefined
    const targetType = asOneOf(tt, GENERATION_TARGET_TYPES)
    if (targetType === undefined) return undefined
    return sequenceIdOf(db, TARGET_TABLE[targetType], ti)
  }
  const queries: Record<Exclude<TableName, 'generations'>, string> = {
    sequences: 'SELECT id AS sid FROM sequences WHERE id = ?',
    scenes: 'SELECT sequence_id AS sid FROM scenes WHERE id = ?',
    shots:
      'SELECT sc.sequence_id AS sid FROM shots sh JOIN scenes sc ON sh.scene_id = sc.id WHERE sh.id = ?',
    frames:
      'SELECT sc.sequence_id AS sid FROM frames f JOIN shots sh ON f.shot_id = sh.id JOIN scenes sc ON sh.scene_id = sc.id WHERE f.id = ?',
    characters: 'SELECT sequence_id AS sid FROM characters WHERE id = ?',
    locations: 'SELECT sequence_id AS sid FROM locations WHERE id = ?',
    elements: 'SELECT sequence_id AS sid FROM elements WHERE id = ?',
  }
  const row = db.$client.prepare(queries[table]).get(id)
  const sid = row?.['sid']
  return typeof sid === 'string' ? sid : undefined
}

/**
 * A `selected_generation_id` may only point at a generation that actually
 * targets that row (same check the UI's selectGeneration server fn makes) —
 * otherwise the UI would render another row's asset as this row's thumbnail.
 */
function assertGenerationTargetsRow(
  db: StoryDb,
  table: TableName,
  rowId: string,
  generationId: string,
): void {
  const expected = TABLE_TARGET_TYPE[table]
  if (expected === undefined) fail(`${table} rows cannot have a selected generation`)
  const row = db.$client
    .prepare('SELECT target_type AS tt, target_id AS ti FROM generations WHERE id = ?')
    .get(generationId)
  if (row === undefined) fail(`generation not found: ${generationId}`)
  if (row['tt'] !== expected || row['ti'] !== rowId) {
    fail(
      `generation ${generationId} does not belong to ${expected} ${rowId} ` +
        `(it targets ${String(row['tt'])} ${String(row['ti'])})`,
    )
  }
}

/** Bump sequences.updated_at — the cheap "anything changed" signal for the UI. */
function touchSequence(db: StoryDb, sequenceId: string | undefined, now: number): void {
  if (sequenceId === undefined) return
  db.$client.prepare('UPDATE sequences SET updated_at = ? WHERE id = ?').run(now, sequenceId)
}

function touchRow(db: StoryDb, table: TableName, id: string, now: number): void {
  if (table === 'generations') return // generations have no updated_at
  db.$client.prepare(`UPDATE ${table} SET updated_at = ? WHERE id = ?`).run(now, id)
}

function nextOrderIndex(
  db: StoryDb,
  table: 'scenes' | 'shots',
  parentColumn: 'sequence_id' | 'scene_id',
  parentId: string,
): number {
  const row = db.$client
    .prepare(`SELECT MAX(order_index) AS m FROM ${table} WHERE ${parentColumn} = ?`)
    .get(parentId)
  const m = row?.['m']
  return typeof m === 'number' ? m + 1 : 0
}

async function getSequenceOrFail(db: StoryDb, id: string): Promise<Sequence> {
  const row = (await db.select().from(sequences).where(eq(sequences.id, id)))[0]
  return row ?? fail(`sequence not found: ${id}`)
}

async function getSceneOrFail(db: StoryDb, id: string): Promise<Scene> {
  const row = (await db.select().from(scenes).where(eq(scenes.id, id)))[0]
  return row ?? fail(`scene not found: ${id}`)
}

async function getShotOrFail(db: StoryDb, id: string): Promise<Shot> {
  const row = (await db.select().from(shots).where(eq(shots.id, id)))[0]
  return row ?? fail(`shot not found: ${id}`)
}

async function fetchRow(db: StoryDb, table: TableName, id: string): Promise<unknown> {
  switch (table) {
    case 'sequences':
      return (await db.select().from(sequences).where(eq(sequences.id, id)))[0] ?? null
    case 'scenes':
      return (await db.select().from(scenes).where(eq(scenes.id, id)))[0] ?? null
    case 'shots':
      return (await db.select().from(shots).where(eq(shots.id, id)))[0] ?? null
    case 'frames':
      return (await db.select().from(frames).where(eq(frames.id, id)))[0] ?? null
    case 'characters':
      return (await db.select().from(characters).where(eq(characters.id, id)))[0] ?? null
    case 'locations':
      return (await db.select().from(locations).where(eq(locations.id, id)))[0] ?? null
    case 'elements':
      return (await db.select().from(elements).where(eq(elements.id, id)))[0] ?? null
    default:
      return (await db.select().from(generations).where(eq(generations.id, id)))[0] ?? null
  }
}

interface EntityFields {
  id?: string
  name: string
  description: string
  prompt: string
  notes: string
  kind?: ElementKind
}

async function insertEntity(
  db: StoryDb,
  type: EntityType,
  sequenceId: string,
  input: EntityFields,
  now: number,
): Promise<Character | Location | Element> {
  const id = pickId(db, ENTITY_TABLE[type], ENTITY_PREFIX[type], input.name, input.id)
  const base = {
    id,
    sequenceId,
    name: input.name,
    description: input.description,
    prompt: input.prompt,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  }
  if (type === 'character') {
    return (await db.insert(characters).values(base).returning())[0] ?? fail('insert failed')
  }
  if (type === 'location') {
    return (await db.insert(locations).values(base).returning())[0] ?? fail('insert failed')
  }
  const row = { ...base, kind: input.kind ?? 'prop' }
  return (await db.insert(elements).values(row).returning())[0] ?? fail('insert failed')
}

// ---------------------------------------------------------------------------
// Full sequence tree. Same data as the UI's getSequence, but a CLI-specific
// shape: each shot's `frames` is `{start, end}` keyed by role (the UI's
// getSequence returns a Frame[] array instead).

interface ShotNode extends Shot {
  frames: { start: Frame | null; end: Frame | null }
}

interface SceneNode extends Scene {
  characterIds: string[]
  elementIds: string[]
  shots: ShotNode[]
}

interface SequenceTree {
  sequence: Sequence
  scenes: SceneNode[]
  characters: Character[]
  locations: Location[]
  elements: Element[]
  generations: Generation[]
}

async function loadSequenceTree(db: StoryDb, sequenceId: string): Promise<SequenceTree> {
  const sequence = await getSequenceOrFail(db, sequenceId)
  const sceneRows = await db
    .select()
    .from(scenes)
    .where(eq(scenes.sequenceId, sequenceId))
    .orderBy(asc(scenes.orderIndex), asc(scenes.createdAt))
  const sceneIds = sceneRows.map((s) => s.id)
  const shotRows =
    sceneIds.length > 0
      ? await db
          .select()
          .from(shots)
          .where(inArray(shots.sceneId, sceneIds))
          .orderBy(asc(shots.orderIndex), asc(shots.createdAt))
      : []
  const shotIds = shotRows.map((s) => s.id)
  const frameRows =
    shotIds.length > 0 ? await db.select().from(frames).where(inArray(frames.shotId, shotIds)) : []
  const characterRows = await db
    .select()
    .from(characters)
    .where(eq(characters.sequenceId, sequenceId))
    .orderBy(asc(characters.createdAt))
  const locationRows = await db
    .select()
    .from(locations)
    .where(eq(locations.sequenceId, sequenceId))
    .orderBy(asc(locations.createdAt))
  const elementRows = await db
    .select()
    .from(elements)
    .where(eq(elements.sequenceId, sequenceId))
    .orderBy(asc(elements.createdAt))
  const characterLinks =
    sceneIds.length > 0
      ? await db.select().from(sceneCharacters).where(inArray(sceneCharacters.sceneId, sceneIds))
      : []
  const elementLinks =
    sceneIds.length > 0
      ? await db.select().from(sceneElements).where(inArray(sceneElements.sceneId, sceneIds))
      : []

  const targetIds = new Set<string>([
    ...frameRows.map((f) => f.id),
    ...shotRows.map((s) => s.id),
    ...characterRows.map((c) => c.id),
    ...locationRows.map((l) => l.id),
    ...elementRows.map((e) => e.id),
  ])
  const generationRows = (await db.select().from(generations)).filter((g) =>
    targetIds.has(g.targetId),
  )

  return {
    sequence,
    scenes: sceneRows.map((scene) => ({
      ...scene,
      characterIds: characterLinks.filter((l) => l.sceneId === scene.id).map((l) => l.characterId),
      elementIds: elementLinks.filter((l) => l.sceneId === scene.id).map((l) => l.elementId),
      shots: shotRows
        .filter((shot) => shot.sceneId === scene.id)
        .map((shot) => ({
          ...shot,
          frames: {
            start: frameRows.find((f) => f.shotId === shot.id && f.role === 'start') ?? null,
            end: frameRows.find((f) => f.shotId === shot.id && f.role === 'end') ?? null,
          },
        })),
    })),
    characters: characterRows,
    locations: locationRows,
    elements: elementRows,
    generations: generationRows,
  }
}

// ---------------------------------------------------------------------------
// Commands

async function cmdCreateSequence(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, {
    title: { type: 'string' },
    logline: { type: 'string' },
    script: { type: 'string' },
    'script-file': { type: 'string' },
    id: { type: 'string' },
  })
  noPositionals(positionals)
  const title = reqStr(values, 'title')
  const scriptInline = optStr(values, 'script')
  const scriptFile = optStr(values, 'script-file')
  if (scriptInline !== undefined && scriptFile !== undefined) {
    fail('--script and --script-file are mutually exclusive')
  }
  const script =
    scriptFile !== undefined ? readFileSync(path.resolve(scriptFile), 'utf8') : (scriptInline ?? '')
  const db = openDb(values)
  const now = Date.now()
  const id = pickId(db, 'sequences', 'seq', title, optStr(values, 'id'))
  const row = (
    await db
      .insert(sequences)
      .values({
        id,
        title,
        logline: optStr(values, 'logline') ?? '',
        script,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]
  print(row ?? fail('insert failed'))
}

async function cmdAddScene(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, {
    sequence: { type: 'string' },
    title: { type: 'string' },
    'script-excerpt': { type: 'string' },
    'script-excerpt-file': { type: 'string' },
    synopsis: { type: 'string' },
    location: { type: 'string' },
    order: { type: 'string' },
    id: { type: 'string' },
  })
  noPositionals(positionals)
  const db = openDb(values)
  const sequenceId = reqStr(values, 'sequence')
  await getSequenceOrFail(db, sequenceId)
  const title = reqStr(values, 'title')
  const excerptInline = optStr(values, 'script-excerpt')
  const excerptFile = optStr(values, 'script-excerpt-file')
  if (excerptInline !== undefined && excerptFile !== undefined) {
    fail('--script-excerpt and --script-excerpt-file are mutually exclusive')
  }
  const scriptExcerpt =
    excerptFile !== undefined
      ? readFileSync(path.resolve(excerptFile), 'utf8')
      : (excerptInline ?? '')
  const locationId = optStr(values, 'location') ?? null
  if (locationId !== null) {
    const loc = (await db.select().from(locations).where(eq(locations.id, locationId)))[0]
    if (loc === undefined) fail(`location not found: ${locationId}`)
    if (loc.sequenceId !== sequenceId) fail(`location ${locationId} belongs to another sequence`)
  }
  const now = Date.now()
  const orderIndex =
    optInt(values, 'order') ?? nextOrderIndex(db, 'scenes', 'sequence_id', sequenceId)
  const id = pickId(
    db,
    'scenes',
    'scn',
    `${String(orderIndex + 1).padStart(2, '0')}_${title}`,
    optStr(values, 'id'),
  )
  const row = (
    await db
      .insert(scenes)
      .values({
        id,
        sequenceId,
        orderIndex,
        title,
        scriptExcerpt,
        synopsis: optStr(values, 'synopsis') ?? '',
        locationId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]
  touchSequence(db, sequenceId, now)
  print(row ?? fail('insert failed'))
}

async function cmdAddShot(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, {
    scene: { type: 'string' },
    prompt: { type: 'string' },
    description: { type: 'string' },
    camera: { type: 'string' },
    duration: { type: 'string' },
    order: { type: 'string' },
    id: { type: 'string' },
  })
  noPositionals(positionals)
  const db = openDb(values)
  const sceneId = reqStr(values, 'scene')
  const scene = await getSceneOrFail(db, sceneId)
  const prompt = reqStr(values, 'prompt')
  const now = Date.now()
  const orderIndex = optInt(values, 'order') ?? nextOrderIndex(db, 'shots', 'scene_id', sceneId)
  const id = pickId(
    db,
    'shots',
    'shot',
    `${sceneId.replace(/^scn_/, '')}_${String(orderIndex + 1)}`,
    optStr(values, 'id'),
  )
  const row = (
    await db
      .insert(shots)
      .values({
        id,
        sceneId,
        orderIndex,
        prompt,
        description: optStr(values, 'description') ?? '',
        camera: optStr(values, 'camera') ?? '',
        durationSeconds: optNum(values, 'duration') ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]
  touchRow(db, 'scenes', sceneId, now)
  touchSequence(db, scene.sequenceId, now)
  print(row ?? fail('insert failed'))
}

async function cmdSetFrame(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, {
    shot: { type: 'string' },
    role: { type: 'string' },
    prompt: { type: 'string' },
    id: { type: 'string' },
  })
  noPositionals(positionals)
  const db = openDb(values)
  const shotId = reqStr(values, 'shot')
  await getShotOrFail(db, shotId)
  const role = reqEnum(values, 'role', FRAME_ROLES)
  const prompt = reqStr(values, 'prompt')
  const now = Date.now()
  const existing = (
    await db
      .select()
      .from(frames)
      .where(and(eq(frames.shotId, shotId), eq(frames.role, role)))
  )[0]
  let row: Frame | undefined
  if (existing !== undefined) {
    row = (
      await db
        .update(frames)
        .set({ prompt, updatedAt: now })
        .where(eq(frames.id, existing.id))
        .returning()
    )[0]
  } else {
    const id = pickId(
      db,
      'frames',
      'frm',
      `${shotId.replace(/^shot_/, '')}_${role}`,
      optStr(values, 'id'),
    )
    row = (
      await db
        .insert(frames)
        .values({ id, shotId, role, prompt, createdAt: now, updatedAt: now })
        .returning()
    )[0]
  }
  touchRow(db, 'shots', shotId, now)
  touchSequence(db, sequenceIdOf(db, 'shots', shotId), now)
  print(row ?? fail('upsert failed'))
}

async function cmdAddEntity(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, {
    sequence: { type: 'string' },
    type: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    prompt: { type: 'string' },
    notes: { type: 'string' },
    kind: { type: 'string' },
    id: { type: 'string' },
  })
  noPositionals(positionals)
  const db = openDb(values)
  const sequenceId = reqStr(values, 'sequence')
  await getSequenceOrFail(db, sequenceId)
  const type = reqEnum(values, 'type', ENTITY_TYPES)
  const name = reqStr(values, 'name')
  const kindStr = optStr(values, 'kind')
  if (kindStr !== undefined && type !== 'element') fail('--kind is only valid for --type element')
  const kind =
    kindStr !== undefined
      ? (asOneOf(kindStr, ELEMENT_KINDS) ??
        fail(`--kind must be one of: ${ELEMENT_KINDS.join(', ')}`))
      : undefined
  const now = Date.now()
  const row = await insertEntity(
    db,
    type,
    sequenceId,
    {
      id: optStr(values, 'id'),
      name,
      description: optStr(values, 'description') ?? '',
      prompt: optStr(values, 'prompt') ?? '',
      notes: optStr(values, 'notes') ?? '',
      kind,
    },
    now,
  )
  touchSequence(db, sequenceId, now)
  print(row)
}

async function cmdLink(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, {
    scene: { type: 'string' },
    character: { type: 'string' },
    element: { type: 'string' },
  })
  noPositionals(positionals)
  const db = openDb(values)
  const sceneId = reqStr(values, 'scene')
  const scene = await getSceneOrFail(db, sceneId)
  const characterId = optStr(values, 'character')
  const elementId = optStr(values, 'element')
  if ((characterId === undefined) === (elementId === undefined)) {
    fail('pass exactly one of --character or --element')
  }
  const now = Date.now()
  if (characterId !== undefined) {
    const row = (await db.select().from(characters).where(eq(characters.id, characterId)))[0]
    if (row === undefined) fail(`character not found: ${characterId}`)
    if (row.sequenceId !== scene.sequenceId) {
      fail(`character ${characterId} belongs to another sequence`)
    }
    await db.insert(sceneCharacters).values({ sceneId, characterId }).onConflictDoNothing()
  } else if (elementId !== undefined) {
    const row = (await db.select().from(elements).where(eq(elements.id, elementId)))[0]
    if (row === undefined) fail(`element not found: ${elementId}`)
    if (row.sequenceId !== scene.sequenceId)
      fail(`element ${elementId} belongs to another sequence`)
    await db.insert(sceneElements).values({ sceneId, elementId }).onConflictDoNothing()
  }
  touchRow(db, 'scenes', sceneId, now)
  touchSequence(db, scene.sequenceId, now)
  print({
    linked: {
      scene: sceneId,
      ...(characterId !== undefined ? { character: characterId } : { element: elementId }),
    },
  })
}

async function cmdSetLocation(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, {
    scene: { type: 'string' },
    location: { type: 'string' },
  })
  noPositionals(positionals)
  const db = openDb(values)
  const sceneId = reqStr(values, 'scene')
  const scene = await getSceneOrFail(db, sceneId)
  const locationId = reqStr(values, 'location')
  const loc = (await db.select().from(locations).where(eq(locations.id, locationId)))[0]
  if (loc === undefined) fail(`location not found: ${locationId}`)
  if (loc.sequenceId !== scene.sequenceId)
    fail(`location ${locationId} belongs to another sequence`)
  const now = Date.now()
  const row = (
    await db
      .update(scenes)
      .set({ locationId, updatedAt: now })
      .where(eq(scenes.id, sceneId))
      .returning()
  )[0]
  touchSequence(db, scene.sequenceId, now)
  print(row ?? fail('update failed'))
}

async function cmdRecordGeneration(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, {
    'target-type': { type: 'string' },
    'target-id': { type: 'string' },
    kind: { type: 'string' },
    path: { type: 'string' },
    'request-id': { type: 'string' },
    'endpoint-id': { type: 'string' },
    params: { type: 'string' },
    select: { type: 'boolean' },
    id: { type: 'string' },
  })
  noPositionals(positionals)
  const db = openDb(values)
  const targetType = reqEnum(values, 'target-type', GENERATION_TARGET_TYPES)
  const targetId = reqStr(values, 'target-id')
  const targetTable = TARGET_TABLE[targetType]
  if (!idExists(db, targetTable, targetId)) fail(`${targetType} not found: ${targetId}`)
  const kind = reqEnum(values, 'kind', GENERATION_KINDS)
  const assetPath = reqStr(values, 'path')
  const paramsStr = optStr(values, 'params') ?? '{}'
  let paramsParsed: unknown
  try {
    paramsParsed = JSON.parse(paramsStr)
  } catch {
    fail(`--params must be valid JSON, got: ${paramsStr}`)
  }
  if (paramsParsed === null || typeof paramsParsed !== 'object' || Array.isArray(paramsParsed)) {
    fail('--params must be a JSON object')
  }
  const now = Date.now()
  const id = pickId(db, 'generations', 'gen', targetId, optStr(values, 'id'))
  const row = (
    await db
      .insert(generations)
      .values({
        id,
        targetType,
        targetId,
        kind,
        path: assetPath,
        requestId: optStr(values, 'request-id') ?? '',
        endpointId: optStr(values, 'endpoint-id') ?? '',
        params: JSON.stringify(paramsParsed),
        createdAt: now,
      })
      .returning()
  )[0]
  const selected = optBool(values, 'select')
  if (selected) {
    db.$client
      .prepare(`UPDATE ${targetTable} SET selected_generation_id = ?, updated_at = ? WHERE id = ?`)
      .run(id, now, targetId)
  } else {
    touchRow(db, targetTable, targetId, now)
  }
  touchSequence(db, sequenceIdOf(db, targetTable, targetId), now)
  print({ generation: row ?? fail('insert failed'), selected })
}

// --- update -----------------------------------------------------------------

type FieldSpec =
  | { kind: 'text' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'int' }
  | { kind: 'real-nullable' }
  | { kind: 'id-nullable' }

const TEXT: FieldSpec = { kind: 'text' }
const ID_NULLABLE: FieldSpec = { kind: 'id-nullable' }
const STATUS: FieldSpec = { kind: 'enum', values: SCENE_STATUSES }

const UPDATABLE: Partial<Record<TableName, Record<string, FieldSpec>>> = {
  sequences: { title: TEXT, logline: TEXT, script: TEXT },
  scenes: {
    title: TEXT,
    script_excerpt: TEXT,
    synopsis: TEXT,
    notes: TEXT,
    status: STATUS,
    order_index: { kind: 'int' },
    location_id: ID_NULLABLE,
  },
  shots: {
    description: TEXT,
    prompt: TEXT,
    camera: TEXT,
    notes: TEXT,
    status: STATUS,
    order_index: { kind: 'int' },
    duration_seconds: { kind: 'real-nullable' },
    selected_generation_id: ID_NULLABLE,
  },
  frames: { prompt: TEXT, notes: TEXT, selected_generation_id: ID_NULLABLE },
  characters: {
    name: TEXT,
    description: TEXT,
    prompt: TEXT,
    notes: TEXT,
    selected_generation_id: ID_NULLABLE,
  },
  locations: {
    name: TEXT,
    description: TEXT,
    prompt: TEXT,
    notes: TEXT,
    selected_generation_id: ID_NULLABLE,
  },
  elements: {
    name: TEXT,
    description: TEXT,
    prompt: TEXT,
    notes: TEXT,
    kind: { kind: 'enum', values: ELEMENT_KINDS },
    selected_generation_id: ID_NULLABLE,
  },
}

function parseFieldValue(field: string, spec: FieldSpec, raw: string): string | number | null {
  switch (spec.kind) {
    case 'text':
      return raw
    case 'enum': {
      const hit = spec.values.find((v) => v === raw)
      if (hit === undefined)
        fail(`${field} must be one of: ${spec.values.join(', ')} (got: ${raw})`)
      return hit
    }
    case 'int': {
      const n = Number(raw)
      if (!Number.isInteger(n)) fail(`${field} must be an integer, got: ${raw}`)
      return n
    }
    case 'real-nullable': {
      if (raw === 'null' || raw === '') return null
      const n = Number(raw)
      if (!Number.isFinite(n)) fail(`${field} must be a number or null, got: ${raw}`)
      return n
    }
    default:
      return raw === 'null' || raw === '' ? null : raw
  }
}

async function cmdUpdate(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, { set: { type: 'string', multiple: true } })
  const [tableArg, id, ...extra] = positionals
  if (tableArg === undefined || id === undefined)
    fail('usage: update <table> <id> --set field=value ...')
  if (extra.length > 0) fail(`unexpected arguments: ${extra.join(' ')}`)
  const table = asOneOf(tableArg, TABLE_NAMES) ?? fail(`unknown table: ${tableArg}`)
  const updatable = UPDATABLE[table] ?? fail(`table is not updatable: ${table}`)
  const sets = strList(values, 'set')
  if (sets.length === 0) fail('pass at least one --set field=value')
  const db = openDb(values)
  if (!idExists(db, table, id)) fail(`${table} row not found: ${id}`)
  const columns: string[] = []
  const params: Array<string | number | null> = []
  for (const entry of sets) {
    const idx = entry.indexOf('=')
    if (idx <= 0) fail(`--set expects field=value, got: ${entry}`)
    const field = entry.slice(0, idx)
    const raw = entry.slice(idx + 1)
    const spec =
      updatable[field] ??
      fail(
        `field not updatable on ${table}: ${field} (allowed: ${Object.keys(updatable).join(', ')})`,
      )
    const value = parseFieldValue(field, spec, raw)
    if (field === 'selected_generation_id' && typeof value === 'string') {
      assertGenerationTargetsRow(db, table, id, value)
    }
    columns.push(`${field} = ?`)
    params.push(value)
  }
  const now = Date.now()
  const sequenceId = sequenceIdOf(db, table, id)
  db.$client
    .prepare(`UPDATE ${table} SET ${columns.join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...params, now, id)
  if (table !== 'sequences') touchSequence(db, sequenceId, now)
  print(await fetchRow(db, table, id))
}

async function cmdDelete(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, {})
  const [tableArg, id, ...extra] = positionals
  if (tableArg === undefined || id === undefined) fail('usage: delete <table> <id>')
  if (extra.length > 0) fail(`unexpected arguments: ${extra.join(' ')}`)
  const table = asOneOf(tableArg, TABLE_NAMES) ?? fail(`unknown table: ${tableArg}`)
  const db = openDb(values)
  if (!idExists(db, table, id)) fail(`${table} row not found: ${id}`)
  const now = Date.now()
  const sequenceId = sequenceIdOf(db, table, id)
  db.$client.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
  if (table !== 'sequences' && sequenceId !== undefined && idExists(db, 'sequences', sequenceId)) {
    touchSequence(db, sequenceId, now)
  }
  print({ deleted: { table, id } })
}

// --- list / show ------------------------------------------------------------

async function cmdList(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, { sequence: { type: 'string' } })
  const what = positionals[0]
  if (positionals.length !== 1 || what === undefined) {
    fail('usage: list sequences|scenes|shots|entities [--sequence id]')
  }
  const db = openDb(values)
  const sequenceId = optStr(values, 'sequence')
  switch (what) {
    case 'sequences': {
      const seqRows = await db.select().from(sequences).orderBy(asc(sequences.createdAt))
      const sceneRows = await db
        .select({ id: scenes.id, sequenceId: scenes.sequenceId })
        .from(scenes)
      const shotRows = await db.select({ sceneId: shots.sceneId }).from(shots)
      const sceneSeq = new Map(sceneRows.map((s) => [s.id, s.sequenceId]))
      print(
        seqRows.map((seq) => ({
          ...seq,
          sceneCount: sceneRows.filter((s) => s.sequenceId === seq.id).length,
          shotCount: shotRows.filter((s) => sceneSeq.get(s.sceneId) === seq.id).length,
        })),
      )
      return
    }
    case 'scenes': {
      const rows =
        sequenceId !== undefined
          ? await db
              .select()
              .from(scenes)
              .where(eq(scenes.sequenceId, sequenceId))
              .orderBy(asc(scenes.orderIndex), asc(scenes.createdAt))
          : await db.select().from(scenes).orderBy(asc(scenes.sequenceId), asc(scenes.orderIndex))
      print(rows)
      return
    }
    case 'shots': {
      if (sequenceId !== undefined) {
        const rows = await db
          .select({ shot: shots })
          .from(shots)
          .innerJoin(scenes, eq(shots.sceneId, scenes.id))
          .where(eq(scenes.sequenceId, sequenceId))
          .orderBy(asc(scenes.orderIndex), asc(shots.orderIndex))
        print(rows.map((r) => r.shot))
      } else {
        print(await db.select().from(shots).orderBy(asc(shots.sceneId), asc(shots.orderIndex)))
      }
      return
    }
    case 'entities': {
      const where = sequenceId !== undefined
      print({
        characters: where
          ? await db
              .select()
              .from(characters)
              .where(eq(characters.sequenceId, sequenceId ?? ''))
          : await db.select().from(characters),
        locations: where
          ? await db
              .select()
              .from(locations)
              .where(eq(locations.sequenceId, sequenceId ?? ''))
          : await db.select().from(locations),
        elements: where
          ? await db
              .select()
              .from(elements)
              .where(eq(elements.sequenceId, sequenceId ?? ''))
          : await db.select().from(elements),
      })
      return
    }
    default:
      fail(`unknown list target: ${what} (expected sequences|scenes|shots|entities)`)
  }
}

async function cmdShow(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, {})
  const [kind, id, ...extra] = positionals
  if (kind !== 'sequence' || id === undefined || extra.length > 0) {
    fail('usage: show sequence <id>')
  }
  const db = openDb(values)
  print(await loadSequenceTree(db, id))
}

// --- import (batch, single transaction) -------------------------------------

const entityInputSchema = z.strictObject({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().default(''),
  prompt: z.string().default(''),
  notes: z.string().default(''),
})

const elementInputSchema = entityInputSchema.extend({
  kind: z.enum(ELEMENT_KINDS).default('prop'),
})

const frameInputSchema = z.union([
  z.string(),
  z.strictObject({
    id: z.string().optional(),
    prompt: z.string().default(''),
    notes: z.string().default(''),
  }),
])

const shotInputSchema = z.strictObject({
  id: z.string().optional(),
  prompt: z.string().default(''),
  description: z.string().default(''),
  camera: z.string().default(''),
  duration: z.number().optional(),
  durationSeconds: z.number().optional(),
  status: z.enum(SCENE_STATUSES).default('draft'),
  notes: z.string().default(''),
  frames: z
    .strictObject({
      start: frameInputSchema.optional(),
      end: frameInputSchema.optional(),
    })
    .default({}),
})

const sceneInputSchema = z.strictObject({
  id: z.string().optional(),
  title: z.string().min(1),
  scriptExcerpt: z.string().default(''),
  synopsis: z.string().default(''),
  location: z.string().optional(),
  status: z.enum(SCENE_STATUSES).default('draft'),
  notes: z.string().default(''),
  characters: z.array(z.union([z.string(), entityInputSchema])).default([]),
  elements: z.array(z.union([z.string(), elementInputSchema])).default([]),
  shots: z.array(shotInputSchema).default([]),
})

const batchSchema = z.strictObject({
  sequence: z.strictObject({
    id: z.string().optional(),
    title: z.string().optional(),
    logline: z.string().default(''),
    script: z.string().default(''),
    scriptFile: z.string().optional(),
  }),
  scenes: z.array(sceneInputSchema).default([]),
  characters: z.array(z.union([z.string(), entityInputSchema])).default([]),
  locations: z.array(z.union([z.string(), entityInputSchema])).default([]),
  elements: z.array(z.union([z.string(), elementInputSchema])).default([]),
})

async function cmdImport(rest: string[]): Promise<void> {
  const { values, positionals } = parseCmd(rest, { file: { type: 'string' } })
  noPositionals(positionals)
  const file = path.resolve(reqStr(values, 'file'))
  let rawJson: unknown
  try {
    rawJson = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    fail(`could not read --file as JSON: ${file}`, err instanceof Error ? err.message : String(err))
  }
  const batch = batchSchema.parse(rawJson)
  const db = openDb(values)
  const now = Date.now()
  const created = {
    sequence: false,
    scenes: 0,
    shots: 0,
    frames: 0,
    characters: 0,
    locations: 0,
    elements: 0,
    links: 0,
  }
  const COUNTER_KEY: Record<EntityType, 'characters' | 'locations' | 'elements'> = {
    character: 'characters',
    location: 'locations',
    element: 'elements',
  }

  const sequenceId = await withTransaction(db, async () => {
    // 1. Sequence: reuse when the given id exists, else create.
    let seqId: string
    if (batch.sequence.id !== undefined && idExists(db, 'sequences', batch.sequence.id)) {
      seqId = batch.sequence.id
    } else {
      const title =
        batch.sequence.title ?? fail('sequence.title is required when creating a new sequence')
      const script =
        batch.sequence.scriptFile !== undefined
          ? readFileSync(path.resolve(path.dirname(file), batch.sequence.scriptFile), 'utf8')
          : batch.sequence.script
      seqId = batch.sequence.id ?? genId(db, 'sequences', 'seq', title)
      await db.insert(sequences).values({
        id: seqId,
        title,
        logline: batch.sequence.logline,
        script,
        createdAt: now,
        updatedAt: now,
      })
      created.sequence = true
    }

    // 2. Entity resolver: names resolve case-insensitively within the
    // sequence; unknown names are created on the fly.
    const byName: Record<EntityType, Map<string, string>> = {
      character: new Map(),
      location: new Map(),
      element: new Map(),
    }
    const knownIds: Record<EntityType, Set<string>> = {
      character: new Set(),
      location: new Set(),
      element: new Set(),
    }
    const seedRows: Array<[EntityType, Array<{ id: string; name: string }>]> = [
      [
        'character',
        await db
          .select({ id: characters.id, name: characters.name })
          .from(characters)
          .where(eq(characters.sequenceId, seqId)),
      ],
      [
        'location',
        await db
          .select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(eq(locations.sequenceId, seqId)),
      ],
      [
        'element',
        await db
          .select({ id: elements.id, name: elements.name })
          .from(elements)
          .where(eq(elements.sequenceId, seqId)),
      ],
    ]
    for (const [type, rows] of seedRows) {
      for (const row of rows) {
        byName[type].set(row.name.trim().toLowerCase(), row.id)
        knownIds[type].add(row.id)
      }
    }

    async function createEntity(type: EntityType, input: EntityFields): Promise<string> {
      const row = await insertEntity(db, type, seqId, input, now)
      byName[type].set(input.name.trim().toLowerCase(), row.id)
      knownIds[type].add(row.id)
      created[COUNTER_KEY[type]] += 1
      return row.id
    }

    async function resolveEntity(type: EntityType, ref: string | EntityFields): Promise<string> {
      if (typeof ref === 'string') {
        const key = ref.trim()
        if (knownIds[type].has(key)) return key
        const hit = byName[type].get(key.toLowerCase())
        if (hit !== undefined) return hit
        return createEntity(type, { name: key, description: '', prompt: '', notes: '' })
      }
      if (ref.id !== undefined && knownIds[type].has(ref.id)) return ref.id
      const hit = byName[type].get(ref.name.trim().toLowerCase())
      if (hit !== undefined) return hit
      return createEntity(type, ref)
    }

    for (const ref of batch.characters) await resolveEntity('character', ref)
    for (const ref of batch.locations) await resolveEntity('location', ref)
    for (const ref of batch.elements) await resolveEntity('element', ref)

    // 3. Scenes → shots → frames.
    const orderBase = nextOrderIndex(db, 'scenes', 'sequence_id', seqId)
    for (const [i, sceneInput] of batch.scenes.entries()) {
      const orderIndex = orderBase + i
      const position = String(orderIndex + 1).padStart(2, '0')
      const locationId =
        sceneInput.location !== undefined
          ? await resolveEntity('location', sceneInput.location)
          : null
      if (sceneInput.id !== undefined && idExists(db, 'scenes', sceneInput.id)) {
        fail(`scene id already exists: ${sceneInput.id}`)
      }
      const sceneId = sceneInput.id ?? genId(db, 'scenes', 'scn', `${position}_${sceneInput.title}`)
      await db.insert(scenes).values({
        id: sceneId,
        sequenceId: seqId,
        orderIndex,
        title: sceneInput.title,
        scriptExcerpt: sceneInput.scriptExcerpt,
        synopsis: sceneInput.synopsis,
        locationId,
        status: sceneInput.status,
        notes: sceneInput.notes,
        createdAt: now,
        updatedAt: now,
      })
      created.scenes += 1

      for (const ref of sceneInput.characters) {
        const characterId = await resolveEntity('character', ref)
        await db.insert(sceneCharacters).values({ sceneId, characterId }).onConflictDoNothing()
        created.links += 1
      }
      for (const ref of sceneInput.elements) {
        const elementId = await resolveEntity('element', ref)
        await db.insert(sceneElements).values({ sceneId, elementId }).onConflictDoNothing()
        created.links += 1
      }

      for (const [j, shotInput] of sceneInput.shots.entries()) {
        if (shotInput.id !== undefined && idExists(db, 'shots', shotInput.id)) {
          fail(`shot id already exists: ${shotInput.id}`)
        }
        const suffix = j < 26 ? String.fromCharCode(97 + j) : String(j + 1)
        const shotId = shotInput.id ?? genId(db, 'shots', 'shot', `${position}${suffix}`)
        await db.insert(shots).values({
          id: shotId,
          sceneId,
          orderIndex: j,
          prompt: shotInput.prompt,
          description: shotInput.description,
          camera: shotInput.camera,
          durationSeconds: shotInput.durationSeconds ?? shotInput.duration ?? null,
          status: shotInput.status,
          notes: shotInput.notes,
          createdAt: now,
          updatedAt: now,
        })
        created.shots += 1

        for (const role of FRAME_ROLES) {
          const frameInput = shotInput.frames[role]
          if (frameInput === undefined) continue
          const normalized =
            typeof frameInput === 'string'
              ? { id: undefined, prompt: frameInput, notes: '' }
              : frameInput
          const frameId =
            normalized.id ?? genId(db, 'frames', 'frm', `${shotId.replace(/^shot_/, '')}_${role}`)
          await db.insert(frames).values({
            id: frameId,
            shotId,
            role,
            prompt: normalized.prompt,
            notes: normalized.notes,
            createdAt: now,
            updatedAt: now,
          })
          created.frames += 1
        }
      }
    }

    touchSequence(db, seqId, now)
    return seqId
  })

  const tree = await loadSequenceTree(db, sequenceId)
  print({ created, ...tree })
}

// ---------------------------------------------------------------------------
// Dispatch

const COMMANDS = [
  'create-sequence',
  'add-scene',
  'add-shot',
  'set-frame',
  'add-entity',
  'link',
  'set-location',
  'record-generation',
  'update',
  'delete',
  'list',
  'show',
  'import',
  'help',
] as const

function printHelp(): void {
  print({
    usage: 'story <command> [flags]',
    globalFlags: {
      '--db <path>': 'exact story DB file',
      '--project <dir>': 'use <dir>/story.db',
      default:
        'STORY_DB_PATH env if set, else $GENMEDIA_UI_PROJECT/story.db if set, else ./story.db in the cwd',
    },
    commands: {
      'create-sequence': '--title T [--logline L] [--script S|--script-file path] [--id id]',
      'add-scene':
        '--sequence <id> --title T [--script-excerpt S|--script-excerpt-file path] [--synopsis S] [--location <id>] [--order N] [--id id]',
      'add-shot':
        '--scene <id> --prompt P [--description D] [--camera C] [--duration N] [--order N] [--id id]',
      'set-frame': '--shot <id> --role start|end --prompt P (upsert) [--id id]',
      'add-entity':
        '--sequence <id> --type character|location|element --name N [--description D] [--prompt P] [--notes N] [--kind K] [--id id]',
      link: '--scene <id> --character <id> | --scene <id> --element <id>',
      'set-location': '--scene <id> --location <id>',
      'record-generation':
        '--target-type frame|shot|character|location|element --target-id Y --kind image|video|audio --path P [--request-id R] [--endpoint-id E] [--params JSON] [--select] [--id id]',
      update: 'update <table> <id> --set field=value [--set ...] (whitelisted fields)',
      delete: 'delete <table> <id>',
      list: 'list sequences|scenes|shots|entities [--sequence id]',
      show: 'show sequence <id> (full JSON tree)',
      import: 'import --file batch.json (whole breakdown, one transaction)',
    },
  })
}

async function dispatch(argv: string[]): Promise<void> {
  const [command, ...rest] = argv
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
      printHelp()
      return
    case 'create-sequence':
      return cmdCreateSequence(rest)
    case 'add-scene':
      return cmdAddScene(rest)
    case 'add-shot':
      return cmdAddShot(rest)
    case 'set-frame':
      return cmdSetFrame(rest)
    case 'add-entity':
      return cmdAddEntity(rest)
    case 'link':
      return cmdLink(rest)
    case 'set-location':
      return cmdSetLocation(rest)
    case 'record-generation':
      return cmdRecordGeneration(rest)
    case 'update':
      return cmdUpdate(rest)
    case 'delete':
      return cmdDelete(rest)
    case 'list':
      return cmdList(rest)
    case 'show':
      return cmdShow(rest)
    case 'import':
      return cmdImport(rest)
    default:
      fail(`unknown command: ${command}`, { commands: COMMANDS })
  }
}

try {
  await dispatch(process.argv.slice(2))
} catch (err) {
  let payload: Record<string, unknown>
  if (err instanceof CliError) {
    payload =
      err.details === undefined
        ? { error: err.message }
        : { error: err.message, details: err.details }
  } else if (err instanceof z.ZodError) {
    payload = { error: 'batch validation failed', issues: err.issues }
  } else {
    payload = { error: err instanceof Error ? err.message : String(err) }
  }
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exitCode = 1
}
