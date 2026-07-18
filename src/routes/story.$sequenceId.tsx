import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { StoryBoard } from '#/components/story/story-board'
import { useStoryLiveEvents } from '#/components/story/use-story-live-events'
import { storySequenceQuery } from '#/lib/queries'

export const Route = createFileRoute('/story/$sequenceId')({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(storySequenceQuery(params.sequenceId))
  },
  component: StorySequencePage,
})

function StorySequencePage() {
  // Keep the SSE subscription alive so CLI writes (Claude storyboarding or
  // recording generations) stream straight into the board.
  useStoryLiveEvents()

  const { sequenceId } = Route.useParams()
  const { data: tree } = useSuspenseQuery(storySequenceQuery(sequenceId))

  if (tree === null) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-zinc-950 text-zinc-200">
        <p className="text-sm text-zinc-400">
          No sequence <span className="font-mono text-zinc-300">{sequenceId}</span> in this
          project's story database.
        </p>
        <Link to="/story" className="text-sm text-teal-400 hover:text-teal-300">
          Back to the library
        </Link>
      </div>
    )
  }

  return <StoryBoard tree={tree} />
}
