import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { SequencePlayer } from '#/components/sequence/sequence-player'
import { storyboardQuery } from '#/lib/queries'
import { useLiveEvents } from '#/lib/use-live-events'

export const Route = createFileRoute('/sequence')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(storyboardQuery)
  },
  component: SequencePage,
})

function SequencePage() {
  // Keep the live subscription so selected-take / reorder edits reflow the movie.
  useLiveEvents()
  const { data: storyboard } = useSuspenseQuery(storyboardQuery)
  return <SequencePlayer storyboard={storyboard} />
}
