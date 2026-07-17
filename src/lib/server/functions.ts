import { createServerFn } from '@tanstack/react-start'
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { z } from 'zod'
import {
  lastSessionPointerSchema,
  sessionPayloadSchema,
  type SessionSummary,
} from '../schemas/gallery'
import { storyboardSchema, type Storyboard } from '../schemas/storyboard'
import { readJsonFile, atomicWriteJson } from './fs'
import {
  isSafeSessionId,
  lastSessionPath,
  sessionDataPath,
  sessionsDir,
  storyboardPath,
} from './paths'

const execFileAsync = promisify(execFile)

// The genmedia CLI emits arbitrary JSON; model it as a JSON value so the
// server-fn serializer accepts the return type (plain `unknown` is rejected).
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

// endpointId is passed to the genmedia CLI as an argv element; keep it to the
// shape of a real fal endpoint slug so it can never smuggle flags/paths.
const ENDPOINT_ID_RE = /^[A-Za-z0-9/][A-Za-z0-9/._-]*$/
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

// Scan the sessions dir into summaries, newest first. Unreadable or
// schema-invalid sessions are skipped rather than throwing — a single corrupt
// data.json must not take down the whole listing.
async function scanSessions(): Promise<SessionSummary[]> {
  let entries
  try {
    entries = await readdir(sessionsDir(), { withFileTypes: true })
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return []
    throw err
  }

  const summaries: SessionSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const sessionId = entry.name
    if (!isSafeSessionId(sessionId)) continue

    let raw: unknown
    try {
      raw = await readJsonFile(sessionDataPath(sessionId))
    } catch {
      continue
    }
    const parsed = sessionPayloadSchema.safeParse(raw)
    if (!parsed.success) continue

    const payload = parsed.data
    summaries.push({
      session_id: payload.session_id,
      label: payload.label ?? null,
      agent: payload.agent,
      started_at: payload.started_at,
      updated_at: payload.updated_at,
      run_count: payload.runs.length,
      asset_count: payload.runs.reduce((sum, run) => sum + run.files.length, 0),
    })
  }

  summaries.sort((a, b) => b.updated_at - a.updated_at)
  return summaries
}

export const listSessions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionSummary[]> => {
    return scanSessions()
  },
)

export const getActiveSessionId = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string | null> => {
    const parsed = lastSessionPointerSchema.safeParse(await readJsonFile(lastSessionPath()))
    if (parsed.success) return parsed.data.session_id

    // No (or invalid) pointer — fall back to the most recently updated session.
    const sessions = await scanSessions()
    return sessions[0]?.session_id ?? null
  },
)

export const getSession = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<z.infer<typeof sessionPayloadSchema> | null> => {
    if (!isSafeSessionId(data.id)) return null
    // The CLI rewrites data.json non-atomically; a torn read can make
    // JSON.parse throw. Treat that the same as unreadable — SSE will trigger
    // a refetch once the write settles.
    let raw: unknown
    try {
      raw = await readJsonFile(sessionDataPath(data.id))
    } catch {
      return null
    }
    const parsed = sessionPayloadSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  })

export const getStoryboard = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Storyboard | null> => {
    const parsed = storyboardSchema.safeParse(await readJsonFile(storyboardPath()))
    return parsed.success ? parsed.data : null
  },
)

export const updateStoryboard = createServerFn({ method: 'POST' })
  .validator(storyboardSchema)
  .handler(async ({ data }): Promise<Storyboard> => {
    // v1: whole-document write. Patch/merge semantics land in a later phase.
    const doc: Storyboard = { ...data, updated_at: Date.now() }
    await atomicWriteJson(storyboardPath(), doc)
    return doc
  })

export const getModelSchema = createServerFn({ method: 'GET' })
  .validator(z.object({ endpointId: z.string() }))
  .handler(async ({ data }): Promise<JsonValue> => {
    if (!ENDPOINT_ID_RE.test(data.endpointId)) {
      throw new Error(`Invalid endpoint id: ${data.endpointId}`)
    }
    const { stdout } = await execFileAsync('genmedia', ['schema', data.endpointId, '--json'])
    return jsonValueSchema.parse(JSON.parse(stdout))
  })

export const pollJob = createServerFn({ method: 'GET' })
  .validator(z.object({ endpointId: z.string(), requestId: z.string() }))
  .handler(async ({ data }): Promise<JsonValue> => {
    if (!ENDPOINT_ID_RE.test(data.endpointId)) {
      throw new Error(`Invalid endpoint id: ${data.endpointId}`)
    }
    if (!REQUEST_ID_RE.test(data.requestId)) {
      throw new Error(`Invalid request id: ${data.requestId}`)
    }
    try {
      const { stdout } = await execFileAsync('genmedia', [
        'status',
        data.endpointId,
        data.requestId,
        '--json',
      ])
      return jsonValueSchema.parse(JSON.parse(stdout))
    } catch (err) {
      // On a non-zero exit genmedia prints a JSON error object ({ error: ... })
      // to stderr; surface it as the result instead of throwing.
      if (err && typeof err === 'object' && 'stderr' in err) {
        const stderr = err.stderr
        if (typeof stderr === 'string' && stderr.trim() !== '') {
          try {
            return jsonValueSchema.parse(JSON.parse(stderr))
          } catch {
            // stderr wasn't JSON — fall through to rethrow the original error.
          }
        }
      }
      throw err
    }
  })
