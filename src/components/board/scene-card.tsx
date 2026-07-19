import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Film, GripVertical, RefreshCw } from 'lucide-react'
import { Textarea } from '#/components/ui/textarea'
import { mediaSrc } from '#/lib/media-path'
import type { Scene, SceneStatus } from '#/lib/schemas/storyboard'
import {
  queueRegenerateRequest,
  setSceneNotes,
  useStoryboardMutation,
} from '#/lib/storyboard-mutations'
import { cn } from '#/lib/utils'

const STATUS_STYLES: Record<SceneStatus, string> = {
  draft: 'bg-zinc-700/50 text-zinc-300',
  queued: 'bg-blue-500/15 text-blue-300',
  generating: 'bg-amber-500/15 text-amber-300',
  ready: 'bg-teal-500/15 text-teal-300',
  'needs-review': 'bg-purple-500/15 text-purple-300',
}

const STATUS_LABELS: Record<SceneStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  generating: 'Generating',
  ready: 'Ready',
  'needs-review': 'Needs review',
}

const NOTES_DEBOUNCE_MS = 600

function SceneThumb({ scene }: { scene: Scene }) {
  const take = scene.takes.find((t) => t.request_id === scene.selected_take) ?? scene.takes[0]

  const inner =
    take === undefined ? (
      <div className="flex aspect-video w-full items-center justify-center rounded-md border border-zinc-800 bg-zinc-900">
        <Film className="size-6 text-zinc-600" strokeWidth={1.5} />
      </div>
    ) : (
      <div className="aspect-video w-full overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
        {take.kind === 'video' ? (
          <video
            src={mediaSrc(take.path)}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover"
          />
        ) : take.kind === 'image' ? (
          <img src={mediaSrc(take.path)} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Film className="size-6 text-zinc-600" strokeWidth={1.5} />
          </div>
        )}
      </div>
    )

  // Only the thumbnail navigates to the flipper — the drag handle lives on the
  // grip button, so this Link never competes with reordering listeners.
  return (
    <Link
      to="/scene/$sceneId"
      params={{ sceneId: scene.id }}
      aria-label={`Open ${scene.title} in the version flipper`}
      className="block rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
    >
      {inner}
    </Link>
  )
}

export function SceneCard({ scene, queuedForRegen }: { scene: Scene; queuedForRegen: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: scene.id, data: { type: 'scene', sceneId: scene.id } })
  const mutation = useStoryboardMutation()

  // Notes editor state, co-located so the Regenerate button can queue the exact
  // note the user is looking at. Debounced save; adopt external edits (Claude
  // rewriting notes) only while the box isn't focused.
  const [note, setNote] = useState(scene.notes)
  const focusedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!focusedRef.current) setNote(scene.notes)
  }, [scene.notes])

  const saveNotes = (next: string) => {
    if (next !== scene.notes) mutation.mutate(setSceneNotes(scene.id, next))
  }

  // Flush (not discard) a pending debounced save on unmount, or the last few
  // keystrokes vanish when the card unmounts mid-debounce.
  const flushRef = useRef<(() => void) | null>(null)
  flushRef.current = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
      saveNotes(note)
    }
  }
  useEffect(() => {
    return () => {
      flushRef.current?.()
    }
  }, [])

  const handleRegenerate = () => {
    // The request carries the live note; the scene's own notes save on blur.
    mutation.mutate(queueRegenerateRequest(scene.id, note))
  }

  const style = { transform: CSS.Transform.toString(transform), transition }
  const needsReview = scene.status === 'needs-review'

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-scene-card
      className={cn(
        'flex w-[min(30rem,80vw)] shrink-0 cursor-default flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition-colors',
        isDragging && 'opacity-50',
        isOver && 'border-teal-500/60 ring-1 ring-teal-500/40',
        needsReview && 'border-purple-500/50',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 cursor-grab touch-none text-zinc-600 hover:text-zinc-400 active:cursor-grabbing"
          aria-label="Drag to reorder scene"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-base font-medium text-zinc-100">{scene.title}</h3>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={queuedForRegen}
                aria-label={
                  queuedForRegen
                    ? 'Regenerate already queued for Claude'
                    : 'Queue this scene for Claude to regenerate'
                }
                title={queuedForRegen ? 'Queued for Claude' : 'Regenerate with Claude'}
                className={cn(
                  'rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:pointer-events-none',
                  queuedForRegen && 'text-teal-400',
                )}
              >
                <RefreshCw className="size-3.5" />
              </button>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium',
                  STATUS_STYLES[scene.status],
                  needsReview && 'animate-pulse ring-1 ring-purple-400/70',
                )}
              >
                {STATUS_LABELS[scene.status]}
              </span>
            </div>
          </div>
        </div>
      </div>

      <SceneThumb scene={scene} />

      <p className="line-clamp-3 text-sm text-zinc-400">{scene.prompt}</p>

      <div className="flex items-center justify-between text-[11px] text-zinc-500">
        <span>
          {scene.takes.length} take{scene.takes.length === 1 ? '' : 's'}
        </span>
        {queuedForRegen && (
          <span className="flex items-center gap-1 text-teal-400">
            <RefreshCw className="size-3" /> Queued for Claude
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Textarea
          value={note}
          placeholder="Notes for Claude…"
          className="min-h-20 bg-zinc-900/60"
          onFocus={() => {
            focusedRef.current = true
          }}
          onChange={(event) => {
            const next = event.target.value
            setNote(next)
            if (timerRef.current !== null) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => saveNotes(next), NOTES_DEBOUNCE_MS)
          }}
          onBlur={() => {
            focusedRef.current = false
            if (timerRef.current !== null) clearTimeout(timerRef.current)
            saveNotes(note)
          }}
        />
        {mutation.isError && (
          <span className="text-[11px] text-red-400">Not saved — edit again to retry.</span>
        )}
      </div>
    </div>
  )
}
