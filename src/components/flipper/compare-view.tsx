import { useEffect, useRef, type RefObject } from 'react'
import { mediaSrc } from '#/lib/media-path'
import type { Take } from '#/lib/schemas/storyboard'
import { TakeMedia } from './take-media'

// If the two panes drift further apart than this, snap the right pane back to
// the left pane's clock. Small enough to look synced, large enough not to churn.
const DRIFT_TOLERANCE_S = 0.15

// Side-by-side comparison of two takes. The left pane is the clock; the right
// pane follows it. `playing` (driven by the `p` key upstream) plays/pauses both.
export function CompareView({
  left,
  right,
  rightLabel,
  playing,
}: {
  left: Take
  right: Take
  rightLabel: string
  playing: boolean
}) {
  const leftRef = useRef<HTMLVideoElement>(null)
  const rightRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    for (const el of [leftRef.current, rightRef.current]) {
      if (el === null) continue
      el.muted = true
      if (playing) void el.play().catch(() => {})
      else el.pause()
    }
  }, [playing])

  const syncRightToLeft = () => {
    const l = leftRef.current
    const r = rightRef.current
    if (l === null || r === null) return
    if (Math.abs(r.currentTime - l.currentTime) > DRIFT_TOLERANCE_S) {
      r.currentTime = l.currentTime
    }
  }

  return (
    <div className="grid h-full grid-cols-2 gap-px">
      <ComparePane take={left} videoRef={leftRef} label="Current" onTimeUpdate={syncRightToLeft} />
      <ComparePane take={right} videoRef={rightRef} label={rightLabel} />
    </div>
  )
}

function ComparePane({
  take,
  videoRef,
  label,
  onTimeUpdate,
}: {
  take: Take
  videoRef: RefObject<HTMLVideoElement | null>
  label: string
  onTimeUpdate?: () => void
}) {
  return (
    <div className="relative flex items-center justify-center overflow-hidden bg-black">
      {take.kind === 'video' ? (
        <video
          ref={videoRef}
          src={mediaSrc(take.path)}
          muted
          loop
          playsInline
          preload="auto"
          onTimeUpdate={onTimeUpdate}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <TakeMedia take={take} className="max-h-full max-w-full object-contain" />
      )}
      <span className="absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-zinc-300">
        {label}
      </span>
    </div>
  )
}
