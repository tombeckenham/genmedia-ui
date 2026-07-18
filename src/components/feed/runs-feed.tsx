import { useDraggable } from '@dnd-kit/core'
import { useEffect, useRef } from 'react'
import { Clock, Layers } from 'lucide-react'
import type { RunRecord } from '#/lib/schemas/gallery'
import { formatDuration, formatRelativeTime } from '#/lib/format'
import { toStoredTakePath } from '#/lib/media-path'
import { cn } from '#/lib/utils'
import { MediaThumb } from './media-thumb'

function RunCard({
  run,
  isNew,
  sceneIds,
  projectRoot,
}: {
  run: RunRecord
  isNew: boolean
  sceneIds: string[]
  projectRoot: string | null
}) {
  const firstFile = run.files[0]
  const extraCount = run.files.length - 1
  const duration = formatDuration(run.duration_ms)
  const firstPath = firstFile?.path ?? null

  // Auto-annotation: a run whose file already lives under takes/<sceneId>/ is
  // display-tagged with that scene (no write).
  const sceneTag =
    firstPath === null ? null : (sceneIds.find((id) => firstPath.includes(`/takes/${id}/`)) ?? null)

  // Drag source for attaching this run to a scene. Only runs with a usable file
  // path can be attached, so others are non-draggable.
  const canAttach = firstFile !== undefined && firstPath !== null
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `run:${run.request_id}`,
    disabled: !canAttach,
    data:
      canAttach && firstPath !== null
        ? {
            type: 'run',
            take: {
              request_id: run.request_id,
              endpoint_id: run.endpoint_id,
              path: toStoredTakePath(firstPath, projectRoot),
              kind: firstFile.kind,
            },
          }
        : { type: 'run' },
  })

  return (
    <li
      ref={setNodeRef}
      className={cn(
        'flex gap-4 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3 transition-colors hover:border-zinc-700',
        isNew && 'animate-in fade-in slide-in-from-top-4 duration-700',
        canAttach && 'cursor-grab touch-none active:cursor-grabbing',
        isDragging && 'opacity-50',
      )}
      {...attributes}
      {...listeners}
    >
      <div className="relative">
        {firstFile === undefined ? (
          <div className="flex aspect-video w-32 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-xs text-zinc-600">
            no file
          </div>
        ) : (
          <MediaThumb file={firstFile} />
        )}
        {extraCount > 0 && (
          <span className="absolute right-1 bottom-1 flex items-center gap-0.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200">
            <Layers className="size-2.5" />+{extraCount}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-mono text-xs text-teal-300">{run.endpoint_id}</span>
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-500">
            <Clock className="size-3" />
            {/* Relative time depends on Date.now(); server and client renders can
                disagree across a rounding boundary — keep the server text. */}
            <span suppressHydrationWarning>{formatRelativeTime(run.ts)}</span>
          </span>
        </div>

        {run.prompt !== null && run.prompt !== '' && (
          <p className="line-clamp-2 text-sm text-zinc-300">{run.prompt}</p>
        )}

        <div className="mt-auto flex items-center gap-3 text-[11px] text-zinc-500">
          {duration !== null && <span>{duration}</span>}
          <span>
            {run.files.length} file{run.files.length === 1 ? '' : 's'}
          </span>
          {sceneTag !== null && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
              {sceneTag}
            </span>
          )}
        </div>
      </div>
    </li>
  )
}

// Reverse-chronological run cards. Runs arriving after mount (via SSE-driven
// refetch) animate in; the initial set is treated as already seen so the whole
// feed doesn't animate on load.
export function RunsFeed({
  runs,
  sceneIds,
  projectRoot,
}: {
  runs: RunRecord[]
  sceneIds: string[]
  projectRoot: string | null
}) {
  const seenRef = useRef<Set<string>>(new Set())
  const hasMountedRef = useRef(false)

  const newIds = new Set<string>()
  if (hasMountedRef.current) {
    for (const run of runs) {
      if (!seenRef.current.has(run.request_id)) newIds.add(run.request_id)
    }
  }

  useEffect(() => {
    hasMountedRef.current = true
    for (const run of runs) seenRef.current.add(run.request_id)
  })

  // Sort a copy (never the prop array); toSorted isn't in the ES2022 lib target.
  // oxlint-disable-next-line unicorn/no-array-sort
  const ordered = [...runs].sort((a, b) => b.ts - a.ts)

  if (ordered.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-800 p-6 text-sm text-zinc-500">
        No runs in this session yet.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {ordered.map((run) => (
        <RunCard
          key={run.request_id}
          run={run}
          isNew={newIds.has(run.request_id)}
          sceneIds={sceneIds}
          projectRoot={projectRoot}
        />
      ))}
    </ul>
  )
}
