import { describe, expect, it } from 'vitest'
import type { Scene, Storyboard } from './schemas/storyboard'
import { appendTake, reorderScenes, setSceneNotes } from './storyboard-mutations'

function scene(id: string): Scene {
  return {
    id,
    title: id,
    prompt: '',
    status: 'draft',
    notes: '',
    selected_take: null,
    starred: [],
    takes: [],
    pending: [],
  }
}

function board(...ids: string[]): Storyboard {
  return {
    schema_version: 1,
    title: 'test',
    updated_at: 0,
    scenes: ids.map(scene),
    requests: [],
  }
}

const take = {
  request_id: 'req-1',
  endpoint_id: 'fal-ai/x',
  path: 'takes/scene-01/req-1.mp4',
  kind: 'video' as const,
}

describe('reorderScenes', () => {
  it('arranges scenes into the given order', () => {
    const next = reorderScenes(['scene-03', 'scene-01', 'scene-02'])(
      board('scene-01', 'scene-02', 'scene-03'),
    )
    expect(next.scenes.map((s) => s.id)).toEqual(['scene-03', 'scene-01', 'scene-02'])
  })

  it('keeps scenes missing from the order at the end, in relative order', () => {
    const next = reorderScenes(['scene-02'])(board('scene-01', 'scene-02', 'scene-03'))
    expect(next.scenes.map((s) => s.id)).toEqual(['scene-02', 'scene-01', 'scene-03'])
  })

  it('is idempotent', () => {
    const t = reorderScenes(['scene-02', 'scene-01'])
    expect(t(t(board('scene-01', 'scene-02')))).toEqual(t(board('scene-01', 'scene-02')))
  })
})

describe('appendTake', () => {
  it('appends to the target scene only', () => {
    const next = appendTake('scene-02', take)(board('scene-01', 'scene-02'))
    expect(next.scenes[0]?.takes).toEqual([])
    expect(next.scenes[1]?.takes).toEqual([take])
  })

  it('skips when the request is already attached (idempotent)', () => {
    const t = appendTake('scene-01', take)
    const once = t(board('scene-01'))
    expect(t(once).scenes[0]?.takes).toHaveLength(1)
  })
})

describe('setSceneNotes', () => {
  it('updates the target scene notes', () => {
    const next = setSceneNotes('scene-01', 'warmer light')(board('scene-01', 'scene-02'))
    expect(next.scenes[0]?.notes).toBe('warmer light')
    expect(next.scenes[1]?.notes).toBe('')
  })
})
