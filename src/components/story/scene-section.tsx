import { useState } from 'react'
import { Box, ChevronDown, Clapperboard, MapPin, ScrollText, User } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { ShotCard } from '#/components/story/shot-card'
import { StatusBadge } from '#/components/story/status-badge'
import {
  sceneUsesEntity,
  type DetailTarget,
  type EntityHighlight,
} from '#/components/story/story-shape'
import { cn } from '#/lib/utils'
import type { Generation } from '#/db/schema'
import type { SceneTree, SequenceTree } from '#/lib/server/story-queries'

export function SceneSection({
  scene,
  index,
  tree,
  genIndex,
  highlight,
  onOpenDetail,
}: {
  scene: SceneTree
  index: number
  tree: SequenceTree
  genIndex: Map<string, Generation[]>
  highlight: EntityHighlight | null
  onOpenDetail: (target: DetailTarget) => void
}) {
  const [showExcerpt, setShowExcerpt] = useState(false)

  const location = tree.locations.find((l) => l.id === scene.locationId)
  const sceneCharacters = scene.characterIds
    .map((id) => tree.characters.find((c) => c.id === id))
    .filter((c) => c !== undefined)
  const sceneElements = scene.elementIds
    .map((id) => tree.elements.find((e) => e.id === id))
    .filter((e) => e !== undefined)

  const highlighted = highlight !== null && sceneUsesEntity(scene, highlight)
  const dimmed = highlight !== null && !highlighted

  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/20 p-4 transition-all',
        highlighted && 'border-teal-500/60 ring-1 ring-teal-500/40',
        dimmed && 'opacity-40',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-zinc-600">Scene {index + 1}</span>
        <h3 className="text-base font-medium text-zinc-100">{scene.title}</h3>
        <StatusBadge status={scene.status} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
          {location !== undefined && (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200/90">
              <MapPin className="size-3" /> {location.name}
            </span>
          )}
          {sceneCharacters.map((character) => (
            <span
              key={character.id}
              className="flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200/90"
            >
              <User className="size-3" /> {character.name}
            </span>
          ))}
          {sceneElements.map((element) => (
            <span
              key={element.id}
              className="flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-200/90"
            >
              <Box className="size-3" /> {element.name}
            </span>
          ))}
        </div>
      </div>

      {scene.synopsis !== '' && <p className="text-sm text-zinc-400">{scene.synopsis}</p>}

      {scene.scriptExcerpt !== '' && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              setShowExcerpt((prev) => !prev)
            }}
            className="flex w-fit items-center gap-1 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <ScrollText className="size-3" />
            Script excerpt
            <ChevronDown
              className={cn('size-3 transition-transform', showExcerpt && 'rotate-180')}
            />
          </button>
          {showExcerpt && (
            <pre className="max-h-64 overflow-y-auto rounded-md border border-zinc-800/80 bg-zinc-950/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-400">
              {scene.scriptExcerpt}
            </pre>
          )}
        </div>
      )}

      {scene.shots.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="No shots yet"
          hint="Ask Claude to break this scene into shots — each gets a video prompt plus start/end frame prompts."
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {scene.shots.map((shot, shotIndex) => (
            <ShotCard
              key={shot.id}
              shot={shot}
              index={shotIndex}
              tree={tree}
              genIndex={genIndex}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      )}
    </section>
  )
}
