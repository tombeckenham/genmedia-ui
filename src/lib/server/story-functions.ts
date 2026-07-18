/**
 * Server functions for the story engine (sequences → scenes → shots → frames,
 * plus characters/locations/elements and generations). Thin zod-validated
 * wrappers over `story-queries.ts`; all of them operate on the CURRENT
 * project's DB (`<projectDir()>/story.db`, `STORY_DB_PATH` override honored).
 *
 * Contract notes:
 * - Reads return plain JSON trees (no Dates; nullable columns are `null`).
 * - Mutations return the updated row, or `null` when the target does not
 *   exist (or a referenced row is invalid, e.g. selecting a generation that
 *   belongs to a different target).
 * - Every mutation bumps `updated_at` on the row and on the owning sequence.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  ELEMENT_KINDS,
  FRAME_ROLES,
  GENERATION_TARGET_TYPES,
  SCENE_STATUSES,
  type Frame,
  type Scene,
  type Sequence,
  type Shot,
} from '../../db'
import {
  createSceneRow,
  createSequenceRow,
  createShotRow,
  deleteSceneRow,
  deleteShotRow,
  getSequenceTree,
  linkSceneEntityRow,
  listSequenceSummaries,
  reorderSceneRows,
  reorderShotRows,
  selectGenerationRow,
  storyDb,
  unlinkSceneEntityRow,
  updateEntityRow,
  updateSceneRow,
  updateSequenceRow,
  updateShotRow,
  upsertFrameRow,
  type EntityRow,
  type SequenceSummary,
  type SequenceTree,
  type TargetRow,
} from './story-queries'

const idSchema = z.string().min(1).max(200)

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const listSequences = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SequenceSummary[]> => listSequenceSummaries(storyDb()),
)

export const getSequence = createServerFn({ method: 'GET' })
  .validator(z.object({ id: idSchema }))
  .handler(async ({ data }): Promise<SequenceTree | null> => getSequenceTree(storyDb(), data.id))

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

export const createSequence = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: idSchema.optional(),
      title: z.string().min(1),
      logline: z.string().optional(),
      script: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<Sequence> => createSequenceRow(storyDb(), data))

const sequencePatchSchema = z.object({
  title: z.string().min(1).optional(),
  logline: z.string().optional(),
  script: z.string().optional(),
})

export const updateSequence = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema, patch: sequencePatchSchema }))
  .handler(
    async ({ data }): Promise<Sequence | null> => updateSequenceRow(storyDb(), data.id, data.patch),
  )

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export const createScene = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: idSchema.optional(),
      sequenceId: idSchema,
      title: z.string().min(1),
      scriptExcerpt: z.string().optional(),
      synopsis: z.string().optional(),
      locationId: idSchema.optional(),
      status: z.enum(SCENE_STATUSES).optional(),
      notes: z.string().optional(),
      orderIndex: z.number().int().optional(),
    }),
  )
  .handler(async ({ data }): Promise<Scene | null> => createSceneRow(storyDb(), data))

const scenePatchSchema = z.object({
  title: z.string().min(1).optional(),
  scriptExcerpt: z.string().optional(),
  synopsis: z.string().optional(),
  locationId: idSchema.nullable().optional(),
  status: z.enum(SCENE_STATUSES).optional(),
  notes: z.string().optional(),
  orderIndex: z.number().int().optional(),
})

export const updateScene = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema, patch: scenePatchSchema }))
  .handler(
    async ({ data }): Promise<Scene | null> => updateSceneRow(storyDb(), data.id, data.patch),
  )

export const deleteScene = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema }))
  .handler(
    async ({ data }): Promise<{ deleted: boolean }> => ({
      deleted: deleteSceneRow(storyDb(), data.id),
    }),
  )

export const reorderScenes = createServerFn({ method: 'POST' })
  .validator(z.object({ sequenceId: idSchema, ids: z.array(idSchema).min(1) }))
  .handler(
    async ({ data }): Promise<Scene[] | null> =>
      reorderSceneRows(storyDb(), data.sequenceId, data.ids),
  )

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

export const createShot = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: idSchema.optional(),
      sceneId: idSchema,
      description: z.string().optional(),
      prompt: z.string().optional(),
      camera: z.string().optional(),
      durationSeconds: z.number().nonnegative().nullable().optional(),
      status: z.enum(SCENE_STATUSES).optional(),
      notes: z.string().optional(),
      orderIndex: z.number().int().optional(),
    }),
  )
  .handler(async ({ data }): Promise<Shot | null> => createShotRow(storyDb(), data))

const shotPatchSchema = z.object({
  description: z.string().optional(),
  prompt: z.string().optional(),
  camera: z.string().optional(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  status: z.enum(SCENE_STATUSES).optional(),
  notes: z.string().optional(),
  orderIndex: z.number().int().optional(),
})

export const updateShot = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema, patch: shotPatchSchema }))
  .handler(async ({ data }): Promise<Shot | null> => updateShotRow(storyDb(), data.id, data.patch))

export const deleteShot = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema }))
  .handler(
    async ({ data }): Promise<{ deleted: boolean }> => ({
      deleted: deleteShotRow(storyDb(), data.id),
    }),
  )

export const reorderShots = createServerFn({ method: 'POST' })
  .validator(z.object({ sceneId: idSchema, ids: z.array(idSchema).min(1) }))
  .handler(
    async ({ data }): Promise<Shot[] | null> => reorderShotRows(storyDb(), data.sceneId, data.ids),
  )

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export const upsertFrame = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      shotId: idSchema,
      role: z.enum(FRAME_ROLES),
      prompt: z.string().optional(),
      notes: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<Frame | null> => upsertFrameRow(storyDb(), data))

// ---------------------------------------------------------------------------
// Entities (characters / locations / elements)
// ---------------------------------------------------------------------------

const entityPatchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
  notes: z.string().optional(),
  kind: z.enum(ELEMENT_KINDS).optional(),
})

export const updateEntity = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      type: z.enum(['character', 'location', 'element']),
      id: idSchema,
      patch: entityPatchSchema,
    }),
  )
  .handler(
    async ({ data }): Promise<EntityRow | null> =>
      updateEntityRow(storyDb(), data.type, data.id, data.patch),
  )

const sceneEntityLinkSchema = z.object({
  sceneId: idSchema,
  entityType: z.enum(['character', 'element']),
  entityId: idSchema,
})

export const linkSceneEntity = createServerFn({ method: 'POST' })
  .validator(sceneEntityLinkSchema)
  .handler(async ({ data }): Promise<Scene | null> => linkSceneEntityRow(storyDb(), data))

export const unlinkSceneEntity = createServerFn({ method: 'POST' })
  .validator(sceneEntityLinkSchema)
  .handler(async ({ data }): Promise<Scene | null> => unlinkSceneEntityRow(storyDb(), data))

// ---------------------------------------------------------------------------
// Generations
// ---------------------------------------------------------------------------

export const selectGeneration = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      targetType: z.enum(GENERATION_TARGET_TYPES),
      targetId: idSchema,
      generationId: idSchema.nullable(),
    }),
  )
  .handler(async ({ data }): Promise<TargetRow | null> => selectGenerationRow(storyDb(), data))
