import type { LucideIcon } from 'lucide-react'

// Shared inline empty-state card so the board and feed read as one system: a
// dashed zinc panel, a muted glyph, a title, and an optional hint that tells the
// user what to ask Claude to do next.
export function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon
  title: string
  hint?: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-10 text-center">
      <Icon className="size-7 text-zinc-600" strokeWidth={1.5} />
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {hint !== undefined && (
        <p className="max-w-xs text-xs leading-relaxed text-zinc-500">{hint}</p>
      )}
    </div>
  )
}
