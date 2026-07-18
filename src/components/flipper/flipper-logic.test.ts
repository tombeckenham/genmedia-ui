import { describe, expect, it } from 'vitest'
import type { Take } from '#/lib/schemas/storyboard'
import { resolveComparePair, resolveCurrentIndex } from './flipper-logic'

function take(id: string): Take {
  return { request_id: id, endpoint_id: 'fal-ai/x', path: `takes/s/${id}.mp4`, kind: 'video' }
}

const takes = [take('a'), take('b'), take('c')]

describe('resolveCurrentIndex', () => {
  it('prefers the URL take even when a different take is selected', () => {
    expect(resolveCurrentIndex(takes, 'b', 'c')).toBe(1)
  })

  it('falls back to the selected take when the URL take was removed', () => {
    expect(resolveCurrentIndex(takes, 'gone', 'c')).toBe(2)
  })

  it('falls back to the first take when both references are stale', () => {
    expect(resolveCurrentIndex(takes, 'gone', 'also-gone')).toBe(0)
    expect(resolveCurrentIndex(takes, undefined, null)).toBe(0)
  })

  it('returns 0 for an empty list (caller renders the empty state)', () => {
    expect(resolveCurrentIndex([], 'a', 'b')).toBe(0)
  })
})

describe('resolveComparePair', () => {
  it('pairs the current take with the selected take', () => {
    expect(resolveComparePair(takes, 0, 'c')?.request_id).toBe('c')
  })

  it('pairs with the next neighbour when the current take IS the selection', () => {
    expect(resolveComparePair(takes, 1, 'b')?.request_id).toBe('c')
  })

  it('pairs the last take with its previous neighbour when it is the selection', () => {
    expect(resolveComparePair(takes, 2, 'c')?.request_id).toBe('b')
  })

  it('pairs with a neighbour when nothing is selected', () => {
    expect(resolveComparePair(takes, 0, null)?.request_id).toBe('b')
  })

  it('returns null for a single take or an out-of-range index', () => {
    expect(resolveComparePair([take('only')], 0, null)).toBeNull()
    expect(resolveComparePair(takes, 99, null)).toBeNull()
  })
})
