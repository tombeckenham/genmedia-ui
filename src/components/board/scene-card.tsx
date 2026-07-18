import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useRef, useState } from 'react'
import { Film, GripVertical } from 'lucide-react'
import { Textarea } from '#/components/ui/textarea'
import { mediaSrc } from '#/lib/media-path'
import type { Scene, SceneStatus } from '#/lib/schemas/storyboard'
import { setSceneNotes, useStoryboardMutation } from '#/lib/storyboard-mutations'
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

  if (take === undefined) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-md border border-zinc-800 bg-zinc-900">
        <Film className="size-6 text-zinc-600" strokeWidth={1.5} />
      </div>
    )
  }

  return (
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
}

function SceneNotes({ scene }: { scene: Scene }) {
  const mutation = useStoryboardMutation()
  const [value, setValue] = useState(scene.notes)
  const focusedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Adopt external changes (e.g. Claude edited notes) only while not editing.
  useEffect(() => {
    if (!focusedRef.current) setValue(scene.notes)
  }, [scene.notes])

  const save = (next: string) => {
    if (next !== scene.notes) mutation.mutate(setSceneNotes(scene.id, next))
  }

  // Flush (not discard) a pending debounced save on unmount, or the last
  // few keystrokes silently vanish when the card unmounts mid-debounce.
  const flushRef = useRef<(() => void) | null>(null)
  flushRef.current = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
      save(value)
    }
  }
  useEffect(() => {
    return () => {
      flushRef.current?.()
    }
  }, [])

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        value={value}
        placeholder="Notes for Claude…"
        className="min-h-14 bg-zinc-900/60"
        onFocus={() => {
          focusedRef.current = true
        }}
        onChange={(event) => {
          const next = event.target.value
          setValue(next)
          if (timerRef.current !== null) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => save(next), NOTES_DEBOUNCE_MS)
        }}
        onBlur={() => {
          focusedRef.current = false
          if (timerRef.current !== null) clearTimeout(timerRef.current)
          save(value)
        }}
      />
      {mutation.isError && (
        <span className="text-[11px] text-red-400">Not saved — edit again to retry.</span>
      )}
    </div>
  )
}

export function SceneCard({ scene }: { scene: Scene }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: scene.id, data: { type: 'scene', sceneId: scene.id } })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex w-64 shrink-0 flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 transition-colors',
        isDragging && 'opacity-50',
        isOver && 'border-teal-500/60 ring-1 ring-teal-500/40',
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
            <h3 className="truncate text-sm font-medium text-zinc-100">{scene.title}</h3>
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                STATUS_STYLES[scene.status],
              )}
            >
              {STATUS_LABELS[scene.status]}
            </span>
          </div>
        </div>
      </div>

      <SceneThumb scene={scene} />

      <p className="line-clamp-2 text-xs text-zinc-400">{scene.prompt}</p>

      <div className="flex items-center justify-between text-[11px] text-zinc-500">
        <span>
          {scene.takes.length} take{scene.takes.length === 1 ? '' : 's'}
        </span>
      </div>

      <SceneNotes scene={scene} />
    </div>
  )
}
