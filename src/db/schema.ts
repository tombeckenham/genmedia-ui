/**
 * Drizzle table definitions for the story database.
 *
 * Structurally in sync with the canonical DDL in `src/db/schema.sql` (the
 * migration actually applied to the database lives in `src/db/ddl.ts`).
 */
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'

export const SCENE_STATUSES = ['draft', 'ready', 'generating', 'review', 'done'] as const
export type SceneStatus = (typeof SCENE_STATUSES)[number]

export const ELEMENT_KINDS = ['prop', 'vehicle', 'creature', 'effect', 'other'] as const
export type ElementKind = (typeof ELEMENT_KINDS)[number]

export const GENERATION_TARGET_TYPES = [
  'frame',
  'shot',
  'character',
  'location',
  'element',
] as const
export type GenerationTargetType = (typeof GENERATION_TARGET_TYPES)[number]

export const GENERATION_KINDS = ['image', 'video', 'audio'] as const
export type GenerationKind = (typeof GENERATION_KINDS)[number]

export const FRAME_ROLES = ['start', 'end'] as const
export type FrameRole = (typeof FRAME_ROLES)[number]

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const sequences = sqliteTable('sequences', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  logline: text('logline').notNull().default(''),
  script: text('script').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const generations = sqliteTable(
  'generations',
  {
    id: text('id').primaryKey(),
    targetType: text('target_type', { enum: GENERATION_TARGET_TYPES }).notNull(),
    targetId: text('target_id').notNull(),
    requestId: text('request_id').notNull().default(''),
    endpointId: text('endpoint_id').notNull().default(''),
    kind: text('kind', { enum: GENERATION_KINDS }).notNull(),
    path: text('path').notNull(),
    params: text('params').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('generations_target_idx').on(t.targetType, t.targetId),
    check(
      'generations_target_type_check',
      sql`${t.targetType} IN ('frame', 'shot', 'character', 'location', 'element')`,
    ),
    check('generations_kind_check', sql`${t.kind} IN ('image', 'video', 'audio')`),
  ],
)

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  sequenceId: text('sequence_id')
    .notNull()
    .references(() => sequences.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  prompt: text('prompt').notNull().default(''),
  notes: text('notes').notNull().default(''),
  selectedGenerationId: text('selected_generation_id').references(() => generations.id, {
    onDelete: 'set null',
  }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(),
  sequenceId: text('sequence_id')
    .notNull()
    .references(() => sequences.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  prompt: text('prompt').notNull().default(''),
  notes: text('notes').notNull().default(''),
  selectedGenerationId: text('selected_generation_id').references(() => generations.id, {
    onDelete: 'set null',
  }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const elements = sqliteTable('elements', {
  id: text('id').primaryKey(),
  sequenceId: text('sequence_id')
    .notNull()
    .references(() => sequences.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  prompt: text('prompt').notNull().default(''),
  notes: text('notes').notNull().default(''),
  kind: text('kind', { enum: ELEMENT_KINDS }).notNull().default('prop'),
  selectedGenerationId: text('selected_generation_id').references(() => generations.id, {
    onDelete: 'set null',
  }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const scenes = sqliteTable('scenes', {
  id: text('id').primaryKey(),
  sequenceId: text('sequence_id')
    .notNull()
    .references(() => sequences.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').notNull(),
  title: text('title').notNull(),
  scriptExcerpt: text('script_excerpt').notNull().default(''),
  synopsis: text('synopsis').notNull().default(''),
  locationId: text('location_id').references(() => locations.id, { onDelete: 'set null' }),
  status: text('status', { enum: SCENE_STATUSES }).notNull().default('draft'),
  notes: text('notes').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const shots = sqliteTable('shots', {
  id: text('id').primaryKey(),
  sceneId: text('scene_id')
    .notNull()
    .references(() => scenes.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').notNull(),
  description: text('description').notNull().default(''),
  prompt: text('prompt').notNull().default(''),
  camera: text('camera').notNull().default(''),
  durationSeconds: real('duration_seconds'),
  status: text('status', { enum: SCENE_STATUSES }).notNull().default('draft'),
  notes: text('notes').notNull().default(''),
  selectedGenerationId: text('selected_generation_id').references(() => generations.id, {
    onDelete: 'set null',
  }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const frames = sqliteTable(
  'frames',
  {
    id: text('id').primaryKey(),
    shotId: text('shot_id')
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
    role: text('role', { enum: FRAME_ROLES }).notNull(),
    prompt: text('prompt').notNull().default(''),
    notes: text('notes').notNull().default(''),
    selectedGenerationId: text('selected_generation_id').references(() => generations.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    unique('frames_shot_id_role_unique').on(t.shotId, t.role),
    check('frames_role_check', sql`${t.role} IN ('start', 'end')`),
  ],
)

export const sceneCharacters = sqliteTable(
  'scene_characters',
  {
    sceneId: text('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    characterId: text('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.sceneId, t.characterId] })],
)

export const sceneElements = sqliteTable(
  'scene_elements',
  {
    sceneId: text('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    elementId: text('element_id')
      .notNull()
      .references(() => elements.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.sceneId, t.elementId] })],
)

export type Meta = typeof meta.$inferSelect
export type Sequence = typeof sequences.$inferSelect
export type NewSequence = typeof sequences.$inferInsert
export type Scene = typeof scenes.$inferSelect
export type NewScene = typeof scenes.$inferInsert
export type Shot = typeof shots.$inferSelect
export type NewShot = typeof shots.$inferInsert
export type Frame = typeof frames.$inferSelect
export type NewFrame = typeof frames.$inferInsert
export type Character = typeof characters.$inferSelect
export type NewCharacter = typeof characters.$inferInsert
export type Location = typeof locations.$inferSelect
export type NewLocation = typeof locations.$inferInsert
export type Element = typeof elements.$inferSelect
export type NewElement = typeof elements.$inferInsert
export type SceneCharacter = typeof sceneCharacters.$inferSelect
export type SceneElement = typeof sceneElements.$inferSelect
export type Generation = typeof generations.$inferSelect
export type NewGeneration = typeof generations.$inferInsert
