import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

// Story mutations write through server fns and then refetch — the DB is the
// single source of truth, so no optimistic cache surgery: invalidate both the
// library list and every open sequence tree.
export function useInvalidateStory(): () => void {
  const queryClient = useQueryClient()
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['story-sequences'] })
    void queryClient.invalidateQueries({ queryKey: ['story-sequence'] })
  }, [queryClient])
}
