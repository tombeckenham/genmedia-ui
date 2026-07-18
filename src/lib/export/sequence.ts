import { mediaSrc } from '#/lib/media-path'
import type { Storyboard, Take } from '#/lib/schemas/storyboard'

// Pure sequence resolution + time mapping. No mediabunny / WebCodecs here so it
// stays unit-testable in jsdom.

export interface SequenceItem {
  sceneId: string
  sceneTitle: string
  take: Take
  /** /api/media URL for the take's media file. */
  url: string
}

// The ordered list of takes that make up the movie: each scene's selected take
// (falling back to its first take when none is selected). Scenes with no takes
// are skipped entirely.
export function resolveSequence(storyboard: Storyboard | null): SequenceItem[] {
  if (storyboard === null) return []
  const items: SequenceItem[] = []
  for (const scene of storyboard.scenes) {
    const take = scene.takes.find((t) => t.request_id === scene.selected_take) ?? scene.takes[0]
    if (take === undefined) continue
    items.push({ sceneId: scene.id, sceneTitle: scene.title, take, url: mediaSrc(take.path) })
  }
  return items
}

export interface TimeLocation {
  /** Index of the clip containing global time `t`. */
  index: number
  /** Offset in seconds into that clip. */
  offset: number
}

// Map a global timeline position (seconds) onto a clip index + in-clip offset,
// given each clip's duration. `t` is clamped to [0, total]. An out-of-range or
// empty input resolves to the first clip at offset 0.
export function locateTime(durations: number[], t: number): TimeLocation {
  if (durations.length === 0) return { index: 0, offset: 0 }
  if (t <= 0) return { index: 0, offset: 0 }

  let acc = 0
  for (const [index, duration] of durations.entries()) {
    const isLast = index === durations.length - 1
    if (t < acc + duration || isLast) {
      return { index, offset: Math.max(0, Math.min(t - acc, duration)) }
    }
    acc += duration
  }

  // Unreachable (the isLast branch always returns), but keeps the type total.
  return { index: durations.length - 1, offset: 0 }
}

// Sum of clip durations = total movie length in seconds.
export function totalDuration(durations: number[]): number {
  return durations.reduce((sum, d) => sum + d, 0)
}

// mm:ss for a scrubber readout. Negative/NaN clamp to 0:00.
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

// URL-friendly slug for the download filename, derived from the storyboard title.
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'sequence' : slug
}
