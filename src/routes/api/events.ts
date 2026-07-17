import { createFileRoute } from '@tanstack/react-router'
import { subscribe, type ChangeScope } from '../../lib/server/watcher'

// Server-Sent Events endpoint. Streams one `data: {"scope":...}` message per
// debounced filesystem change so the UI can re-fetch gallery/storyboard state.

const HEARTBEAT_MS = 15_000

export const Route = createFileRoute('/api/events')({
  server: {
    handlers: {
      GET: ({ request }) => {
        let closed = false
        let unsubscribe: (() => void) | undefined
        let heartbeat: ReturnType<typeof setInterval> | undefined
        const encoder = new TextEncoder()

        const cleanup = (): void => {
          if (closed) return
          closed = true
          if (unsubscribe !== undefined) unsubscribe()
          if (heartbeat !== undefined) clearInterval(heartbeat)
        }

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (chunk: string): void => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(chunk))
              } catch {
                // The stream was closed underneath us; stop enqueuing.
                cleanup()
              }
            }

            // Tell the browser to reconnect after 1s, then confirm the channel
            // is live with a comment so proxies flush the response headers.
            send('retry: 1000\n\n')
            send(': connected\n\n')

            unsubscribe = subscribe((scope: ChangeScope) => {
              send(`data: ${JSON.stringify({ scope })}\n\n`)
            })

            heartbeat = setInterval(() => {
              send(': ping\n\n')
            }, HEARTBEAT_MS)
          },
          cancel() {
            cleanup()
          },
        })

        request.signal.addEventListener('abort', cleanup)

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      },
    },
  },
})
