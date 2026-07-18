import { z } from 'zod'
import { assetKindSchema } from './gallery'

// storyboard.json v1 — see docs/PLAN.md "draft schema" section (source of
// truth). Shared with the Claude Code agent via the companion skill; evolve
// additively and bump schema_version only on breaking changes.

export const sceneStatusSchema = z.enum(['draft', 'queued', 'generating', 'ready', 'needs-review'])
export type SceneStatus = z.infer<typeof sceneStatusSchema>

// Arbitrary JSON, modelled explicitly (not `unknown`) so the storyboard stays
// serializable across the TanStack Start server-fn boundary — a bare `unknown`
// value is rejected by the RPC serializer.
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

export const takeSchema = z.object({
  request_id: z.string(),
  endpoint_id: z.string(),
  // Relative to the project dir (e.g. takes/scene-01/req_abc.mp4).
  path: z.string(),
  kind: assetKindSchema,
  // Reproducibility metadata Claude records (seed, key params, exact prompt).
  // The gallery data.json lacks these, so the skill stashes them here. The UI
  // preserves this field across writes but never reads it. Typed as JSON (not
  // `unknown`) to stay serializable over the server-fn boundary.
  params: z.record(z.string(), jsonValueSchema).optional(),
})
export type Take = z.infer<typeof takeSchema>

export const pendingJobSchema = z.object({
  request_id: z.string(),
  endpoint_id: z.string(),
})
export type PendingJob = z.infer<typeof pendingJobSchema>

export const sceneSchema = z.object({
  // Lowercase slug; used raw in download paths (takes/<id>/…) so it must not be
  // able to escape the takes dir. Matches the CLI's scene-id convention.
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
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

// UI → Claude direction queue entry. Claude drains these and removes handled
// entries (see the storyboard skill). `type` is intentionally an open string so
// the vocabulary can grow additively without a schema bump. Known types today:
//   - 'regenerate' (REGENERATE): re-generate scene_id, folding in note.
// Unknown types are handled best-effort by the agent, never rejected here.
export const REGENERATE = 'regenerate'

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
