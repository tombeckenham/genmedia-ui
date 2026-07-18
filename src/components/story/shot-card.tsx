import { useMutation } from '@tanstack/react-query'
import { Camera, Clapperboard, Clock } from 'lucide-react'
import { GenerationMedia, MediaPlaceholder } from '#/components/story/generation-media'
import { InlineText } from '#/components/story/inline-text'
import { StatusBadge } from '#/components/story/status-badge'
import { generationById, generationsFor, type DetailTarget } from '#/components/story/story-shape'
import { useInvalidateStory } from '#/components/story/use-story-invalidate'
import { updateShot } from '#/lib/server/story-functions'
import { cn } from '#/lib/utils'
import type { FrameRole, Generation } from '#/db/schema'
import type { SequenceTree, ShotTree } from '#/lib/server/story-queries'

const FRAME_LABELS: Record<FrameRole, string> = { start: 'Start', end: 'End' }

function FrameThumb({
  shot,
  role,
  tree,
  genIndex,
  onOpenDetail,
}: {
  shot: ShotTree
  role: FrameRole
  tree: SequenceTree
  genIndex: Map<string, Generation[]>
  onOpenDetail: (target: DetailTarget) => void
}) {
  const frame = shot.frames.find((f) => f.role === role)
  const selected = generationById(tree, frame?.selectedGenerationId ?? null)
  const takeCount = generationsFor(genIndex, 'frame', frame?.id).length

  return (
    <button
      type="button"
      onClick={() => {
        onOpenDetail({ kind: 'frame', shotId: shot.id, role })
      }}
      aria-label={`Open ${FRAME_LABELS[role].toLowerCase()} frame takes`}
      className="group relative aspect-video min-w-0 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 text-left transition-colors hover:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
    >
      {selected === null ? (
        frame !== undefined && frame.prompt !== '' ? (
          <p className="line-clamp-3 px-2 py-1.5 text-[10px] leading-tight text-zinc-500">
            {frame.prompt}
          </p>
        ) : (
          <MediaPlaceholder label="no frame" />
        )
      ) : (
        <GenerationMedia generation={selected} />
      )}
      <span className="absolute top-1 left-1 rounded bg-black/70 px-1 py-px text-[9px] font-medium tracking-wide text-zinc-300 uppercase">
        {FRAME_LABELS[role]}
      </span>
      {takeCount > 0 && (
        <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 py-px text-[9px] text-zinc-400">
          {takeCount} take{takeCount === 1 ? '' : 's'}
        </span>
      )}
    </button>
  )
}

export function ShotCard({
  shot,
  index,
  tree,
  genIndex,
  onOpenDetail,
}: {
  shot: ShotTree
  index: number
  tree: SequenceTree
  genIndex: Map<string, Generation[]>
  onOpenDetail: (target: DetailTarget) => void
}) {
  const invalidate = useInvalidateStory()
  const promptMutation = useMutation({
    mutationFn: (prompt: string) => updateShot({ data: { id: shot.id, patch: { prompt } } }),
    onSettled: invalidate,
  })

  const selectedVideo = generationById(tree, shot.selectedGenerationId)
  const takeCount = generationsFor(genIndex, 'shot', shot.id).length

  return (
    <div className="flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold text-zinc-500">#{index + 1}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1">
          {shot.camera !== '' && (
            <span className="flex max-w-40 items-center gap-1 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400">
              <Camera className="size-2.5 shrink-0" />
              <span className="truncate">{shot.camera}</span>
            </span>
          )}
          {shot.durationSeconds !== null && (
            <span className="flex items-center gap-1 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400">
              <Clock className="size-2.5" /> {shot.durationSeconds}s
            </span>
          )}
          <StatusBadge status={shot.status} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FrameThumb
          shot={shot}
          role="start"
          tree={tree}
          genIndex={genIndex}
          onOpenDetail={onOpenDetail}
        />
        <FrameThumb
          shot={shot}
          role="end"
          tree={tree}
          genIndex={genIndex}
          onOpenDetail={onOpenDetail}
        />
      </div>

      <button
        type="button"
        onClick={() => {
          onOpenDetail({ kind: 'shot', shotId: shot.id })
        }}
        aria-label="Open shot takes"
        className={cn(
          'group relative overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 text-left transition-colors hover:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
          selectedVideo === null ? 'flex h-9 items-center px-2' : 'aspect-video',
        )}
      >
        {selectedVideo === null ? (
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <Clapperboard className="size-3.5" strokeWidth={1.5} />
            {takeCount === 0 ? 'No video yet' : `${takeCount} take${takeCount === 1 ? '' : 's'}`}
          </span>
        ) : (
          <>
            <GenerationMedia generation={selectedVideo} />
            {takeCount > 0 && (
              <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 py-px text-[9px] text-zinc-400">
                {takeCount} take{takeCount === 1 ? '' : 's'}
              </span>
            )}
          </>
        )}
      </button>

      {shot.description !== '' && (
        <p className="line-clamp-2 text-[11px] text-zinc-500">{shot.description}</p>
      )}

      <InlineText
        value={shot.prompt}
        placeholder="Shot prompt (video model)…"
        ariaLabel={`Prompt for shot ${index + 1}`}
        className="min-h-16 text-xs"
        saveError={promptMutation.isError}
        onSave={(next) => {
          promptMutation.mutate(next)
        }}
      />
    </div>
  )
}
