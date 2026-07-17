import { z } from 'zod'

// Mirrors genmedia-cli src/lib/gallery-template.ts. The CLI owns these files;
// we only ever parse them. Unknown extra keys are stripped, not rejected, so
// additive CLI changes don't break us.

export const assetKindSchema = z.enum(['image', 'video', 'audio', 'model', 'other'])
export type AssetKind = z.infer<typeof assetKindSchema>

export const galleryFileSchema = z.object({
  path: z.string().nullable(),
  url: z.string(),
  size_bytes: z.number().nullable(),
  kind: assetKindSchema,
  json_path: z.string(),
})
export type GalleryFile = z.infer<typeof galleryFileSchema>

export const runRecordSchema = z.object({
  ts: z.number(),
  request_id: z.string(),
  endpoint_id: z.string(),
  modality: z.string().nullable(),
  prompt: z.string().nullable(),
  duration_ms: z.number().nullable(),
  files: z.array(galleryFileSchema),
})
export type RunRecord = z.infer<typeof runRecordSchema>

export const sessionPayloadSchema = z.object({
  schema_version: z.literal(1),
  session_id: z.string(),
  session_source: z.string(),
  agent: z.string().nullable(),
  agent_host: z.string().nullable(),
  cwd: z.string().nullable(),
  started_at: z.number(),
  updated_at: z.number(),
  label: z.string().optional(),
  runs: z.array(runRecordSchema),
})
export type SessionPayload = z.infer<typeof sessionPayloadSchema>

// ~/.genmedia/gallery/last-session.json — pointer to the active session.
export const lastSessionPointerSchema = z.object({
  session_id: z.string().min(1),
  anchor: z.string(),
  agent: z.string().nullable(),
  agent_host: z.string().nullable(),
  source: z.string(),
  updated_at: z.number(),
})
export type LastSessionPointer = z.infer<typeof lastSessionPointerSchema>

// Derived by us when listing sessions (not a CLI file format).
export interface SessionSummary {
  session_id: string
  label: string | null
  agent: string | null
  started_at: number
  updated_at: number
  run_count: number
  asset_count: number
}
