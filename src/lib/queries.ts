import { queryOptions } from '@tanstack/react-query'
import {
  getActiveSessionId,
  getSession,
  getStoryboard,
  listSessions,
  pollJob,
} from './server/functions'

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

// Polls the genmedia CLI for a single in-flight job. Callers own the polling
// cadence (refetchInterval) and when to stop — the shape here is just the fetch.
export function jobQuery(endpointId: string, requestId: string) {
  return queryOptions({
    queryKey: ['job', endpointId, requestId],
    queryFn: () => pollJob({ data: { endpointId, requestId } }),
  })
}
