import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ApiClientProvider } from '../../lib/api/client-context.tsx'
import { createFakeApiClient, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { WorkspaceSwitcher } from './workspace-switcher.tsx'

const workspace = (id: string, name: string) => ({
  id,
  unitId: 'unit-1',
  name,
  slug: name.toLowerCase(),
  createdAt: '2026-01-01T00:00:00.000Z',
  unit: { id: 'unit-1', name: 'Acme group', path: ['Acme group'] },
})

function renderSwitcher(routes: FakeRoutes) {
  // The root must render an `Outlet` for a navigation away from `/` to show
  // anything — see `new-document-dialog.test.tsx` for the same fix.
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <WorkspaceSwitcher activeWorkspaceId="acme" activeWorkspaceName="Acme" />,
  })
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug',
    component: () => <p>workspace page</p>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, workspaceRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <ApiClientProvider client={createFakeApiClient(routes)}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiClientProvider>,
  )
}

describe('WorkspaceSwitcher', () => {
  it('is the workspace name, not a control, when there is only one', async () => {
    renderSwitcher({ 'GET /api/workspaces': () => jsonResponse(200, [workspace('acme', 'Acme')]) })

    expect(await screen.findByText('Acme')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('offers every workspace the person can see, and switches to the chosen one', async () => {
    renderSwitcher({
      'GET /api/workspaces': () =>
        jsonResponse(200, [workspace('acme', 'Acme'), workspace('globex', 'Globex')]),
    })

    const select = await screen.findByRole('combobox', { name: 'Switch workspace' })
    await userEvent.selectOptions(select, 'globex')

    expect(await screen.findByText('workspace page')).toBeInTheDocument()
  })
})
