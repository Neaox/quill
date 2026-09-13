import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { render } from '@testing-library/react'

import { createAppRouter, type AppRouter } from '../../app/router.tsx'
import { ApiClientProvider } from './client-context.tsx'
import { createQueryClient } from './query-client.ts'
import { createFakeApiClient, type FakeRoutes } from './testing.ts'

/**
 * Mounts the **application's own router** — `createAppRouter`, the same
 * options `app/app.tsx` runs with, over the generated route tree — behind a
 * fake `ApiClient` and a fresh `QueryClient` from `createQueryClient`, at a
 * chosen starting path.
 *
 * Building a second `createRouter` here would have meant the preloading
 * policy, the pending component and its delays, the scroll behaviour, and the
 * cache's retry and 401 rules were exercised by nothing: every routing test
 * would pass against a router the application never runs. The one thing this
 * substitutes is the history, which is what `createAppRouter`'s `history`
 * parameter is for.
 *
 * The generated route tree is committed, so this needs none of the Vite
 * plugin that writes it: the components are the ones in the route files,
 * loaded eagerly, which is what a test wants anyway.
 */
export function renderApp(initialPath: string, routes: FakeRoutes = {}) {
  const apiClient = createFakeApiClient(routes)
  // The same cycle the real composition root has, wired the same way: the
  // handler closes over a slot the router fills on the next line.
  let router: AppRouter | undefined
  const queryClient = createQueryClient({
    onUnauthorized: () => {
      if (router === undefined) return
      void router.navigate({
        to: '/sign-in',
        search: { redirect: router.state.location.href },
      })
    },
  })
  router = createAppRouter(
    { queryClient, apiClient },
    createMemoryHistory({ initialEntries: [initialPath] }),
  )

  const view = render(
    <ApiClientProvider client={apiClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiClientProvider>,
  )

  return { ...view, router, queryClient, apiClient }
}
