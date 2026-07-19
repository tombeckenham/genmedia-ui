// Client-side shaping of the SequenceTree payload (one getSequence round-trip;
// the UI indexes it here). Types come from the server modules as type-only
// imports — they are erased at compile time, so no server code reaches the
// client bundle.
import type { FrameRole, Generation, GenerationTargetType } from '#/db/schema'
import type { EntityType, SceneTree, SequenceTree } from '#/lib/server/story-queries'

export function targetKey(type: GenerationTargetType, id: string): string {
  return `${type}:${id}`
}

/** Generations grouped by (targetType, targetId), preserving createdAt order. */
export function indexGenerations(generations: Generation[]): Map<string, Generation[]> {
  const index = new Map<string, Generation[]>()
  for (const generation of generations) {
    const key = targetKey(generation.targetType, generation.targetId)
    const list = index.get(key)
    if (list === undefined) index.set(key, [generation])
    else list.push(generation)
  }
  return index
}

export function generationsFor(
  index: Map<string, Generation[]>,
  type: GenerationTargetType,
  id: string | null | undefined,
): Generation[] {
  if (id === null || id === undefined) return []
  return index.get(targetKey(type, id)) ?? []
}

export function generationById(tree: SequenceTree, id: string | null): Generation | null {
  if (id === null) return null
  return tree.generations.find((generation) => generation.id === id) ?? null
}

/** What the generations detail dialog is pointed at. Ids only — rows are
 * resolved against the live tree on every render so SSE refetches flow in. */
export type DetailTarget =
  | { kind: 'frame'; shotId: string; role: FrameRole }
  | { kind: 'shot'; shotId: string }
  | { kind: 'entity'; type: EntityType; id: string }

export type EntityHighlight = { type: EntityType; id: string }

export function sceneUsesEntity(scene: SceneTree, highlight: EntityHighlight): boolean {
  switch (highlight.type) {
    case 'character':
      return scene.characterIds.includes(highlight.id)
    case 'location':
      return scene.locationId === highlight.id
    case 'element':
      return scene.elementIds.includes(highlight.id)
    default:
      return false
  }
}
