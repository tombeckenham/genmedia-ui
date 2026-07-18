import { Link } from '@tanstack/react-router'
import { Box, Clapperboard, Film, MapPin, User } from 'lucide-react'
import { formatRelativeTime } from '#/lib/format'
import type { SequenceSummary } from '#/lib/server/story-queries'

function CountChip({
  icon: Icon,
  count,
  label,
}: {
  icon: typeof Film
  count: number
  label: string
}) {
  if (count === 0) return null
  return (
    <span
      title={`${count} ${label}`}
      className="flex items-center gap-1 rounded-full bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-400"
    >
      <Icon className="size-3" /> {count}
    </span>
  )
}

export function SequenceCard({ summary }: { summary: SequenceSummary }) {
  return (
    <Link
      to="/story/$sequenceId"
      params={{ sequenceId: summary.id }}
      className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-teal-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate text-base font-medium text-zinc-100">
          {summary.title}
        </h3>
        <span className="shrink-0 text-[11px] text-zinc-600" suppressHydrationWarning>
          {formatRelativeTime(summary.updatedAt)}
        </span>
      </div>
      {summary.logline !== '' ? (
        <p className="line-clamp-2 text-sm text-zinc-400">{summary.logline}</p>
      ) : (
        <p className="text-sm text-zinc-600 italic">No logline yet</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <CountChip icon={Film} count={summary.sceneCount} label="scenes" />
        <CountChip icon={Clapperboard} count={summary.shotCount} label="shots" />
        <CountChip icon={User} count={summary.characterCount} label="characters" />
        <CountChip icon={MapPin} count={summary.locationCount} label="locations" />
        <CountChip icon={Box} count={summary.elementCount} label="elements" />
        {summary.sceneCount === 0 && summary.shotCount === 0 && (
          <span className="text-[11px] text-zinc-600">Empty sequence — ready to storyboard</span>
        )}
      </div>
    </Link>
  )
}
