import { useEffect, useRef, useState } from 'react'
import { Box, Clapperboard, FileQuestion, ImageOff, Music } from 'lucide-react'
import type { GalleryFile } from '#/lib/schemas/gallery'
import { cn } from '#/lib/utils'

// Build the /api/media URL for a locally-tracked file path.
function mediaSrc(path: string): string {
  return `/api/media?path=${encodeURIComponent(path)}`
}

function PlaceholderIcon({ kind }: { kind: GalleryFile['kind'] }) {
  const Icon =
    kind === 'audio' ? Music : kind === 'model' ? Box : kind === 'image' ? ImageOff : FileQuestion
  return <Icon className="size-6 text-zinc-600" strokeWidth={1.5} />
}

// Thumbnail for the first file of a run. Images and videos stream from
// /api/media; anything without a local path falls back to a kind icon, and
// media that fails to load (e.g. a gallery run whose downloaded file was since
// deleted) falls back to a subtle film-slate rather than a broken-image box.
export function MediaThumb({ file, className }: { file: GalleryFile; className?: string }) {
  const [errored, setErrored] = useState(false)
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null)
  // Callback ref shared by both element kinds (a union RefObject satisfies
  // neither element-specific Ref type, but a widened callback does).
  const attachMediaRef = (el: HTMLImageElement | HTMLVideoElement | null) => {
    mediaRef.current = el
  }

  // SSR-rendered media starts loading before hydration, so a load failure can
  // fire (and be gone) before React attaches onError. Re-check on mount.
  useEffect(() => {
    const el = mediaRef.current
    if (el === null) return
    if (el instanceof HTMLVideoElement && el.error !== null) setErrored(true)
    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth === 0) setErrored(true)
  }, [])
  const base = cn(
    'flex aspect-video w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-800 bg-zinc-900',
    className,
  )

  if (file.path === null || errored) {
    return (
      <div className={base}>
        {errored ? (
          <Clapperboard className="size-6 text-zinc-700" strokeWidth={1.5} />
        ) : (
          <PlaceholderIcon kind={file.kind} />
        )}
      </div>
    )
  }

  if (file.kind === 'image') {
    return (
      <div className={base}>
        <img
          ref={attachMediaRef}
          src={mediaSrc(file.path)}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => {
            setErrored(true)
          }}
        />
      </div>
    )
  }

  if (file.kind === 'video') {
    return (
      <div className={base}>
        <video
          ref={attachMediaRef}
          src={mediaSrc(file.path)}
          muted
          playsInline
          preload="metadata"
          className="size-full object-cover"
          onError={() => {
            setErrored(true)
          }}
        />
      </div>
    )
  }

  return (
    <div className={base}>
      <PlaceholderIcon kind={file.kind} />
    </div>
  )
}
