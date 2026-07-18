import { createFileRoute } from '@tanstack/react-router'
import { handleMediaRequest } from '../../lib/server/media-handler'

// See src/lib/server/media-handler.ts — the same handler is also registered as
// a specific nitro route (server/routes/api/media.get.ts), which is the one
// browsers actually hit for <img>/<video> requests.

export const Route = createFileRoute('/api/media')({
  server: {
    handlers: {
      GET: ({ request }) => handleMediaRequest(request),
    },
  },
})
