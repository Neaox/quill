import type { QueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

/**
 * Everything a route may reach for outside React: the query cache its loader
 * fills, and the generated API client that fills it. One shape, composed once
 * in `app/app.tsx` and once per test in `lib/api/render-app.tsx`.
 *
 * It lives in a module of its own rather than beside the router, because
 * `src/routes/__root.tsx` needs the type and `app/router.tsx` imports the
 * generated route tree that `__root.tsx` is part of — putting it in either
 * would make the two import each other.
 */
export interface RouterContext {
  readonly queryClient: QueryClient
  readonly apiClient: ApiClient
}
