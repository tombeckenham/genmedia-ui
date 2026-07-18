import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

// Subscribe to the server-sent event stream published by /api/events (built by
// a teammate). Each message is JSON { scope: 'gallery' | 'storyboard' }; we map
// the scope onto the query keys that need refetching. Parsing is defensive —
// malformed frames are ignored, never thrown.
export function useLiveEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const source = new EventSource('/api/events')
    source.addEventListener('message', (event) => {
      const data: unknown = event.data
      if (typeof data !== 'string') return

      let scope: unknown
      try {
        const parsed: unknown = JSON.parse(data)
        if (parsed !== null && typeof parsed === 'object' && 'scope' in parsed) {
          scope = parsed.scope
        }
      } catch {
        return
      }

      if (scope === 'gallery') {
        void queryClient.invalidateQueries({ queryKey: ['sessions'] })
        void queryClient.invalidateQueries({ queryKey: ['active-session'] })
        void queryClient.invalidateQueries({ queryKey: ['session'] })
      } else if (scope === 'storyboard') {
        void queryClient.invalidateQueries({ queryKey: ['storyboard'] })
      }
    })

    // Events emitted while the connection was down are lost forever — resync
    // everything on every (re)connect so gaps can't leave the UI silently
    // stale. The initial open costs one redundant refetch round, that's fine.
    source.addEventListener('open', () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      void queryClient.invalidateQueries({ queryKey: ['active-session'] })
      void queryClient.invalidateQueries({ queryKey: ['session'] })
      void queryClient.invalidateQueries({ queryKey: ['storyboard'] })
    })

    source.addEventListener('error', () => {
      // EventSource auto-reconnects unless CLOSED; that state means the
      // browser gave up (e.g. non-200) and live updates are dead for good.
      if (source.readyState === EventSource.CLOSED) {
        console.warn('genmedia-ui: /api/events stream closed permanently; live updates disabled')
      }
    })

    return () => {
      source.close()
    }
  }, [queryClient])
}
