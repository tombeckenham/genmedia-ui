import { useMutation } from '@tanstack/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { BookOpen, LayoutGrid, Plus } from 'lucide-react'
import { useState } from 'react'
import { SequenceCard } from '#/components/story/sequence-card'
import { useInvalidateStory } from '#/components/story/use-story-invalidate'
import { useStoryLiveEvents } from '#/components/story/use-story-live-events'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Input } from '#/components/ui/input'
import { storySequencesQuery } from '#/lib/queries'
import { createSequence } from '#/lib/server/story-functions'

export const Route = createFileRoute('/story/')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(storySequencesQuery)
  },
  component: StoryLibrary,
})

function StoryLibrary() {
  useStoryLiveEvents()
  const navigate = useNavigate()
  const invalidate = useInvalidateStory()
  const { data: sequences } = useSuspenseQuery(storySequencesQuery)

  const [title, setTitle] = useState('')
  const createMutation = useMutation({
    mutationFn: (nextTitle: string) => createSequence({ data: { title: nextTitle } }),
    onSuccess: (sequence) => {
      invalidate()
      setTitle('')
      void navigate({ to: '/story/$sequenceId', params: { sequenceId: sequence.id } })
    },
  })

  const submit = () => {
    const trimmed = title.trim()
    if (trimmed === '' || createMutation.isPending) return
    createMutation.mutate(trimmed)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Story</h1>
          <p className="text-sm text-zinc-500">sequences in this project</p>
        </div>
        <Link
          to="/"
          className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900"
        >
          <LayoutGrid className="size-4" /> Mission Control
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Input
            value={title}
            placeholder="New sequence title…"
            aria-label="New sequence title"
            className="max-w-sm bg-zinc-900/60"
            onChange={(event) => {
              setTitle(event.target.value)
            }}
          />
          <Button
            type="submit"
            size="lg"
            disabled={title.trim() === '' || createMutation.isPending}
          >
            <Plus /> Create
          </Button>
          {createMutation.isError && (
            <span className="text-[11px] text-red-400">Create failed — try again.</span>
          )}
        </form>

        {sequences.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No sequences yet"
            hint="Create one above, or ask Claude to storyboard a script — it writes sequences, scenes, shots and entities straight into this project's story database."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sequences.map((summary) => (
              <SequenceCard key={summary.id} summary={summary} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
