import { z } from 'zod'
import { assetKindSchema } from './gallery'

// storyboard.json v1 — see docs/PLAN.md "draft schema" section (source of
// truth). Shared with the Claude Code agent via the companion skill; evolve
// additively and bump schema_version only on breaking changes.

export const sceneStatusSchema = z.enum(['draft', 'queued', 'generating', 'ready', 'needs-review'])
export type SceneStatus = z.infer<typeof sceneStatusSchema>

export const takeSchema = z.object({
  request_id: z.string(),
  endpoint_id: z.string(),
  // Relative to the project dir (e.g. takes/scene-01/req_abc.mp4).
  path: z.string(),
  kind: assetKindSchema,
})
export type Take = z.infer<typeof takeSchema>

export const pendingJobSchema = z.object({
  request_id: z.string(),
  endpoint_id: z.string(),
})
export type PendingJob = z.infer<typeof pendingJobSchema>

export const sceneSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  prompt: z.string(),
  status: sceneStatusSchema.default('draft'),
  notes: z.string().default(''),
  selected_take: z.string().nullable().default(null),
  starred: z.array(z.string()).default([]),
  takes: z.array(takeSchema).default([]),
  pending: z.array(pendingJobSchema).default([]),
})
export type Scene = z.infer<typeof sceneSchema>

// UI → Claude direction queue entry. Claude drains these (see Phase 6 skill).
export const directionRequestSchema = z.object({
  id: z.string(),
  type: z.string(),
  scene_id: z.string().optional(),
  note: z.string().optional(),
  created_at: z.number(),
})
export type DirectionRequest = z.infer<typeof directionRequestSchema>

export const storyboardSchema = z.object({
  schema_version: z.literal(1),
  title: z.string(),
  updated_at: z.number(),
  scenes: z.array(sceneSchema),
  requests: z.array(directionRequestSchema).default([]),
})
export type Storyboard = z.infer<typeof storyboardSchema>

export function emptyStoryboard(title: string): Storyboard {
  return {
    schema_version: 1,
    title,
    updated_at: Date.now(),
    scenes: [],
    requests: [],
  }
}
