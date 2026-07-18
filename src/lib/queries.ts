import { queryOptions } from '@tanstack/react-query'
import {
  getActiveSessionId,
  getProjectInfo,
  getSession,
  getStoryboard,
  listSessions,
  pollJob,
} from './server/functions'
import { getSequence, listSequences } from './server/story-functions'

// TanStack Query wrappers around the Phase 1 server functions. Keys are kept
// flat and stable so useLiveEvents can invalidate them by prefix.

export const sessionsQuery = queryOptions({
  queryKey: ['sessions'],
  queryFn: () => listSessions(),
})

export const activeSessionQuery = queryOptions({
  queryKey: ['active-session'],
  queryFn: () => getActiveSessionId(),
})

export function sessionQuery(id: string) {
  return queryOptions({
    queryKey: ['session', id],
    queryFn: () => getSession({ data: { id } }),
  })
}

export const storyboardQuery = queryOptions({
  queryKey: ['storyboard'],
  queryFn: () => getStoryboard(),
})

// The project dir never changes for a server's lifetime — cache indefinitely.
export const projectInfoQuery = queryOptions({
  queryKey: ['project-info'],
  queryFn: () => getProjectInfo(),
  staleTime: Infinity,
})

// Story engine (SQLite-backed sequences → scenes → shots → frames). Keys are
// prefixed 'story-' so the story SSE scope can invalidate them independently of
// the legacy gallery/storyboard keys.

export const storySequencesQuery = queryOptions({
  queryKey: ['story-sequences'],
  queryFn: () => listSequences(),
})

export function storySequenceQuery(id: string) {
  return queryOptions({
    queryKey: ['story-sequence', id],
    queryFn: () => getSequence({ data: { id } }),
  })
}

// Polls the genmedia CLI for a single in-flight job. Callers own the polling
// cadence (refetchInterval) and when to stop — the shape here is just the fetch.
export function jobQuery(endpointId: string, requestId: string) {
  return queryOptions({
    queryKey: ['job', endpointId, requestId],
    queryFn: () => pollJob({ data: { endpointId, requestId } }),
  })
}
