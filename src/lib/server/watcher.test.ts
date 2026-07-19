import { describe, expect, it } from 'vitest'
import { classifyPath } from './watcher'

const roots = {
  gallery: '/home/u/.genmedia/gallery',
  storyboard: '/home/u/project/storyboard.json',
  storyDb: '/home/u/project/story.db',
}

describe('classifyPath', () => {
  it('classifies session data files under the gallery as gallery changes', () => {
    expect(classifyPath('/home/u/.genmedia/gallery/sessions/abc/data.json', roots)).toBe('gallery')
  })

  it('classifies the last-session pointer as a gallery change', () => {
    expect(classifyPath('/home/u/.genmedia/gallery/last-session.json', roots)).toBe('gallery')
  })

  it('classifies the gallery dir itself as a gallery change', () => {
    expect(classifyPath('/home/u/.genmedia/gallery', roots)).toBe('gallery')
  })

  it('classifies the storyboard file as a storyboard change', () => {
    expect(classifyPath('/home/u/project/storyboard.json', roots)).toBe('storyboard')
  })

  it('does not treat a sibling dir sharing a prefix as gallery', () => {
    expect(classifyPath('/home/u/.genmedia/gallery-backup/data.json', roots)).toBeUndefined()
  })

  it('ignores unrelated paths', () => {
    expect(classifyPath('/etc/passwd', roots)).toBeUndefined()
    expect(classifyPath('/home/u/project/other.json', roots)).toBeUndefined()
  })

  it('normalizes non-canonical paths before matching', () => {
    expect(classifyPath('/home/u/.genmedia/gallery/sessions/../last-session.json', roots)).toBe(
      'gallery',
    )
  })

  it('classifies the story DB file and its SQLite siblings as story changes', () => {
    expect(classifyPath('/home/u/project/story.db', roots)).toBe('story')
    expect(classifyPath('/home/u/project/story.db-wal', roots)).toBe('story')
    expect(classifyPath('/home/u/project/story.db-shm', roots)).toBe('story')
  })

  it('does not treat other project files as story changes', () => {
    expect(classifyPath('/home/u/project/story.db.backup/x', roots)).toBeUndefined()
    expect(classifyPath('/home/u/project/story2.db', roots)).toBeUndefined()
  })
})
