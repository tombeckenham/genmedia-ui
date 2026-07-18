import { createFileRoute, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { Flipper } from '#/components/flipper/flipper'
import { storyboardQuery } from '#/lib/queries'
import { useLiveEvents } from '#/lib/use-live-events'

// Optional deep-link to a specific take within the scene. Defaults (resolved in
// the flipper) to the scene's selected take, then its first take.
const searchSchema = z.object({
  take: z.string().optional(),
})

export const Route = createFileRoute('/scene/$sceneId')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(storyboardQuery)
  },
  component: SceneFlipperPage,
})

function SceneFlipperPage() {
  // Keep the live SSE subscription alive here too, so external edits (Claude
  // adding takes, another tab starring) flow into this view.
  useLiveEvents()

  const { sceneId } = Route.useParams()
  const { data: storyboard } = useSuspenseQuery(storyboardQuery)
  const scene = storyboard?.scenes.find((s) => s.id === sceneId)

  if (scene === undefined) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black text-zinc-200">
        <p className="text-sm text-zinc-400">
          No scene <span className="font-mono text-zinc-300">{sceneId}</span> in the storyboard.
        </p>
        <Link to="/" className="text-sm text-teal-400 hover:text-teal-300">
          Back to the board
        </Link>
      </div>
    )
  }

  return <Flipper scene={scene} />
}
