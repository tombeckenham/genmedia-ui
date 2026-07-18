import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Storyboard } from './schemas/storyboard'
import { emptyStoryboard, storyboardSchema } from './schemas/storyboard'
import { useStoryboardMutation } from './storyboard-mutations'

vi.mock('./server/functions', () => ({
  getStoryboard: vi.fn(),
  updateStoryboard: vi.fn(),
}))

import { getStoryboard, updateStoryboard } from './server/functions'

const getStoryboardMock = vi.mocked(getStoryboard)
const updateStoryboardMock = vi.mocked(updateStoryboard)

function doc(updatedAt: number, title = 'base'): Storyboard {
  return { ...emptyStoryboard(title), updated_at: updatedAt }
}

function setup() {
  const queryClient = new QueryClient({
    // Instant retries so the conflict path resolves within the test.
    defaultOptions: { mutations: { retryDelay: 0 } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const rendered = renderHook(() => useStoryboardMutation(), { wrapper })
  return { queryClient, rendered }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useStoryboardMutation conflict handling', () => {
  it('re-derives the payload from a fresh disk read on conflict retry', async () => {
    const v1 = doc(1000)
    const v2 = doc(2000, 'claude-edited')
    getStoryboardMock.mockResolvedValueOnce(v1).mockResolvedValueOnce(v2)
    updateStoryboardMock
      .mockResolvedValueOnce({ conflict: true })
      // The input type is the zod INPUT shape (defaults optional); parse to the
      // output shape exactly like the real server fn does.
      .mockImplementationOnce((input) =>
        Promise.resolve({ conflict: false, doc: storyboardSchema.parse(input.data.storyboard) }),
      )

    const { rendered } = setup()
    rendered.result.current.mutate((d) => ({ ...d, title: `${d.title}+note` }))

    await waitFor(() => {
      expect(rendered.result.current.isSuccess).toBe(true)
    })

    expect(updateStoryboardMock).toHaveBeenCalledTimes(2)
    const second = updateStoryboardMock.mock.calls[1]?.[0]
    // The retry must be based on v2 (the doc Claude wrote), not stale v1.
    expect(second?.data.expected_updated_at).toBe(2000)
    expect(second?.data.storyboard.title).toBe('claude-edited+note')
  })

  it('rolls the optimistic cache back on a non-retryable error', async () => {
    const v1 = doc(1000)
    getStoryboardMock.mockResolvedValue(v1)
    updateStoryboardMock.mockRejectedValue(new Error('disk on fire'))

    const { queryClient, rendered } = setup()
    queryClient.setQueryData(['storyboard'], v1)

    rendered.result.current.mutate((d) => ({ ...d, title: 'optimistic' }))

    await waitFor(() => {
      expect(rendered.result.current.isError).toBe(true)
    })
    expect(updateStoryboardMock).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData<Storyboard>(['storyboard'])?.title).toBe('base')
  })
})
