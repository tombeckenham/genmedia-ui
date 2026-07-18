import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { REGENERATE, type Storyboard } from '#/lib/schemas/storyboard'
import { SceneCard } from './scene-card'

// Horizontal, drag-reorderable row of scene cards. The DndContext lives in the
// page (so feed run cards can be dragged onto scenes); this only owns the
// sortable ordering of the scenes themselves.
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

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Storyboard</h2>
        {storyboard !== null && (
          <span className="text-[11px] text-zinc-600">{storyboard.title}</span>
        )}
      </div>

      {scenes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-800 p-6 text-sm text-zinc-500">
          No scenes yet. The storyboard is created by the Claude agent driving the CLI.
        </p>
      ) : (
        <SortableContext
          items={scenes.map((scene) => scene.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex gap-3 overflow-x-auto pb-2">
            {scenes.map((scene) => (
              <SceneCard key={scene.id} scene={scene} queuedForRegen={regenScenes.has(scene.id)} />
            ))}
          </div>
        </SortableContext>
      )}
    </section>
  )
}
