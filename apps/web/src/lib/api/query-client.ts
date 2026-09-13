import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { ApiError } from './errors.ts'
import { queryKeys } from './query-keys.ts'

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
        // A 401/403/404/409/423 will not succeed on retry; only a transient
        // network failure might, and TanStack Query's default backoff
        // already covers that case for the one status worth retrying.
        retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 2,
      },
    },
  })
}

/** Removes everything that depends on who is signed in. Called on sign-out. */
export function clearSessionState(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: queryKeys.me })
}
