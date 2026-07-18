import type { Take } from '#/lib/schemas/storyboard'

// Pure resolution logic for the flipper, extracted for testability: these two
// functions decide WHICH take a star/select keystroke lands on, so a wrong
// answer becomes a wrong persistent write.

// Current index: URL take wins, then the human's selected take, then the
// first. Stale references (a take removed under us by a whole-file rewrite)
// fall through to the next resolver rather than erroring.
export function resolveCurrentIndex(
  takes: Take[],
  urlTake: string | undefined,
  selectedTake: string | null,
): number {
  const urlIndex = urlTake === undefined ? -1 : takes.findIndex((t) => t.request_id === urlTake)
  if (urlIndex !== -1) return urlIndex
  const selectedIndex = takes.findIndex((t) => t.request_id === selectedTake)
  return selectedIndex === -1 ? 0 : selectedIndex
}

// Compare target: the selected take (unless the current take IS the
// selection), otherwise a neighbour. Null when there's nothing meaningful to
// compare — which also covers takes.length < 2.
export function resolveComparePair(
  takes: Take[],
  currentIndex: number,
  selectedTake: string | null,
): Take | null {
  const currentTake = takes[currentIndex]
  if (currentTake === undefined) return null
  const selected = takes.find((t) => t.request_id === selectedTake) ?? null
  if (selected !== null && selected.request_id !== currentTake.request_id) return selected
  return takes[currentIndex + 1] ?? takes[currentIndex - 1] ?? null
}
