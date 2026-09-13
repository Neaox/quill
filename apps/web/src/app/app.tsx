import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { useState } from 'react'

import { createApiClient } from '@quill/api-client'
import { Toaster } from '@quill/ui'

import { ApiClientProvider, createQueryClient } from '../lib/api/index.ts'
import { createAppRouter, type AppRouter } from './router.tsx'

/**
 * The composition root (rule 19): the API client, the query cache, and the
 * router, wired to each other once.
 *
 * Built per app instance with `useState`'s lazy initialiser (never
 * module-level): a module-level singleton would make every test that
 * imports `App` share one `QueryClient`/`ApiClient`/router across the whole
 * test file, which is exactly the cross-test leakage TanStack Query's own
 * testing guide warns against.
 *
 * The two have a genuine cycle — the router loads through the query client,
 * and the query client's 401 handler navigates the router — so the handler
 * closes over a slot that is filled one line later. The slot is *local to this
 * function*, so each app instance has its own; a module-level one would let
 * the second instance in a test file redirect the first one's router.
 */
function createAppInstance() {
  const apiClient = createApiClient()
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
  router = createAppRouter({ queryClient, apiClient })
  return { apiClient, queryClient, router }
}

export function App() {
  const [{ apiClient, queryClient, router }] = useState(createAppInstance)

  return (
    <ApiClientProvider client={apiClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {/*
          TODO(M3): docs/design/feedback.md calls for toasts stacking
          bottom-right on wide screens and bottom-centre on phones;
          `Toaster`'s `position` is a single fixed value with no responsive
          variant yet, so this pins the wide-screen placement everywhere
          until the primitive grows one.
        */}
        <Toaster position="bottom-right" />
      </QueryClientProvider>
    </ApiClientProvider>
  )
}
