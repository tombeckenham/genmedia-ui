import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { StoryboardBoard } from '#/components/board/storyboard-board'
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
import { takeSchema } from '#/lib/schemas/storyboard'
import { appendTake, reorderScenes, useStoryboardMutation } from '#/lib/storyboard-mutations'
import { useLiveEvents } from '#/lib/use-live-events'

const searchSchema = z.object({
  session: z.string().optional(),
})

const sceneDragSchema = z.object({ type: z.literal('scene'), sceneId: z.string() })
const runDragSchema = z.object({ type: z.literal('run'), take: takeSchema })

export const Route = createFileRoute('/')({
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
  component: MissionControl,
})

interface ActiveDrag {
  kind: 'scene' | 'run'
  label: string
}

function MissionControl() {
  useLiveEvents()
  const navigate = useNavigate({ from: Route.fullPath })
  const mutation = useStoryboardMutation()

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

  const scenes = storyboard?.scenes ?? []
  const sceneIds = scenes.map((scene) => scene.id)

  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = (event: DragStartEvent) => {
    const data: unknown = event.active.data.current
    const scene = sceneDragSchema.safeParse(data)
    if (scene.success) {
      const match = scenes.find((s) => s.id === scene.data.sceneId)
      setActiveDrag(match === undefined ? null : { kind: 'scene', label: match.title })
      return
    }
    const run = runDragSchema.safeParse(data)
    setActiveDrag(run.success ? { kind: 'run', label: run.data.take.endpoint_id } : null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null)
    const { active, over } = event
    if (over === null) return

    const activeData: unknown = active.data.current
    const overData: unknown = over.data.current

    const activeScene = sceneDragSchema.safeParse(activeData)
    if (activeScene.success) {
      const overScene = sceneDragSchema.safeParse(overData)
      if (!overScene.success || activeScene.data.sceneId === overScene.data.sceneId) return
      const from = sceneIds.indexOf(activeScene.data.sceneId)
      const to = sceneIds.indexOf(overScene.data.sceneId)
      if (from === -1 || to === -1) return
      mutation.mutate(reorderScenes(arrayMove(sceneIds, from, to)))
      return
    }

    const activeRun = runDragSchema.safeParse(activeData)
    if (activeRun.success) {
      const overScene = sceneDragSchema.safeParse(overData)
      if (overScene.success) {
        mutation.mutate(appendTake(overScene.data.sceneId, activeRun.data.take))
      }
    }
  }

  return (
    <DndContext
      // Stable id keeps dnd-kit's generated aria ids identical between SSR and
      // hydration (the default is an instance counter that can drift).
      id="mission-control-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveDrag(null)
      }}
    >
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

          <StoryboardBoard storyboard={storyboard} />

          <PendingJobs storyboard={storyboard} completedRequestIds={completedRequestIds} />

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Runs</h2>
            {selectedId === null ? (
              <p className="rounded-lg border border-dashed border-zinc-800 p-6 text-sm text-zinc-500">
                No sessions found in the gallery yet.
              </p>
            ) : (
              // Keyed by session so the "seen runs" animation state resets on switch.
              <RunsFeed
                key={selectedId}
                runs={runs}
                sceneIds={sceneIds}
                projectRoot={projectInfo.project_dir}
              />
            )}
          </section>
        </div>

        <DragOverlay>
          {activeDrag === null ? null : (
            <div className="rounded-md border border-teal-500/50 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 shadow-lg">
              {activeDrag.kind === 'scene' ? activeDrag.label : `Attach ${activeDrag.label}`}
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  )
}
