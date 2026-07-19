import { AudioLines, ImageOff } from 'lucide-react'
import { mediaSrc } from '#/lib/media-path'
import { cn } from '#/lib/utils'
import type { Generation } from '#/db/schema'

// Renders one generation's asset through the /api/media handler. Paths in the
// generations table are absolute or project-relative — mediaSrc passes them
// through and the server resolves/validates.
export function GenerationMedia({
  generation,
  className,
  controls = false,
}: {
  generation: Generation
  className?: string
  controls?: boolean
}) {
  if (generation.kind === 'image') {
    return (
      <img
        src={mediaSrc(generation.path)}
        alt=""
        loading="lazy"
        className={cn('size-full object-cover', className)}
      />
    )
  }
  if (generation.kind === 'video') {
    return (
      <video
        src={mediaSrc(generation.path)}
        muted={!controls}
        playsInline
        preload="metadata"
        controls={controls}
        className={cn('size-full object-cover', className)}
      />
    )
  }
  return (
    <div className={cn('flex size-full items-center justify-center', className)}>
      {controls ? (
        <audio src={mediaSrc(generation.path)} controls className="w-full px-2" />
      ) : (
        <AudioLines className="size-5 text-zinc-500" strokeWidth={1.5} />
      )}
    </div>
  )
}

// Shared "nothing here yet" tile for frame/shot/entity thumbnails.
export function MediaPlaceholder({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex size-full flex-col items-center justify-center gap-1 text-zinc-600',
        className,
      )}
    >
      <ImageOff className="size-4" strokeWidth={1.5} />
      {label !== undefined && <span className="text-[10px] text-zinc-600">{label}</span>}
    </div>
  )
}
