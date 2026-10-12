import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { ApiError, isTransientFailure, retryAfterOf } from './errors.ts'

/**
 * `invalid_credentials` is `useSignIn` rejecting the password someone just
 * typed on the sign-in form itself — a normal, user-facing outcome, not a
 * lapsed session, and redirecting to sign-in *from* sign-in on a failed
 * attempt would trap the form in a loop back to itself. Every other 401
 * (`unauthenticated`, `session_expired`) means the session that was making
 * the request is gone.
 */
const SESSION_INDEPENDENT_401_CODES = new Set(['invalid_credentials'])

/**
 * Called when a query or mutation discovers the session is gone.
 *
 * It is an option on the client rather than a module-level slot, because a
 * module-level slot is one handler for every `QueryClient` in the process:
 * the second `App` a test file mounts would silently redirect the first one's
 * router. One client, one handler, both built in the same composition root
 * (`app/app.tsx`).
 *
 * It takes no argument on purpose. Where to come back to is the *router's*
 * location, and the router is what the handler already closes over; reading
 * `window.location` here would be this module reaching for a browser global to
 * answer a question the router answers exactly.
 */
export type UnauthorizedHandler = () => void

export interface QueryClientOptions {
  readonly onUnauthorized?: UnauthorizedHandler | undefined
}

function handleError(error: unknown, onUnauthorized: UnauthorizedHandler | undefined): void {
  if (
    error instanceof ApiError &&
    error.status === 401 &&
    !SESSION_INDEPENDENT_401_CODES.has(error.code)
  ) {
    onUnauthorized?.()
  }
}

const QUERY_RETRIES = 2

/**
 * TanStack Query's own exponential backoff (1s, 2s, 4s, capped at 30s), with
 * jitter so every tab that lost the server does not come back in step, and
 * never sooner than the server's `Retry-After`.
 */
function queryRetryDelay(
  failureCount: number,
  retryAfter: number | null,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(1000 * 2 ** failureCount, 30_000)
  return Math.max(ceiling / 2 + (random() * ceiling) / 2, retryAfter ?? 0)
}

/**
 * One `QueryClient` for the app (ADR-013: server state lives in TanStack
 * Query). A 401 discovered by any query or mutation — not just the `me`
 * loader a route ran on entry — is routed to sign-in with the current
 * location preserved as the return path (task requirement: "401 handling
 * that redirects to sign-in and preserves the return path"), except a
 * rejected sign-in attempt itself (see `SESSION_INDEPENDENT_401_CODES`).
 */
export function createQueryClient({ onUnauthorized }: QueryClientOptions = {}): QueryClient {
  const onError = (error: unknown) => {
    handleError(error, onUnauthorized)
  }
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        // A 4xx will not succeed on retry, and neither will a 500. A request
        // that never arrived, a rate limit, and a gateway or server that is
        // restarting will (audit 2026-10-11, P0-2: a single 502 on a
        // background refresh used to fail the query outright).
        retry: (failureCount, error) => failureCount < QUERY_RETRIES && isTransientFailure(error),
        retryDelay: (failureCount, error) => queryRetryDelay(failureCount, retryAfterOf(error)),
      },
    },
  })
}

/**
 * Empties the cache on sign-out.
 *
 * **Everything**, not just `me`. The `QueryClient` lives for the life of the
 * page (`app/app.tsx`) and signing out is an in-page transition, so whatever
 * the previous account read is still in memory when the next one signs in;
 * with the default `staleTime` of zero a screen renders that cached answer
 * first and refetches after, which is long enough to show one person another
 * person's document titles. Every entry here is something the server decided
 * that principal could see, so none of it outlives the session.
 *
 * Search is what makes this urgent rather than tidy: it is the one surface
 * that deliberately spans every workspace the principal could read
 * (quill-plan.md §15), so its entries are the broadest disclosure in the
 * cache. Clearing the lot is also the idiomatic answer — a signed-out client
 * has no data — and needs no list of keys to keep up to date.
 */
export function clearSessionState(queryClient: QueryClient): void {
  queryClient.clear()
}
