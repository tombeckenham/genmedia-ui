import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { Clapperboard, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { EmptyState } from '#/components/ui/empty-state'
import { REGENERATE, type Storyboard } from '#/lib/schemas/storyboard'
import { cn } from '#/lib/utils'
import { SceneCard } from './scene-card'

// Zoom levels for the board. Width classes must stay literal so Tailwind
// generates them; `compact` levels drop the card's prompt/notes chrome and
// keep just the thumbnail + title so a large board fits on screen.
const ZOOM_LEVELS = [
  { pct: 40, cardClass: 'w-48', compact: true },
  { pct: 60, cardClass: 'w-72', compact: true },
  { pct: 80, cardClass: 'w-[min(24rem,80vw)]', compact: false },
  { pct: 100, cardClass: 'w-[min(30rem,80vw)]', compact: false },
] as const

const DEFAULT_ZOOM = ZOOM_LEVELS.length - 1
const ZOOM_STORAGE_KEY = 'mission-control-board-zoom'

// Full-height, wrapping canvas of scene cards with a zoom control. The
// DndContext lives in the page; this owns the sortable ordering of the scenes
// plus drag-to-pan on the empty canvas around the cards (cards keep their own
// pointer interactions).
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

  // Zoom is applied after mount (not in the initial render) so SSR and
  // hydration agree even when localStorage holds a non-default level.
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM)
  useEffect(() => {
    const stored = Number.parseInt(window.localStorage.getItem(ZOOM_STORAGE_KEY) ?? '', 10)
    if (!Number.isNaN(stored) && stored >= 0 && stored < ZOOM_LEVELS.length) {
      setZoomIndex(stored)
    }
  }, [])
  const setZoom = (index: number) => {
    setZoomIndex(index)
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(index))
  }
  const zoom = ZOOM_LEVELS[zoomIndex] ?? ZOOM_LEVELS[3]

  const containerRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startLeft: number
    startTop: number
  } | null>(null)
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
      startY: event.clientY,
      startLeft: container.scrollLeft,
      startTop: container.scrollTop,
    }
    container.setPointerCapture(event.pointerId)
    setIsPanning(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    const pan = panRef.current
    if (container === null || pan === null || pan.pointerId !== event.pointerId) return
    container.scrollLeft = pan.startLeft - (event.clientX - pan.startX)
    container.scrollTop = pan.startTop - (event.clientY - pan.startY)
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
    <div className="relative h-full">
      <div className="absolute top-4 right-6 z-10 flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/80 px-1.5 py-1 backdrop-blur">
        <button
          type="button"
          onClick={() => setZoom(Math.max(0, zoomIndex - 1))}
          disabled={zoomIndex === 0}
          aria-label="Zoom out"
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:text-zinc-700"
        >
          <ZoomOut className="size-4" />
        </button>
        <span className="w-10 text-center text-[11px] tabular-nums text-zinc-500">{zoom.pct}%</span>
        <button
          type="button"
          onClick={() => setZoom(Math.min(ZOOM_LEVELS.length - 1, zoomIndex + 1))}
          disabled={zoomIndex === ZOOM_LEVELS.length - 1}
          aria-label="Zoom in"
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:text-zinc-700"
        >
          <ZoomIn className="size-4" />
        </button>
      </div>

      <SortableContext items={scenes.map((scene) => scene.id)} strategy={rectSortingStrategy}>
        <div
          ref={containerRef}
          className={cn(
            'flex h-full flex-wrap content-start items-start gap-6 overflow-y-auto px-8 py-6',
            isPanning ? 'cursor-grabbing' : 'cursor-grab',
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          {scenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              queuedForRegen={regenScenes.has(scene.id)}
              widthClass={zoom.cardClass}
              compact={zoom.compact}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}
