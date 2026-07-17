import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { activeSessionQuery, sessionQuery, storyboardQuery } from '#/lib/queries'
import { useLiveEvents } from '#/lib/use-live-events'

export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    const [, activeId] = await Promise.all([
      context.queryClient.ensureQueryData(storyboardQuery),
      context.queryClient.ensureQueryData(activeSessionQuery),
    ])
    if (activeId !== null) {
      await context.queryClient.ensureQueryData(sessionQuery(activeId))
    }
  },
  component: DebugPage,
})

function DebugPage() {
  useLiveEvents()

  const { data: activeId } = useSuspenseQuery(activeSessionQuery)
  const { data: storyboard } = useSuspenseQuery(storyboardQuery)
  const sessionResult = useQuery({
    ...sessionQuery(activeId ?? ''),
    enabled: activeId !== null,
  })
  const session = activeId !== null ? sessionResult.data : null

  return (
    <div className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
      <h1 className="text-2xl font-semibold">genmedia-ui · Phase 1 debug</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Active session: <span className="font-mono">{activeId ?? '(none)'}</span>
      </p>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-medium">Active session</h2>
        {activeId === null ? (
          <p className="text-sm text-amber-400">No active session found in ~/.genmedia/gallery.</p>
        ) : sessionResult.isPending ? (
          <p className="text-sm text-zinc-400">Loading session {activeId}…</p>
        ) : session == null ? (
          <p className="text-sm text-amber-400">Session {activeId} could not be read.</p>
        ) : (
          <pre className="overflow-auto rounded-md bg-zinc-900 p-4 text-xs">
            {JSON.stringify(session, null, 2)}
          </pre>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-medium">storyboard.json</h2>
        {storyboard === null ? (
          <p className="text-sm text-amber-400">No storyboard.json in the project dir yet.</p>
        ) : (
          <pre className="overflow-auto rounded-md bg-zinc-900 p-4 text-xs">
            {JSON.stringify(storyboard, null, 2)}
          </pre>
        )}
      </section>
    </div>
  )
}
