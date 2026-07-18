import { getRouteApi, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Film, Star, X } from 'lucide-react'
import type { Scene } from '#/lib/schemas/storyboard'
import { setSelectedTake, setStar, useStoryboardMutation } from '#/lib/storyboard-mutations'
import { cn } from '#/lib/utils'
import { CompareView } from './compare-view'
import { resolveComparePair, resolveCurrentIndex } from './flipper-logic'
import { TakeMedia } from './take-media'

const route = getRouteApi('/scene/$sceneId')

// Full-screen filmstrip viewer for a scene's takes. Keyboard-first: arrows flip,
// space stars, enter selects, c compares, esc leaves. The current take is stored
// in the URL (?take=) so the view is deep-linkable and survives refresh.
export function Flipper({ scene }: { scene: Scene }) {
  const navigate = route.useNavigate()
  const search = route.useSearch()
  const mutation = useStoryboardMutation()

  const takes = scene.takes
  const [compare, setCompare] = useState(false)
  const [comparePlaying, setComparePlaying] = useState(true)

  // Current index: URL take wins, then the human's selected take, then the first.
  const currentIndex = useMemo(
    () => resolveCurrentIndex(takes, search.take, scene.selected_take),
    [search.take, takes, scene.selected_take],
  )

  const currentTake = takes[currentIndex]

  const goToIndex = useCallback(
    (index: number) => {
      const target = takes[index]
      if (target === undefined) return
      void navigate({ search: (prev) => ({ ...prev, take: target.request_id }), replace: true })
    },
    [navigate, takes],
  )

  const star = useCallback(() => {
    if (currentTake === undefined) return
    // Absolute intent: star iff the user saw it un-starred when pressing space.
    const next = !scene.starred.includes(currentTake.request_id)
    mutation.mutate(setStar(scene.id, currentTake.request_id, next))
  }, [currentTake, mutation, scene.id, scene.starred])

  const select = useCallback(() => {
    if (currentTake !== undefined)
      mutation.mutate(setSelectedTake(scene.id, currentTake.request_id))
  }, [currentTake, mutation, scene.id])

  // Compare target: the selected take (unless the current take IS the selection),
  // otherwise a neighbour. Null when there's nothing meaningful to compare.
  const compareOther = useMemo(
    () => resolveComparePair(takes, currentIndex, scene.selected_take),
    [takes, scene.selected_take, currentIndex],
  )

  const canCompare = compareOther !== null

  const toggleCompare = useCallback(() => {
    if (compare) {
      setCompare(false)
      return
    }
    if (!canCompare) return
    setComparePlaying(true)
    setCompare(true)
  }, [compare, canCompare])

  // Leave compare if it stops being possible (e.g. a take was removed).
  useEffect(() => {
    if (compare && !canCompare) setCompare(false)
  }, [compare, canCompare])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          goToIndex(currentIndex - 1)
          break
        case 'ArrowRight':
          event.preventDefault()
          goToIndex(currentIndex + 1)
          break
        case ' ':
          event.preventDefault()
          star()
          break
        case 'Enter':
          event.preventDefault()
          select()
          break
        case 'Escape':
          event.preventDefault()
          if (compare) setCompare(false)
          else void navigate({ to: '/' })
          break
        case 'c':
        case 'C':
          event.preventDefault()
          toggleCompare()
          break
        case 'p':
        case 'P':
          if (compare) {
            event.preventDefault()
            setComparePlaying((playing) => !playing)
          }
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [currentIndex, goToIndex, star, select, compare, toggleCompare, navigate])

  if (takes.length === 0 || currentTake === undefined) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black text-zinc-200">
        <Film className="size-8 text-zinc-600" strokeWidth={1.5} />
        <p className="text-sm text-zinc-300">
          <span className="font-medium text-zinc-100">{scene.title}</span> has no takes yet
        </p>
        <p className="max-w-xs text-center text-xs leading-relaxed text-zinc-500">
          Ask Claude to generate a take for this scene and it will appear here.
        </p>
        <Link to="/" className="mt-1 text-sm text-teal-400 hover:text-teal-300">
          Back to the board
        </Link>
      </div>
    )
  }

  const currentStarred = scene.starred.includes(currentTake.request_id)
  const currentSelected = scene.selected_take === currentTake.request_id

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-zinc-100">
      <header className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{scene.title}</div>
          <div className="text-xs text-zinc-500">
            {currentIndex + 1} / {takes.length}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {currentStarred && (
            <span className="flex items-center gap-1 text-amber-400">
              <Star className="size-3.5 fill-amber-400" /> Starred
            </span>
          )}
          {currentSelected && <span className="font-semibold text-teal-400">SELECTED</span>}
          <Link
            to="/"
            aria-label="Close (Esc)"
            className="flex items-center gap-1 rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="size-4" /> Esc
          </Link>
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        {compare && compareOther !== null ? (
          <CompareView
            left={currentTake}
            right={compareOther}
            rightLabel={compareOther.request_id === scene.selected_take ? 'Selected' : 'Compare'}
            playing={comparePlaying}
          />
        ) : (
          // Keep the immediate neighbours mounted (hidden) so flipping never
          // shows a blank frame while the next clip loads.
          takes.map((take, index) => {
            if (Math.abs(index - currentIndex) > 1) return null
            const isCurrent = index === currentIndex
            return (
              <div
                key={take.request_id}
                aria-hidden={!isCurrent}
                className={cn(
                  'absolute inset-0 flex items-center justify-center transition-opacity duration-150',
                  isCurrent ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
              >
                <TakeMedia
                  take={take}
                  autoPlay
                  preload="auto"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            )
          })
        )}
      </main>

      <div className="flex gap-2 overflow-x-auto bg-zinc-950/80 px-4 py-3">
        {takes.map((take, index) => {
          const isCurrent = index === currentIndex
          const isStarred = scene.starred.includes(take.request_id)
          const isSelected = scene.selected_take === take.request_id
          return (
            <button
              key={take.request_id}
              type="button"
              onClick={() => {
                goToIndex(index)
              }}
              aria-label={`Take ${index + 1}`}
              aria-current={isCurrent}
              className={cn(
                'relative aspect-video w-28 shrink-0 overflow-hidden rounded-md border-2 bg-zinc-900',
                isCurrent ? 'border-teal-400' : 'border-transparent hover:border-zinc-600',
              )}
            >
              <TakeMedia take={take} className="size-full object-cover" />
              {isStarred && (
                <Star className="absolute top-1 left-1 size-3.5 fill-amber-400 text-amber-400" />
              )}
              {isSelected && (
                <span className="absolute bottom-1 left-1 rounded bg-teal-500 px-1 text-[9px] font-semibold text-white">
                  SELECTED
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="px-4 py-2 text-center text-[11px] text-zinc-500">
        {compare ? (
          <span>
            <Key>p</Key> play/pause · <Key>c</Key>/<Key>esc</Key> exit compare
          </span>
        ) : (
          <span>
            <Key>←</Key> <Key>→</Key> flip · <Key>space</Key> star · <Key>enter</Key> select ·{' '}
            <Key>c</Key> compare · <Key>esc</Key> back
          </span>
        )}
      </div>
    </div>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 text-[10px] text-zinc-300">
      {children}
    </kbd>
  )
}
