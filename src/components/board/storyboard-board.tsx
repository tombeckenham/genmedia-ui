import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { Clapperboard } from 'lucide-react'
import { useRef, useState, type PointerEvent } from 'react'
import { EmptyState } from '#/components/ui/empty-state'
import { REGENERATE, type Storyboard } from '#/lib/schemas/storyboard'
import { cn } from '#/lib/utils'
import { SceneCard } from './scene-card'

// Full-height, pannable canvas of scene cards. The DndContext lives in the
// page (so feed run cards can be dragged onto scenes); this only owns the
// sortable ordering of the scenes themselves, plus drag-to-pan on the empty
// canvas around the cards (cards keep their own pointer interactions).
export function StoryboardBoard({ storyboard }: { storyboard: Storyboard | null }) {
  const scenes = storyboard?.scenes ?? []

  // Scene ids with an unhandled regenerate request in the direction queue — the
  // card shows a "queued for Claude" hint and disables its Regenerate button.
  const regenScenes = new Set<string>()
  for (const request of storyboard?.requests ?? []) {
    if (request.type === REGENERATE && request.scene_id !== undefined) {
      regenScenes.add(request.scene_id)
    }
  }

  const containerRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef<{ pointerId: number; startX: number; startScroll: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (container === null || event.button !== 0) return
    // Pan only from the empty canvas — pointer-downs inside a card belong to
    // the card (drag handle, links, notes textarea).
    if (event.target instanceof Element && event.target.closest('[data-scene-card]') !== null) {
      return
    }
    event.preventDefault()
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: container.scrollLeft,
    }
    container.setPointerCapture(event.pointerId)
    setIsPanning(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    const pan = panRef.current
    if (container === null || pan === null || pan.pointerId !== event.pointerId) return
    container.scrollLeft = pan.startScroll - (event.clientX - pan.startX)
  }

  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    const pan = panRef.current
    if (pan === null || pan.pointerId !== event.pointerId) return
    panRef.current = null
    setIsPanning(false)
    if (container !== null && container.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId)
    }
  }

  if (scenes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={Clapperboard}
          title="No storyboard yet"
          hint={
            'Ask Claude to start one, like "make a 3-scene lighthouse teaser". Scenes and takes show up here as it generates.'
          }
        />
      </div>
    )
  }

  return (
    <SortableContext
      items={scenes.map((scene) => scene.id)}
      strategy={horizontalListSortingStrategy}
    >
      <div
        ref={containerRef}
        className={cn(
          'flex h-full items-center gap-6 overflow-x-auto px-8 py-6',
          isPanning ? 'cursor-grabbing' : 'cursor-grab',
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        {scenes.map((scene) => (
          <SceneCard key={scene.id} scene={scene} queuedForRegen={regenScenes.has(scene.id)} />
        ))}
      </div>
    </SortableContext>
  )
}
