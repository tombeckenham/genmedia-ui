// Small display formatters shared by the activity feed. Pure, client-safe.

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1_000],
]

const relativeTimeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

// "3 minutes ago", "just now". `now` is injectable for tests.
export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const diff = ms - now
  const abs = Math.abs(diff)
  if (abs < 1_000) return 'just now'
  for (const [unit, size] of RELATIVE_UNITS) {
    if (abs >= size) return relativeTimeFormat.format(Math.round(diff / size), unit)
  }
  return 'just now'
}

// "5.2s", "820ms", "1m 04s". Null durations (in-progress records) return null.
export function formatDuration(ms: number | null): string | null {
  if (ms === null) return null
  if (ms < 1_000) return `${ms}ms`
  const totalSeconds = ms / 1_000
  if (totalSeconds < 60)
    return `${totalSeconds < 10 ? totalSeconds.toFixed(1) : Math.round(totalSeconds)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}
