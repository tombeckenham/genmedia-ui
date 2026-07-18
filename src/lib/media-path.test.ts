import { describe, expect, it } from 'vitest'
import { mediaSrc, toStoredTakePath } from './media-path'

describe('toStoredTakePath', () => {
  const root = '/Users/tom/project'

  it('relativizes paths under the project root', () => {
    expect(toStoredTakePath('/Users/tom/project/takes/scene-01/a.mp4', root)).toBe(
      'takes/scene-01/a.mp4',
    )
  })

  it('keeps paths outside the project root absolute', () => {
    expect(toStoredTakePath('/Users/other/project/takes/scene-01/a.mp4', root)).toBe(
      '/Users/other/project/takes/scene-01/a.mp4',
    )
  })

  it('does not treat a sibling dir sharing the prefix as inside the root', () => {
    expect(toStoredTakePath('/Users/tom/project-two/takes/s/a.mp4', root)).toBe(
      '/Users/tom/project-two/takes/s/a.mp4',
    )
  })

  it('passes through already-relative paths and handles a missing root', () => {
    expect(toStoredTakePath('takes/scene-01/a.mp4', root)).toBe('takes/scene-01/a.mp4')
    expect(toStoredTakePath('/abs/elsewhere.mp4', null)).toBe('/abs/elsewhere.mp4')
  })
})

describe('mediaSrc', () => {
  it('URL-encodes the path', () => {
    expect(mediaSrc('/a b/c.mp4')).toBe('/api/media?path=%2Fa%20b%2Fc.mp4')
  })
})
