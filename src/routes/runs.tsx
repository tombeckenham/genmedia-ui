import { DndContext } from '@dnd-kit/core'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Clapperboard, Radio } from 'lucide-react'
import { z } from 'zod'
import { EmptyState } from '#/components/ui/empty-state'
import { PendingJobs } from '#/components/feed/pending-jobs'
import { RunsFeed } from '#/components/feed/runs-feed'
import { SessionPicker } from '#/components/feed/session-picker'
import {
  activeSessionQuery,
  projectInfoQuery,
  sessionQuery,
  sessionsQuery,
  storyboardQuery,
} from '#/lib/queries'
import { useLiveEvents } from '#/lib/use-live-events'

const searchSchema = z.object({
  session: z.string().optional(),
})

export const Route = createFileRoute('/runs')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ session: search.session }),
  loader: async ({ context, deps }) => {
    const [, activeId] = await Promise.all([
      context.queryClient.ensureQueryData(sessionsQuery),
      context.queryClient.ensureQueryData(activeSessionQuery),
      context.queryClient.ensureQueryData(storyboardQuery),
      context.queryClient.ensureQueryData(projectInfoQuery),
    ])
    const selected = deps.session ?? activeId ?? undefined
    if (selected !== undefined) {
      await context.queryClient.ensureQueryData(sessionQuery(selected))
    }
  },
  component: RunsPage,
})

function RunsPage() {
  useLiveEvents()
  const navigate = useNavigate({ from: Route.fullPath })

  const { session: sessionParam } = Route.useSearch()
  const { data: sessions } = useSuspenseQuery(sessionsQuery)
  const { data: activeId } = useSuspenseQuery(activeSessionQuery)
  const { data: storyboard } = useSuspenseQuery(storyboardQuery)
  const { data: projectInfo } = useSuspenseQuery(projectInfoQuery)

  const selectedId = sessionParam ?? activeId ?? sessions[0]?.session_id ?? null

  const sessionResult = useQuery({
    ...sessionQuery(selectedId ?? ''),
    enabled: selectedId !== null,
  })
  const session = selectedId !== null ? sessionResult.data : null
  const runs = session?.runs ?? []
  const completedRequestIds = new Set(runs.map((run) => run.request_id))
  const sceneIds = (storyboard?.scenes ?? []).map((scene) => scene.id)

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Runs</h1>
          <p className="text-sm text-zinc-500">every generation in this session, live</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            <Clapperboard className="size-4" /> Board
          </Link>
          <SessionPicker
            sessions={sessions}
            selectedId={selectedId}
            onSelect={(id) => {
              void navigate({ search: { session: id } })
            }}
          />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {/* RunsFeed's cards register dnd-kit draggables; an inert context keeps
            them mounted here even though this page has no drop targets. */}
        <DndContext id="runs-dnd">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
            <PendingJobs storyboard={storyboard} completedRequestIds={completedRequestIds} />
            <section className="flex flex-col gap-2">
              {selectedId === null ? (
                <EmptyState
                  icon={Radio}
                  title="No sessions yet"
                  hint="Runs stream in here when a Claude Code agent generates media with the genmedia CLI in this project."
                />
              ) : (
                // Keyed by session so the "seen runs" animation state resets on switch.
                <RunsFeed
                  key={selectedId}
                  runs={runs}
                  sceneIds={sceneIds}
                  projectRoot={projectInfo.project_dir}
                  attachable={false}
                />
              )}
            </section>
          </div>
        </DndContext>
      </main>
    </div>
  )
}
