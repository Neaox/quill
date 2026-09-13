import { afterEach, describe, expect, it } from 'vitest'

import { ApiError } from './errors.ts'
import { clearSessionState, createQueryClient } from './query-client.ts'
import { queryKeys } from './query-keys.ts'

/**
 * The task's "401 handling that redirects to sign-in and preserves the
 * return path" requirement, at the layer that actually implements it:
 * `createQueryClient`'s global `onError` (`query-client.ts`). The router's
 * own `beforeLoad` redirect (`app/router.tsx`) covers a first, unauthenticated
 * visit; this covers a session that lapses mid-use, on any query or mutation.
 */
describe('createQueryClient 401 handling', () => {
  afterEach(() => {
    window.history.pushState(null, '', '/')
  })

  it('calls the handler when a query throws a session-ending 401', async () => {
    let calls = 0
    const queryClient = createQueryClient({
      onUnauthorized: () => {
        calls += 1
      },
    })

    await queryClient
      .fetchQuery({
        queryKey: ['boom'],
        queryFn: () => {
          throw new ApiError(401, { code: 'session_expired', message: 'expired' })
        },
      })
      .catch(() => {
        // Expected: `fetchQuery` rejects too. The redirect is asserted below.
      })

    expect(calls).toBe(1)
  })

  it('does not redirect a rejected sign-in attempt back to sign-in', async () => {
    let calls = 0
    const queryClient = createQueryClient({
      onUnauthorized: () => {
        calls += 1
      },
    })

    await queryClient
      .fetchQuery({
        queryKey: ['invalid-credentials'],
        queryFn: () => {
          throw new ApiError(401, { code: 'invalid_credentials', message: 'no' })
        },
      })
      .catch(() => {})

    expect(calls).toBe(0)
  })

  it('does not redirect for an error that is not a 401', async () => {
    const seen: string[] = []
    const queryClient = createQueryClient({
      onUnauthorized: () => {
        seen.push('called')
      },
    })

    await queryClient
      .fetchQuery({
        queryKey: ['not-boom'],
        queryFn: () => {
          throw new ApiError(500, { code: 'internal_error', message: 'oops' })
        },
      })
      .catch(() => {})

    expect(seen).toEqual([])
  })

  it('keeps one handler per client, so a second client cannot redirect the first one’s router', async () => {
    const first: string[] = []
    const second: string[] = []
    const firstClient = createQueryClient({
      onUnauthorized: () => {
        first.push('first')
      },
    })
    createQueryClient({
      onUnauthorized: () => {
        second.push('second')
      },
    })

    await firstClient
      .fetchQuery({
        queryKey: ['per-client'],
        queryFn: () => {
          throw new ApiError(401, { code: 'session_expired', message: 'expired' })
        },
      })
      .catch(() => {})

    expect(first).toHaveLength(1)
    expect(second).toEqual([])
  })

  it('does nothing when no handler has been given', async () => {
    const queryClient = createQueryClient()
    await expect(
      queryClient.fetchQuery({
        queryKey: ['unregistered'],
        queryFn: () => {
          throw new ApiError(401, { code: 'session_expired', message: 'expired' })
        },
      }),
    ).rejects.toBeInstanceOf(ApiError)
  })
})

describe('clearSessionState', () => {
  it('leaves nothing of the signed-out account behind, search results included', () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(queryKeys.me, { id: 'user-1' })
    // The broadest thing in the cache: search deliberately spans every
    // workspace the principal could read (quill-plan.md section 15), so a hit
    // surviving sign-out would show the next account the previous one's
    // document titles and snippets.
    queryClient.setQueryData(queryKeys.search('ws-1', 'failover', null), {
      query: 'failover',
      current: [{ title: 'Regional failover' }],
      elsewhere: [],
    })
    queryClient.setQueryData(queryKeys.workspaceTree('ws-1'), { collections: [] })

    clearSessionState(queryClient)

    expect(queryClient.getQueryData(queryKeys.me)).toBeUndefined()
    expect(queryClient.getQueryData(queryKeys.search('ws-1', 'failover', null))).toBeUndefined()
    expect(queryClient.getQueryData(queryKeys.workspaceTree('ws-1'))).toBeUndefined()
    expect(queryClient.getQueryCache().getAll()).toEqual([])
  })
})
