import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Storyboard, Take } from './schemas/storyboard'
import { updateStoryboard } from './server/functions'

// Storyboard edits are whole-document writes (updateStoryboard). To stay safe
// against Claude writing the same file concurrently, every payload is derived
// from the freshest cached document at mutation time — never a stale prop.
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

export function useStoryboardMutation() {
  const queryClient = useQueryClient()

  return useMutation<Storyboard, Error, StoryboardTransform, MutationContext>({
    mutationFn: (transform) => {
      const base = queryClient.getQueryData<Storyboard>(STORYBOARD_KEY)
      if (base === undefined) throw new Error('storyboard not loaded')
      return updateStoryboard({ data: transform(base) })
    },
    onMutate: async (transform) => {
      await queryClient.cancelQueries({ queryKey: STORYBOARD_KEY })
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
    },
    onSuccess: (doc) => {
      queryClient.setQueryData(STORYBOARD_KEY, doc)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: STORYBOARD_KEY })
    },
  })
}
