import { describe, expect, it } from 'vitest'
import type { Scene, Storyboard, Take } from '#/lib/schemas/storyboard'
import { decideAudioPolicy } from './audio-policy'
import { formatClock, locateTime, resolveSequence, slugifyTitle, totalDuration } from './sequence'

function take(id: string): Take {
  return { request_id: id, endpoint_id: 'fal-ai/x', path: `takes/s/${id}.mp4`, kind: 'video' }
}

function scene(id: string, takes: Take[], selected: string | null): Scene {
  return {
    id,
    title: `Scene ${id}`,
    prompt: 'p',
    status: 'ready',
    notes: '',
    selected_take: selected,
    starred: [],
    takes,
    pending: [],
  }
}

function storyboard(scenes: Scene[]): Storyboard {
  return { schema_version: 1, title: 'Lighthouse Teaser', updated_at: 0, scenes, requests: [] }
}

describe('resolveSequence', () => {
  it('uses each scene selected take, in scene order', () => {
    const sb = storyboard([scene('01', [take('a'), take('b')], 'b'), scene('02', [take('c')], 'c')])
    const seq = resolveSequence(sb)
    expect(seq.map((s) => s.take.request_id)).toEqual(['b', 'c'])
    expect(seq.map((s) => s.sceneId)).toEqual(['01', '02'])
    expect(seq[0]?.url).toBe(`/api/media?path=${encodeURIComponent('takes/s/b.mp4')}`)
  })

  it('falls back to the first take when none is selected', () => {
    const seq = resolveSequence(storyboard([scene('01', [take('a'), take('b')], null)]))
    expect(seq.map((s) => s.take.request_id)).toEqual(['a'])
  })

  it('falls back to the first take when the selected id is stale', () => {
    const seq = resolveSequence(storyboard([scene('01', [take('a')], 'gone')]))
    expect(seq.map((s) => s.take.request_id)).toEqual(['a'])
  })

  it('skips scenes with no takes', () => {
    const seq = resolveSequence(
      storyboard([scene('01', [], null), scene('02', [take('c')], 'c'), scene('03', [], null)]),
    )
    expect(seq.map((s) => s.sceneId)).toEqual(['02'])
  })

  it('returns an empty list for a null storyboard or no scenes', () => {
    expect(resolveSequence(null)).toEqual([])
    expect(resolveSequence(storyboard([]))).toEqual([])
  })
})

describe('locateTime', () => {
  const durations = [5, 3, 4] // total 12

  it('maps a time inside the first clip', () => {
    expect(locateTime(durations, 2)).toEqual({ index: 0, offset: 2 })
  })

  it('maps a time inside a middle clip', () => {
    expect(locateTime(durations, 6)).toEqual({ index: 1, offset: 1 })
  })

  it('puts the boundary time at the start of the next clip', () => {
    expect(locateTime(durations, 5)).toEqual({ index: 1, offset: 0 })
  })

  it('clamps times at or below zero to the first clip', () => {
    expect(locateTime(durations, 0)).toEqual({ index: 0, offset: 0 })
    expect(locateTime(durations, -3)).toEqual({ index: 0, offset: 0 })
  })

  it('clamps past-the-end time to the last clip', () => {
    expect(locateTime(durations, 99)).toEqual({ index: 2, offset: 4 })
  })

  it('handles an empty duration list', () => {
    expect(locateTime([], 3)).toEqual({ index: 0, offset: 0 })
  })
})

describe('totalDuration', () => {
  it('sums durations', () => {
    expect(totalDuration([5, 3, 4])).toBe(12)
    expect(totalDuration([])).toBe(0)
  })
})

describe('formatClock', () => {
  it('formats mm:ss with zero padding', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5)).toBe('0:05')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(600)).toBe('10:00')
  })

  it('clamps invalid values to 0:00', () => {
    expect(formatClock(-4)).toBe('0:00')
    expect(formatClock(Number.NaN)).toBe('0:00')
  })
})

describe('slugifyTitle', () => {
  it('slugifies a title', () => {
    expect(slugifyTitle('Lighthouse Teaser')).toBe('lighthouse-teaser')
    expect(slugifyTitle('  Weird!! Title -- 2 ')).toBe('weird-title-2')
  })

  it('falls back to "sequence" for an empty slug', () => {
    expect(slugifyTitle('')).toBe('sequence')
    expect(slugifyTitle('!!!')).toBe('sequence')
  })
})

describe('decideAudioPolicy', () => {
  it('is none when no clip has audio', () => {
    expect(decideAudioPolicy([{ hasAudio: false }, { hasAudio: false }])).toBe('none')
    expect(decideAudioPolicy([])).toBe('none')
  })

  it('is mux when any clip has audio (mixed silent/audio included)', () => {
    expect(decideAudioPolicy([{ hasAudio: false }, { hasAudio: true }, { hasAudio: false }])).toBe(
      'mux',
    )
    expect(decideAudioPolicy([{ hasAudio: true }])).toBe('mux')
  })
})
