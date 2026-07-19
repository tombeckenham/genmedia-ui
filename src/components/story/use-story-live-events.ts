import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

// Live updates for the story routes. Same defensive pattern as
// src/lib/use-live-events.ts, but scoped to the story query keys so the story
// pages don't refetch the legacy gallery/storyboard state (and vice versa —
// the legacy hook keeps its own subscription). The server tags story frames
// with both { scope: 'story' } and { type: 'story-changed' }; we key on scope.
export function useStoryLiveEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['story-sequences'] })
      void queryClient.invalidateQueries({ queryKey: ['story-sequence'] })
    }

    const source = new EventSource('/api/events')
    source.addEventListener('message', (event) => {
      const data: unknown = event.data
      if (typeof data !== 'string') return

      let scope: unknown
      let type: unknown
      try {
        const parsed: unknown = JSON.parse(data)
        if (parsed !== null && typeof parsed === 'object') {
          if ('scope' in parsed) scope = parsed.scope
          if ('type' in parsed) type = parsed.type
        }
      } catch {
        return
      }

      if (scope === 'story' || type === 'story-changed') invalidate()
    })

    // Events emitted while the connection was down are lost — resync on every
    // (re)connect so gaps can't leave the board silently stale.
    source.addEventListener('open', invalidate)

    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        console.warn('genmedia-ui: /api/events stream closed permanently; live updates disabled')
      }
    })

    return () => {
      source.close()
    }
  }, [queryClient])
}
