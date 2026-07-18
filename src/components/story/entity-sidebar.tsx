import { useMutation } from '@tanstack/react-query'
import { Box, Images, MapPin, User, type LucideIcon } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { GenerationMedia, MediaPlaceholder } from '#/components/story/generation-media'
import { InlineText } from '#/components/story/inline-text'
import {
  generationById,
  generationsFor,
  type DetailTarget,
  type EntityHighlight,
} from '#/components/story/story-shape'
import { useInvalidateStory } from '#/components/story/use-story-invalidate'
import { updateEntity } from '#/lib/server/story-functions'
import { cn } from '#/lib/utils'
import type { Generation } from '#/db/schema'
import type { EntityRow, EntityType, SequenceTree } from '#/lib/server/story-queries'

const ENTITY_ICONS: Record<EntityType, LucideIcon> = {
  character: User,
  location: MapPin,
  element: Box,
}

function EntityCard({
  type,
  entity,
  tree,
  genIndex,
  highlight,
  onHighlight,
  onOpenDetail,
}: {
  type: EntityType
  entity: EntityRow
  tree: SequenceTree
  genIndex: Map<string, Generation[]>
  highlight: EntityHighlight | null
  onHighlight: (next: EntityHighlight | null) => void
  onOpenDetail: (target: DetailTarget) => void
}) {
  const invalidate = useInvalidateStory()
  const promptMutation = useMutation({
    mutationFn: (prompt: string) =>
      updateEntity({ data: { type, id: entity.id, patch: { prompt } } }),
    onSettled: invalidate,
  })

  const selected = generationById(tree, entity.selectedGenerationId)
  const takeCount = generationsFor(genIndex, type, entity.id).length
  const isHighlighted = highlight !== null && highlight.type === type && highlight.id === entity.id
  const Icon = ENTITY_ICONS[type]
  const kind = 'kind' in entity ? entity.kind : null

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 transition-colors',
        isHighlighted && 'border-teal-500/60 ring-1 ring-teal-500/40',
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => {
            onOpenDetail({ kind: 'entity', type, id: entity.id })
          }}
          aria-label={`Open reference images for ${entity.name}`}
          className="relative size-14 shrink-0 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 transition-colors hover:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          {selected === null ? <MediaPlaceholder /> : <GenerationMedia generation={selected} />}
          {takeCount > 0 && (
            <span className="absolute right-0 bottom-0 flex items-center gap-0.5 rounded-tl bg-black/70 px-1 py-px text-[9px] text-zinc-300">
              <Images className="size-2.5" /> {takeCount}
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => {
              onHighlight(isHighlighted ? null : { type, id: entity.id })
            }}
            title="Highlight scenes using this"
            className={cn(
              'flex max-w-full items-center gap-1.5 truncate text-sm font-medium transition-colors',
              isHighlighted ? 'text-teal-300' : 'text-zinc-100 hover:text-teal-300',
            )}
          >
            <Icon className="size-3.5 shrink-0 text-zinc-500" />
            <span className="truncate">{entity.name}</span>
          </button>
          {kind !== null && <span className="text-[10px] text-zinc-500 uppercase">{kind}</span>}
          {entity.description !== '' && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">{entity.description}</p>
          )}
        </div>
      </div>
      <InlineText
        value={entity.prompt}
        placeholder="Appearance prompt (for reference images)…"
        ariaLabel={`Appearance prompt for ${entity.name}`}
        className="min-h-14 text-xs"
        saveError={promptMutation.isError}
        onSave={(next) => {
          promptMutation.mutate(next)
        }}
      />
    </div>
  )
}

function EntityList({
  type,
  entities,
  emptyHint,
  ...shared
}: {
  type: EntityType
  entities: EntityRow[]
  emptyHint: string
  tree: SequenceTree
  genIndex: Map<string, Generation[]>
  highlight: EntityHighlight | null
  onHighlight: (next: EntityHighlight | null) => void
  onOpenDetail: (target: DetailTarget) => void
}) {
  if (entities.length === 0) {
    return <EmptyState icon={ENTITY_ICONS[type]} title={`No ${type}s yet`} hint={emptyHint} />
  }
  return (
    <div className="flex flex-col gap-2">
      {entities.map((entity) => (
        <EntityCard key={entity.id} type={type} entity={entity} {...shared} />
      ))}
    </div>
  )
}

export function EntitySidebar({
  tree,
  genIndex,
  highlight,
  onHighlight,
  onOpenDetail,
}: {
  tree: SequenceTree
  genIndex: Map<string, Generation[]>
  highlight: EntityHighlight | null
  onHighlight: (next: EntityHighlight | null) => void
  onOpenDetail: (target: DetailTarget) => void
}) {
  const shared = { tree, genIndex, highlight, onHighlight, onOpenDetail }
  return (
    <Tabs defaultValue="characters" className="flex h-full flex-col">
      <TabsList className="w-full">
        <TabsTrigger value="characters">Characters</TabsTrigger>
        <TabsTrigger value="locations">Locations</TabsTrigger>
        <TabsTrigger value="elements">Elements</TabsTrigger>
      </TabsList>
      <TabsContent value="characters" className="min-h-0 flex-1 overflow-y-auto">
        <EntityList
          type="character"
          entities={tree.characters}
          emptyHint="Ask Claude to extract characters from the script — each gets an appearance prompt for reference images."
          {...shared}
        />
      </TabsContent>
      <TabsContent value="locations" className="min-h-0 flex-1 overflow-y-auto">
        <EntityList
          type="location"
          entities={tree.locations}
          emptyHint="Locations extracted from the script show up here with reference imagery."
          {...shared}
        />
      </TabsContent>
      <TabsContent value="elements" className="min-h-0 flex-1 overflow-y-auto">
        <EntityList
          type="element"
          entities={tree.elements}
          emptyHint="Props, vehicles, creatures and effects that recur across scenes live here."
          {...shared}
        />
      </TabsContent>
    </Tabs>
  )
}
