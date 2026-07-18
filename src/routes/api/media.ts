import { createFileRoute } from '@tanstack/react-router'
import { handleMediaRequest } from '../../lib/server/media-handler'

// See src/lib/server/media-handler.ts — the same handler is also registered as
// a specific nitro route (server/routes/api/media.get.ts) which takes
// precedence for ALL /api/media requests in both dev and prod; this file
// route just keeps the path in TanStack's route tree.

export const Route = createFileRoute('/api/media')({
  server: {
    handlers: {
      GET: ({ request }) => handleMediaRequest(request),
    },
  },
})
