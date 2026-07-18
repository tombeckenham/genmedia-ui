import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { concatTakes } from '#/lib/export/concat'
import { slugifyTitle, type SequenceItem } from '#/lib/export/sequence'
import { cn } from '#/lib/utils'

type Phase = 'idle' | 'fetching' | 'encoding'

// Fetches each take's media, concatenates client-side (mediabunny), and triggers
// a download. Failures surface as a sonner toast — never silent.
export function ExportButton({ items, title }: { items: SequenceItem[]; title: string }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)

  const busy = phase !== 'idle'
  const disabled = busy || items.length === 0

  const runExport = async () => {
    setPhase('fetching')
    setProgress(0)
    try {
      const blobs: Blob[] = []
      for (const [index, item] of items.entries()) {
        const response = await fetch(item.url)
        if (!response.ok) {
          throw new Error(
            `Couldn't fetch take ${index + 1} of ${items.length} (HTTP ${response.status})`,
          )
        }
        blobs.push(await response.blob())
      }

      setPhase('encoding')
      const output = await concatTakes(blobs, {
        onProgress: (fraction) => {
          setProgress(fraction)
        },
      })

      const url = URL.createObjectURL(output)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${slugifyTitle(title)}.mp4`
      anchor.click()
      // Defer revocation: Safari/Firefox can abort the download if the URL is
      // revoked before the browser has started reading it.
      setTimeout(() => {
        URL.revokeObjectURL(url)
      }, 10_000)
      toast.success('Sequence exported', { description: `${items.length} scenes concatenated.` })
    } catch (error) {
      toast.error('Export failed', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPhase('idle')
      setProgress(0)
    }
  }

  const label =
    phase === 'fetching'
      ? 'Fetching takes…'
      : phase === 'encoding'
        ? `Encoding ${Math.round(progress * 100)}%`
        : 'Export mp4'

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        void runExport()
      }}
      className={cn(
        'flex items-center gap-2 rounded-md border border-teal-500/40 bg-teal-500/10 px-3 py-1.5 text-sm font-medium text-teal-200 transition-colors hover:bg-teal-500/20',
        disabled && 'cursor-not-allowed opacity-60 hover:bg-teal-500/10',
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      {label}
    </button>
  )
}
