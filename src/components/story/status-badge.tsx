import { cn } from '#/lib/utils'
import type { SceneStatus } from '#/db/schema'

// Scene/shot workflow status (draft → ready → generating → review → done),
// colored to match the legacy board's status language.
const STATUS_STYLES: Record<SceneStatus, string> = {
  draft: 'bg-zinc-700/50 text-zinc-300',
  ready: 'bg-blue-500/15 text-blue-300',
  generating: 'bg-amber-500/15 text-amber-300',
  review: 'bg-purple-500/15 text-purple-300',
  done: 'bg-teal-500/15 text-teal-300',
}

const STATUS_LABELS: Record<SceneStatus, string> = {
  draft: 'Draft',
  ready: 'Ready',
  generating: 'Generating',
  review: 'Review',
  done: 'Done',
}

export function StatusBadge({ status, className }: { status: SceneStatus; className?: string }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap',
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
