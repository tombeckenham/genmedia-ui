import { useMutation } from '@tanstack/react-query'
import { Check, Images } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { GenerationMedia } from '#/components/story/generation-media'
import { InlineText } from '#/components/story/inline-text'
import { generationsFor, type DetailTarget } from '#/components/story/story-shape'
import { useInvalidateStory } from '#/components/story/use-story-invalidate'
import {
  selectGeneration,
  updateEntity,
  updateShot,
  upsertFrame,
} from '#/lib/server/story-functions'
import { cn } from '#/lib/utils'
import type { Generation, GenerationTargetType } from '#/db/schema'
import type { SequenceTree, ShotTree } from '#/lib/server/story-queries'

type ResolvedTarget = {
  title: string
  description: string
  targetType: GenerationTargetType
  /** Null when the row does not exist yet (a frame that was never written). */
  targetId: string | null
  selectedGenerationId: string | null
  prompt: string
  notes: string
  promptPlaceholder: string
}

function findShot(
  tree: SequenceTree,
  shotId: string,
): { shot: ShotTree; sceneTitle: string } | null {
  for (const scene of tree.scenes) {
    const shot = scene.shots.find((s) => s.id === shotId)
    if (shot !== undefined) return { shot, sceneTitle: scene.title }
  }
  return null
}

function resolveTarget(tree: SequenceTree, target: DetailTarget): ResolvedTarget | null {
  if (target.kind === 'frame') {
    const found = findShot(tree, target.shotId)
    if (found === null) return null
    const frame = found.shot.frames.find((f) => f.role === target.role)
    return {
      title: `${target.role === 'start' ? 'Start' : 'End'} frame`,
      description: `${found.sceneTitle} — shot ${found.shot.id}`,
      targetType: 'frame',
      targetId: frame?.id ?? null,
      selectedGenerationId: frame?.selectedGenerationId ?? null,
      prompt: frame?.prompt ?? '',
      notes: frame?.notes ?? '',
      promptPlaceholder: 'Self-contained still-image prompt for this frame…',
    }
  }
  if (target.kind === 'shot') {
    const found = findShot(tree, target.shotId)
    if (found === null) return null
    return {
      title: 'Shot',
      description: `${found.sceneTitle} — shot ${found.shot.id}`,
      targetType: 'shot',
      targetId: found.shot.id,
      selectedGenerationId: found.shot.selectedGenerationId,
      prompt: found.shot.prompt,
      notes: found.shot.notes,
      promptPlaceholder: 'Motion/action prompt for the video model…',
    }
  }
  const pool =
    target.type === 'character'
      ? tree.characters
      : target.type === 'location'
        ? tree.locations
        : tree.elements
  const entity = pool.find((e) => e.id === target.id)
  if (entity === undefined) return null
  return {
    title: entity.name,
    description: `${target.type[0]?.toUpperCase() ?? ''}${target.type.slice(1)} reference`,
    targetType: target.type,
    targetId: entity.id,
    selectedGenerationId: entity.selectedGenerationId,
    prompt: entity.prompt,
    notes: entity.notes,
    promptPlaceholder: 'Visual appearance prompt for reference images…',
  }
}

function DialogBody({
  tree,
  target,
  genIndex,
}: {
  tree: SequenceTree
  target: DetailTarget
  genIndex: Map<string, Generation[]>
}) {
  const invalidate = useInvalidateStory()

  const selectMutation = useMutation({
    mutationFn: (input: {
      targetType: GenerationTargetType
      targetId: string
      generationId: string | null
    }) => selectGeneration({ data: input }),
    onSettled: invalidate,
  })
  const saveMutation = useMutation({
    // The three branches return different row shapes; the dialog only cares
    // about success/failure, so widen to unknown.
    mutationFn: async (patch: { prompt?: string; notes?: string }): Promise<unknown> => {
      if (target.kind === 'frame') {
        return upsertFrame({ data: { shotId: target.shotId, role: target.role, ...patch } })
      }
      if (target.kind === 'shot') {
        return updateShot({ data: { id: target.shotId, patch } })
      }
      return updateEntity({ data: { type: target.type, id: target.id, patch } })
    },
    onSettled: invalidate,
  })

  const resolved = resolveTarget(tree, target)
  if (resolved === null) {
    return <p className="text-sm text-zinc-500">This item no longer exists.</p>
  }

  const generations = generationsFor(genIndex, resolved.targetType, resolved.targetId)
  const selected =
    generations.find((g) => g.id === resolved.selectedGenerationId) ??
    generations[generations.length - 1] ??
    null

  return (
    <>
      <DialogHeader>
        <DialogTitle>{resolved.title}</DialogTitle>
        <DialogDescription>{resolved.description}</DialogDescription>
      </DialogHeader>

      {generations.length === 0 ? (
        <EmptyState
          icon={Images}
          title="No generations yet"
          hint="Ask Claude to generate takes for this with the genmedia CLI — recorded generations land here for review."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {selected !== null && (
            <div className="max-h-72 overflow-hidden rounded-lg border border-zinc-800 bg-black">
              <GenerationMedia generation={selected} controls className="max-h-72 object-contain" />
            </div>
          )}

          <div className="flex gap-2 overflow-x-auto pb-1">
            {generations.map((generation) => {
              const isSelected = generation.id === resolved.selectedGenerationId
              return (
                <button
                  key={generation.id}
                  type="button"
                  disabled={resolved.targetId === null || selectMutation.isPending}
                  title={
                    generation.endpointId === ''
                      ? generation.id
                      : `${generation.endpointId}${isSelected ? ' (selected)' : ''}`
                  }
                  onClick={() => {
                    if (resolved.targetId === null) return
                    selectMutation.mutate({
                      targetType: resolved.targetType,
                      targetId: resolved.targetId,
                      // Clicking the selected take clears the selection.
                      generationId: isSelected ? null : generation.id,
                    })
                  }}
                  className={cn(
                    'relative aspect-video h-20 shrink-0 overflow-hidden rounded-md border bg-zinc-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                    isSelected
                      ? 'border-teal-500 ring-1 ring-teal-500/60'
                      : 'border-zinc-800 hover:border-zinc-600',
                  )}
                >
                  <GenerationMedia generation={generation} />
                  {isSelected && (
                    <span className="absolute top-1 right-1 rounded-full bg-teal-500 p-0.5 text-zinc-950">
                      <Check className="size-2.5" strokeWidth={3} />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {selectMutation.isError && (
            <p className="text-[11px] text-red-400">Selection failed — try again.</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          Prompt
        </span>
        <InlineText
          value={resolved.prompt}
          placeholder={resolved.promptPlaceholder}
          ariaLabel="Prompt"
          className="min-h-20 text-xs"
          saveError={saveMutation.isError}
          onSave={(next) => {
            saveMutation.mutate({ prompt: next })
          }}
        />
        <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          Notes
        </span>
        <InlineText
          value={resolved.notes}
          placeholder="Notes for Claude…"
          ariaLabel="Notes"
          className="min-h-14 text-xs"
          onSave={(next) => {
            saveMutation.mutate({ notes: next })
          }}
        />
      </div>
    </>
  )
}

export function GenerationsDialog({
  tree,
  target,
  genIndex,
  onClose,
}: {
  tree: SequenceTree
  target: DetailTarget | null
  genIndex: Map<string, Generation[]>
  onClose: () => void
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-2xl">
        {target !== null && (
          // Keyed by target so editor drafts and mutation state reset when the
          // dialog is re-pointed at a different row.
          <DialogBody
            key={
              target.kind === 'frame'
                ? `frame:${target.shotId}:${target.role}`
                : target.kind === 'shot'
                  ? `shot:${target.shotId}`
                  : `entity:${target.type}:${target.id}`
            }
            tree={tree}
            target={target}
            genIndex={genIndex}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
