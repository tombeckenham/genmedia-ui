import { FileQuestion, ImageOff, Music, Box } from 'lucide-react'
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
// /api/media; anything without a local path falls back to a kind icon.
export function MediaThumb({ file, className }: { file: GalleryFile; className?: string }) {
  const base = cn(
    'flex aspect-video w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-800 bg-zinc-900',
    className,
  )

  if (file.path === null) {
    return (
      <div className={base}>
        <PlaceholderIcon kind={file.kind} />
      </div>
    )
  }

  if (file.kind === 'image') {
    return (
      <div className={base}>
        <img src={mediaSrc(file.path)} alt="" loading="lazy" className="size-full object-cover" />
      </div>
    )
  }

  if (file.kind === 'video') {
    return (
      <div className={base}>
        <video
          src={mediaSrc(file.path)}
          muted
          playsInline
          preload="metadata"
          className="size-full object-cover"
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
