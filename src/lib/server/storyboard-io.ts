import { storyboardSchema, type Storyboard } from '../schemas/storyboard'
import { readJsonFile } from './fs'

// Read-for-write states of the on-disk storyboard. 'invalid' covers
// unparseable JSON (both writers rename atomically, so this means a writer
// violated that contract or an IO error — not a transient torn read) and a
// doc that fails our schema (e.g. a newer schema version written by the
// Claude agent) — in either case we must NOT write over state we can't verify.
export type StoryboardOnDisk =
  | { kind: 'ok'; doc: Storyboard }
  | { kind: 'missing' }
  | { kind: 'invalid' }

export async function readStoryboardOnDisk(path: string): Promise<StoryboardOnDisk> {
  let raw: unknown
  try {
    raw = await readJsonFile(path)
  } catch {
    return { kind: 'invalid' }
  }
  if (raw === null) return { kind: 'missing' }
  const parsed = storyboardSchema.safeParse(raw)
  return parsed.success ? { kind: 'ok', doc: parsed.data } : { kind: 'invalid' }
}

// Optimistic-concurrency check: the client says which updated_at its transform
// was based on (null = "no storyboard existed").
// - 'conflict': a concurrent writer got there first — retryable (re-read,
//   re-apply, retry).
// - 'unreadable': the on-disk doc can't be verified (durably corrupt or a
//   schema we don't know). Both writers rename atomically, so this is NOT a
//   transient torn read — retrying can't help; surface it instead.
export type WriteVerdict = 'ok' | 'conflict' | 'unreadable'

export function writeVerdict(
  onDisk: StoryboardOnDisk,
  expectedUpdatedAt: number | null,
): WriteVerdict {
  // A vanished file isn't worth failing over — recreating it loses nothing.
  if (onDisk.kind === 'missing') return 'ok'
  if (onDisk.kind === 'invalid') return 'unreadable'
  return onDisk.doc.updated_at === expectedUpdatedAt ? 'ok' : 'conflict'
}
