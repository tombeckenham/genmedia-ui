import { describe, expect, it } from 'vitest'
import { lastSessionPointerSchema, sessionPayloadSchema } from './gallery'
import { emptyStoryboard, sceneSchema, storyboardSchema } from './storyboard'

const sessionFixture = {
  schema_version: 1,
  session_id: 'a49672967c0c',
  session_source: 'process-tree',
  agent: 'claude-code',
  agent_host: 'ghostty',
  cwd: '/Users/tom/code/fal-hackathon/genmedia-ui',
  started_at: 1784330165189,
  updated_at: 1784330183049,
  runs: [
    {
      ts: 1784330165133,
      request_id: '019f725d-7d62-7271-af33-e2f7e45d404a',
      endpoint_id: 'google/nano-banana-2-lite',
      modality: null,
      prompt: 'a lighthouse',
      duration_ms: 5166,
      files: [
        {
          path: '/tmp/demo/takes/scene-01/still.png',
          url: 'https://v3b.fal.media/files/b/x.png',
          size_bytes: 1512603,
          kind: 'image',
          json_path: 'images[0]',
        },
      ],
    },
  ],
}

describe('gallery schemas', () => {
  it('parses a real-shaped SessionPayload', () => {
    const parsed = sessionPayloadSchema.parse(sessionFixture)
    expect(parsed.runs).toHaveLength(1)
    expect(parsed.runs[0]?.files[0]?.kind).toBe('image')
  })

  it('strips unknown extra keys instead of rejecting (CLI may add fields)', () => {
    const parsed = sessionPayloadSchema.parse({ ...sessionFixture, future_field: true })
    expect('future_field' in parsed).toBe(false)
  })

  it('rejects a wrong schema_version', () => {
    expect(() => sessionPayloadSchema.parse({ ...sessionFixture, schema_version: 2 })).toThrow()
  })

  it('rejects an empty last-session pointer id', () => {
    expect(() =>
      lastSessionPointerSchema.parse({
        session_id: '',
        anchor: 'x',
        agent: null,
        agent_host: null,
        source: 'process-tree',
        updated_at: 1,
      }),
    ).toThrow()
  })
})

describe('storyboard schema', () => {
  it('round-trips an empty storyboard', () => {
    const board = emptyStoryboard('Lighthouse Teaser')
    expect(storyboardSchema.parse(board)).toEqual(board)
  })

  it('applies defaults for omitted scene fields', () => {
    const scene = sceneSchema.parse({
      id: 'scene-01',
      title: 'Drone approach',
      prompt: 'aerial...',
    })
    expect(scene.status).toBe('draft')
    expect(scene.notes).toBe('')
    expect(scene.selected_take).toBeNull()
    expect(scene.starred).toEqual([])
    expect(scene.takes).toEqual([])
    expect(scene.pending).toEqual([])
  })

  it('rejects an unknown scene status', () => {
    expect(() =>
      sceneSchema.parse({ id: 's', title: 't', prompt: 'p', status: 'exploded' }),
    ).toThrow()
  })

  it('accepts the CLI scene-id slugs and rejects unsafe ids', () => {
    for (const id of ['scene-01', 'scene-02', 'scene-03', 's', 'a1_b-2']) {
      expect(sceneSchema.parse({ id, title: 't', prompt: 'p' }).id).toBe(id)
    }
    for (const id of ['', 'Scene-01', '-scene', '_scene', 'scene 1', 'a/b', '../etc']) {
      expect(() => sceneSchema.parse({ id, title: 't', prompt: 'p' })).toThrow()
    }
  })

  it('preserves optional take params (reproducibility metadata) round-trip', () => {
    const take = {
      request_id: 'req-1',
      endpoint_id: 'fal-ai/veo3',
      path: 'takes/scene-01/req-1.mp4',
      kind: 'video',
      params: { seed: 42, prompt: 'a lighthouse', guidance_scale: 7 },
    }
    const scene = sceneSchema.parse({ id: 'scene-01', title: 't', prompt: 'p', takes: [take] })
    expect(scene.takes[0]?.params).toEqual({ seed: 42, prompt: 'a lighthouse', guidance_scale: 7 })
  })

  it('leaves params undefined when omitted', () => {
    const scene = sceneSchema.parse({
      id: 'scene-01',
      title: 't',
      prompt: 'p',
      takes: [{ request_id: 'r', endpoint_id: 'e', path: 'takes/scene-01/r.mp4', kind: 'video' }],
    })
    expect(scene.takes[0]?.params).toBeUndefined()
  })
})
