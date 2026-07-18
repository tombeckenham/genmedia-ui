import { useEffect, useRef } from 'react'
import { Film } from 'lucide-react'
import { mediaSrc } from '#/lib/media-path'
import type { Take } from '#/lib/schemas/storyboard'
import { cn } from '#/lib/utils'

// Renders one take's media. Videos are always muted + looped; `autoPlay` starts
// playback (used by the stage and preloaded neighbours). `muted` is set as a DOM
// property via ref, not just the attribute, because browsers only permit
// autoplay when the element is actually muted.
export function TakeMedia({
  take,
  className,
  autoPlay = false,
  preload = 'metadata',
}: {
  take: Take
  className?: string
  autoPlay?: boolean
  preload?: 'none' | 'metadata' | 'auto'
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (el === null) return
    el.muted = true
    if (autoPlay) void el.play().catch(() => {}) // autoplay rejections are harmless
  }, [autoPlay, take.path])

  if (take.kind === 'video') {
    return (
      <video
        ref={videoRef}
        src={mediaSrc(take.path)}
        muted
        loop
        playsInline
        autoPlay={autoPlay}
        preload={preload}
        className={className}
      />
    )
  }

  if (take.kind === 'image') {
    return <img src={mediaSrc(take.path)} alt="" className={className} />
  }

  return (
    <div className={cn('flex items-center justify-center bg-zinc-900', className)}>
      <Film className="size-8 text-zinc-600" strokeWidth={1.5} />
    </div>
  )
}
