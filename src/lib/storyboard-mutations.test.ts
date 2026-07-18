import { describe, expect, it } from 'vitest'
import { REGENERATE, type Scene, type Storyboard } from './schemas/storyboard'
import {
  appendTake,
  queueRegenerateRequest,
  reorderScenes,
  setSceneNotes,
  setSelectedTake,
  setStar,
} from './storyboard-mutations'

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

describe('setSelectedTake', () => {
  it('sets the selected take on the target scene only', () => {
    const next = setSelectedTake('scene-02', 'req-9')(board('scene-01', 'scene-02'))
    expect(next.scenes[0]?.selected_take).toBeNull()
    expect(next.scenes[1]?.selected_take).toBe('req-9')
  })

  it('clears the selection with null', () => {
    const withSelection = setSelectedTake('scene-01', 'req-9')(board('scene-01'))
    const cleared = setSelectedTake('scene-01', null)(withSelection)
    expect(cleared.scenes[0]?.selected_take).toBeNull()
  })

  it('is idempotent', () => {
    const t = setSelectedTake('scene-01', 'req-9')
    expect(t(t(board('scene-01')))).toEqual(t(board('scene-01')))
  })
})

describe('setStar', () => {
  it('adds the request to the target scene only', () => {
    const next = setStar('scene-01', 'req-1', true)(board('scene-01', 'scene-02'))
    expect(next.scenes[0]?.starred).toEqual(['req-1'])
    expect(next.scenes[1]?.starred).toEqual([])
  })

  it('removes the request when set to false', () => {
    const starred = setStar('scene-01', 'req-1', true)(board('scene-01'))
    expect(setStar('scene-01', 'req-1', false)(starred).scenes[0]?.starred).toEqual([])
  })

  it('is idempotent against ANY base (absolute intent survives conflict retries)', () => {
    const on = setStar('scene-01', 'req-1', true)
    const base = board('scene-01')
    const alreadyOn = on(base)
    // Re-applying to a base where another writer already starred it must not
    // invert — this is the two-tabs race a toggle would lose.
    expect(on(alreadyOn).scenes[0]?.starred).toEqual(['req-1'])
    expect(on(base)).toEqual(on(on(base)))
  })

  it('leaves other starred requests intact', () => {
    const withTwo = setStar(
      'scene-01',
      'req-2',
      true,
    )(setStar('scene-01', 'req-1', true)(board('scene-01')))
    const next = setStar('scene-01', 'req-1', false)(withTwo)
    expect(next.scenes[0]?.starred).toEqual(['req-2'])
  })
})

describe('queueRegenerateRequest', () => {
  it('appends a well-formed regenerate request', () => {
    const next = queueRegenerateRequest('scene-01', 'warmer light')(board('scene-01', 'scene-02'))
    expect(next.requests).toHaveLength(1)
    const request = next.requests[0]
    expect(request?.type).toBe(REGENERATE)
    expect(request?.scene_id).toBe('scene-01')
    expect(request?.note).toBe('warmer light')
    expect(typeof request?.id).toBe('string')
    expect(request?.id).not.toBe('')
    expect(typeof request?.created_at).toBe('number')
  })

  it('leaves scene status untouched (Claude sets generating when it picks it up)', () => {
    const next = queueRegenerateRequest('scene-01', 'x')(board('scene-01'))
    expect(next.scenes[0]?.status).toBe('draft')
  })

  it('does not re-queue when an unhandled regenerate request for the scene exists', () => {
    const once = queueRegenerateRequest('scene-01', 'first')(board('scene-01'))
    const twice = queueRegenerateRequest('scene-01', 'second')(once)
    expect(twice.requests).toHaveLength(1)
    // The original request (and its note) is preserved, not replaced.
    expect(twice.requests[0]?.note).toBe('first')
    expect(twice).toBe(once)
  })

  it('queues independently per scene', () => {
    const board2 = board('scene-01', 'scene-02')
    const next = queueRegenerateRequest(
      'scene-02',
      'b',
    )(queueRegenerateRequest('scene-01', 'a')(board2))
    expect(next.requests.map((r) => r.scene_id)).toEqual(['scene-01', 'scene-02'])
  })

  it('re-queues a scene once a prior request was drained', () => {
    const once = queueRegenerateRequest('scene-01', 'a')(board('scene-01'))
    const drained = { ...once, requests: [] }
    const again = queueRegenerateRequest('scene-01', 'b')(drained)
    expect(again.requests).toHaveLength(1)
    expect(again.requests[0]?.note).toBe('b')
  })
})
