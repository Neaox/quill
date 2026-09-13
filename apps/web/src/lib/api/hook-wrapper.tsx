import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { ApiClientProvider } from './client-context.tsx'
import { createFakeApiClient, type FakeRoutes } from './testing.ts'

/**
 * A `renderHook` wrapper for `src/lib/api`'s query and mutation hooks: a
 * fake `ApiClient` behind `ApiClientProvider`, and a fresh `QueryClient`
 * behind `QueryClientProvider`, per call.
 */
export function createHookWrapper(routes: FakeRoutes = {}) {
  const client = createFakeApiClient(routes)
  // `retry: false`: the default `QueryClient` retries a failing query three
  // times with backoff, which would make every error-path test either wait
  // several seconds or time out — see the TanStack Query testing guide.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <ApiClientProvider client={client}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    )
  }
}
