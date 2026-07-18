import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Storyboard, Take } from './schemas/storyboard'
import { toast } from 'sonner'
import { getStoryboard, updateStoryboard } from './server/functions'

// Storyboard edits are whole-document writes (updateStoryboard). To stay safe
// against Claude writing the same file concurrently, every payload is derived
// from a fresh server read of the on-disk document at mutation time (query
// cache only as fallback when the file is missing) — never a stale prop.
// Transforms are idempotent so the optimistic (onMutate) and network
// (mutationFn) applications can't compound.

const STORYBOARD_KEY = ['storyboard'] as const

export type StoryboardTransform = (doc: Storyboard) => Storyboard

// Arrange scenes into the given id order. Scenes missing from `order` (e.g.
// added by Claude mid-drag) keep their relative order at the end.
export function reorderScenes(order: string[]): StoryboardTransform {
  const rank = new Map(order.map((id, index) => [id, index]))
  return (doc) => {
    const scenes = doc.scenes
      .map((scene, index) => ({ scene, index }))
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort((a, b) => {
        const ra = rank.get(a.scene.id) ?? Number.MAX_SAFE_INTEGER
        const rb = rank.get(b.scene.id) ?? Number.MAX_SAFE_INTEGER
        return ra === rb ? a.index - b.index : ra - rb
      })
      .map((entry) => entry.scene)
    return { ...doc, scenes }
  }
}

// Append a take to a scene, skipping if the request is already attached.
export function appendTake(sceneId: string, take: Take): StoryboardTransform {
  return (doc) => ({
    ...doc,
    scenes: doc.scenes.map((scene) =>
      scene.id === sceneId && !scene.takes.some((t) => t.request_id === take.request_id)
        ? { ...scene, takes: [...scene.takes, take] }
        : scene,
    ),
  })
}

export function setSceneNotes(sceneId: string, notes: string): StoryboardTransform {
  return (doc) => ({
    ...doc,
    scenes: doc.scenes.map((scene) => (scene.id === sceneId ? { ...scene, notes } : scene)),
  })
}

interface MutationContext {
  previous: Storyboard | undefined
}

// Client-side marker for a retryable write conflict. Thrown HERE (from the
// typed { conflict: true } result) so retry matching never depends on error
// messages surviving server-fn serialization.
export const STORYBOARD_CONFLICT = 'storyboard-conflict'

export function useStoryboardMutation() {
  const queryClient = useQueryClient()

  return useMutation<Storyboard, Error, StoryboardTransform, MutationContext>({
    mutationFn: async (transform) => {
      // Base the write on the freshest ON-DISK doc, not the query cache: the
      // Claude agent writes this file too. updateStoryboard reports a typed
      // conflict if disk moves between this read and the write, and the retry
      // below re-reads and re-applies the transform.
      const fresh = await getStoryboard()
      const base = fresh ?? queryClient.getQueryData<Storyboard>(STORYBOARD_KEY)
      if (base == null) throw new Error('storyboard not loaded')
      const result = await updateStoryboard({
        data: { expected_updated_at: fresh?.updated_at ?? null, storyboard: transform(base) },
      })
      if (result.conflict) throw new Error(STORYBOARD_CONFLICT)
      return result.doc
    },
    retry: (failureCount, error) => error.message === STORYBOARD_CONFLICT && failureCount < 3,
    onMutate: (transform) => {
      // No cancelQueries: SSE-driven refetches carry external Claude edits we
      // want. The cost: an in-flight stale refetch can briefly overwrite the
      // optimistic state, which onSettled's invalidate repairs.
      const previous = queryClient.getQueryData<Storyboard>(STORYBOARD_KEY)
      if (previous !== undefined) {
        queryClient.setQueryData<Storyboard>(STORYBOARD_KEY, transform(previous))
      }
      return { previous }
    },
    onError: (_error, _transform, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(STORYBOARD_KEY, context.previous)
      }
      // Every mutation site (reorder, attach, notes) funnels through here —
      // one toast covers them all. Without it a failed save looks identical
      // to a successful one.
      toast.error('Storyboard change could not be saved', {
        description: 'Your edit was rolled back. Check the storyboard file and try again.',
      })
    },
    onSuccess: (doc) => {
      queryClient.setQueryData(STORYBOARD_KEY, doc)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: STORYBOARD_KEY })
    },
  })
}
