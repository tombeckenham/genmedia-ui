import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { PendingJobs } from '#/components/feed/pending-jobs'
import { RunsFeed } from '#/components/feed/runs-feed'
import { SessionPicker } from '#/components/feed/session-picker'
import { activeSessionQuery, sessionQuery, sessionsQuery, storyboardQuery } from '#/lib/queries'
import { useLiveEvents } from '#/lib/use-live-events'

const searchSchema = z.object({
  session: z.string().optional(),
})

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ session: search.session }),
  loader: async ({ context, deps }) => {
    const [, activeId] = await Promise.all([
      context.queryClient.ensureQueryData(sessionsQuery),
      context.queryClient.ensureQueryData(activeSessionQuery),
      context.queryClient.ensureQueryData(storyboardQuery),
    ])
    const selected = deps.session ?? activeId ?? undefined
    if (selected !== undefined) {
      await context.queryClient.ensureQueryData(sessionQuery(selected))
    }
  },
  component: MissionControl,
})

function MissionControl() {
  useLiveEvents()
  const navigate = useNavigate({ from: Route.fullPath })

  const { session: sessionParam } = Route.useSearch()
  const { data: sessions } = useSuspenseQuery(sessionsQuery)
  const { data: activeId } = useSuspenseQuery(activeSessionQuery)
  const { data: storyboard } = useSuspenseQuery(storyboardQuery)

  const selectedId = sessionParam ?? activeId ?? sessions[0]?.session_id ?? null

  const sessionResult = useQuery({
    ...sessionQuery(selectedId ?? ''),
    enabled: selectedId !== null,
  })
  const session = selectedId !== null ? sessionResult.data : null
  const runs = session?.runs ?? []
  const completedRequestIds = new Set(runs.map((run) => run.request_id))

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Mission Control</h1>
            <p className="text-sm text-zinc-500">
              {storyboard?.title ?? 'Live generation activity'}
            </p>
          </div>
          <SessionPicker
            sessions={sessions}
            selectedId={selectedId}
            onSelect={(id) => {
              void navigate({ search: { session: id } })
            }}
          />
        </header>

        <PendingJobs storyboard={storyboard} completedRequestIds={completedRequestIds} />

        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Runs</h2>
          {selectedId === null ? (
            <p className="rounded-lg border border-dashed border-zinc-800 p-6 text-sm text-zinc-500">
              No sessions found in the gallery yet.
            </p>
          ) : (
            <RunsFeed runs={runs} />
          )}
        </section>
      </div>
    </div>
  )
}
