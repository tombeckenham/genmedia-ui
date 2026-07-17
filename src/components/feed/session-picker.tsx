import { Select, SelectContent, SelectItem, SelectTrigger } from '#/components/ui/select'
import { formatRelativeTime } from '#/lib/format'
import type { SessionSummary } from '#/lib/schemas/gallery'

function sessionLabel(session: SessionSummary): string {
  return session.label ?? session.session_id
}

export function SessionPicker({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: SessionSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const selected = sessions.find((s) => s.session_id === selectedId) ?? null

  return (
    <Select
      value={selectedId}
      onValueChange={(value) => {
        if (typeof value === 'string') onSelect(value)
      }}
    >
      <SelectTrigger size="default" className="min-w-56 bg-zinc-900 text-zinc-100">
        {selected === null ? (
          <span className="text-zinc-500">Select a session</span>
        ) : (
          <span className="truncate">{sessionLabel(selected)}</span>
        )}
      </SelectTrigger>
      <SelectContent className="bg-zinc-900 text-zinc-100">
        {sessions.map((session) => (
          <SelectItem key={session.session_id} value={session.session_id}>
            <span className="flex flex-col gap-0.5">
              <span className="truncate">{sessionLabel(session)}</span>
              <span className="text-[11px] text-zinc-500">
                {session.run_count} runs · {session.asset_count} assets ·{' '}
                <span suppressHydrationWarning>{formatRelativeTime(session.updated_at)}</span>
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
