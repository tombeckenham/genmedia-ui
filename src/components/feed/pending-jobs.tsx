import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { z } from 'zod'
import { jobQuery } from '#/lib/queries'
import type { Storyboard } from '#/lib/schemas/storyboard'
import { cn } from '#/lib/utils'

// genmedia `status --json` output — we only care about the status/error keys;
// everything else is ignored.
const jobStatusSchema = z.object({
  status: z.string().optional(),
  error: z.unknown().optional(),
})

type DisplayStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CHECKING'

function normalizeStatus(data: unknown): DisplayStatus | null {
  const parsed = jobStatusSchema.safeParse(data)
  if (!parsed.success) return null
  if (parsed.data.error !== undefined) return 'FAILED'
  switch (parsed.data.status?.toUpperCase()) {
    case 'IN_QUEUE':
      return 'IN_QUEUE'
    case 'IN_PROGRESS':
      return 'IN_PROGRESS'
    case 'COMPLETED':
      return 'COMPLETED'
    case 'FAILED':
    case 'ERROR':
      return 'FAILED'
    default:
      return null
  }
}

function isTerminal(status: DisplayStatus | null): boolean {
  return status === 'COMPLETED' || status === 'FAILED'
}

const CHIP_STYLES: Record<DisplayStatus, string> = {
  IN_QUEUE: 'bg-zinc-800 text-zinc-300',
  IN_PROGRESS: 'bg-amber-500/15 text-amber-300',
  COMPLETED: 'bg-teal-500/15 text-teal-300',
  FAILED: 'bg-red-500/15 text-red-300',
  CHECKING: 'bg-zinc-800 text-zinc-400',
}

const CHIP_LABELS: Record<DisplayStatus, string> = {
  IN_QUEUE: 'In queue',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Done · awaiting download',
  FAILED: 'Failed',
  CHECKING: 'Checking…',
}

function JobRow({
  endpointId,
  requestId,
  sceneTitle,
  completedInRuns,
}: {
  endpointId: string
  requestId: string
  sceneTitle: string
  completedInRuns: boolean
}) {
  // Once the request shows up in the session runs the CLI has downloaded the
  // result — stop polling and show it as done.
  const query = useQuery({
    ...jobQuery(endpointId, requestId),
    enabled: !completedInRuns,
    retry: 1,
    refetchInterval: (q) =>
      q.state.status === 'error' || isTerminal(normalizeStatus(q.state.data)) ? false : 3_000,
  })

  const status: DisplayStatus = completedInRuns
    ? 'COMPLETED'
    : query.isError
      ? 'FAILED'
      : (normalizeStatus(query.data) ?? (query.isPending ? 'CHECKING' : 'IN_PROGRESS'))

  const spinning = status !== 'COMPLETED' && status !== 'FAILED'

  return (
    <li className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
      <Loader2 className={cn('size-4 shrink-0 text-amber-300', spinning && 'animate-spin')} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-zinc-200">{sceneTitle}</span>
        <span className="truncate font-mono text-[11px] text-zinc-500">{endpointId}</span>
      </div>
      <span
        className={cn('shrink-0 rounded px-2 py-0.5 text-[11px] font-medium', CHIP_STYLES[status])}
      >
        {CHIP_LABELS[status]}
      </span>
    </li>
  )
}

// Flattens scenes[].pending[] into one spinner row per in-flight job, pinned
// above the runs feed.
export function PendingJobs({
  storyboard,
  completedRequestIds,
}: {
  storyboard: Storyboard | null
  completedRequestIds: Set<string>
}) {
  const jobs = (storyboard?.scenes ?? []).flatMap((scene) =>
    scene.pending.map((job) => ({
      key: `${scene.id}:${job.request_id}`,
      sceneTitle: scene.title,
      endpointId: job.endpoint_id,
      requestId: job.request_id,
    })),
  )

  if (jobs.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">In flight</h2>
      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <JobRow
            key={job.key}
            endpointId={job.endpointId}
            requestId={job.requestId}
            sceneTitle={job.sceneTitle}
            completedInRuns={completedRequestIds.has(job.requestId)}
          />
        ))}
      </ul>
    </section>
  )
}
