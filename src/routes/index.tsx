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
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { BookOpen, PlayCircle, Radio } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { StoryboardBoard } from '#/components/board/storyboard-board'
import { storyboardQuery } from '#/lib/queries'
import { reorderScenes, useStoryboardMutation } from '#/lib/storyboard-mutations'
import { useLiveEvents } from '#/lib/use-live-events'

const sceneDragSchema = z.object({ type: z.literal('scene'), sceneId: z.string() })

export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(storyboardQuery)
  },
  component: MissionControl,
})

function MissionControl() {
  useLiveEvents()
  const mutation = useStoryboardMutation()

  const { data: storyboard } = useSuspenseQuery(storyboardQuery)

  const scenes = storyboard?.scenes ?? []
  const sceneIds = scenes.map((scene) => scene.id)
  const hasPlayableSequence = scenes.some((scene) => scene.takes.length > 0)

  const [activeDragLabel, setActiveDragLabel] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = (event: DragStartEvent) => {
    const scene = sceneDragSchema.safeParse(event.active.data.current)
    if (!scene.success) {
      setActiveDragLabel(null)
      return
    }
    const match = scenes.find((s) => s.id === scene.data.sceneId)
    setActiveDragLabel(match?.title ?? null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragLabel(null)
    const { active, over } = event
    if (over === null) return

    const activeScene = sceneDragSchema.safeParse(active.data.current)
    const overScene = sceneDragSchema.safeParse(over.data.current)
    if (!activeScene.success || !overScene.success) return
    if (activeScene.data.sceneId === overScene.data.sceneId) return
    const from = sceneIds.indexOf(activeScene.data.sceneId)
    const to = sceneIds.indexOf(overScene.data.sceneId)
    if (from === -1 || to === -1) return
    mutation.mutate(reorderScenes(arrayMove(sceneIds, from, to)))
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
        setActiveDragLabel(null)
      }}
    >
      <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 px-6 py-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-tight">Mission Control</h1>
            <p className="text-sm text-zinc-500">
              {storyboard === null ? 'genmedia storyboard console' : storyboard.title}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/story"
              className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900"
            >
              <BookOpen className="size-4" /> Story
            </Link>
            <Link
              to="/runs"
              className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900"
            >
              <Radio className="size-4" /> Runs
            </Link>
            {hasPlayableSequence && (
              <Link
                to="/sequence"
                className="flex items-center gap-1.5 rounded-md border border-teal-500/40 bg-teal-500/10 px-3 py-1.5 text-sm font-medium text-teal-200 transition-colors hover:bg-teal-500/20"
              >
                <PlayCircle className="size-4" /> Play sequence
              </Link>
            )}
          </div>
        </header>

        <main className="min-h-0 flex-1">
          <StoryboardBoard storyboard={storyboard} />
        </main>

        <DragOverlay>
          {activeDragLabel === null ? null : (
            <div className="rounded-md border border-teal-500/50 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 shadow-lg">
              {activeDragLabel}
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  )
}
