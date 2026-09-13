import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiClientProvider } from '../../lib/api/client-context.tsx'
import type { DocumentDto } from '../../lib/api/index.ts'
import { createFakeApiClient } from '../../lib/api/testing.ts'
import { DocumentList } from './document-list.tsx'

function document(overrides: Partial<DocumentDto>): DocumentDto {
  return {
    id: 'doc-1',
    shortId: 'k7m3q9v2rt',
    workspaceId: 'workspace-1',
    collectionId: null,
    parentId: null,
    slug: 'doc',
    path: '/doc',
    title: 'Untitled',
    status: 'draft',
    templateId: null,
    templateVersion: null,
    headRevision: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** `DocumentList` renders links, which need a router; a one-route tree is enough. */
function renderDocumentList(documents: readonly DocumentDto[]) {
  const rootRoute = createRootRoute({
    component: () => <DocumentList workspaceSlug="acme" documents={documents} />,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const apiClient = createFakeApiClient({})
  const queryClient = new QueryClient()
  return render(
    <ApiClientProvider client={apiClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiClientProvider>,
  )
}

describe('DocumentList', () => {
  it('says there are no documents yet when the workspace is empty', async () => {
    renderDocumentList([])
    expect(await screen.findByText('This workspace has no documents yet.')).toBeInTheDocument()
  })

  it('groups documents by collection, with an "Uncategorised" group last', async () => {
    renderDocumentList([
      document({ id: 'a', title: 'Onboarding', collectionId: 'guides' }),
      document({ id: 'b', title: 'API reference', collectionId: 'reference' }),
      document({ id: 'c', title: 'Scratch notes', collectionId: null }),
    ])

    const headings = (await screen.findAllByRole('heading', { level: 2 })).map(
      (heading) => heading.textContent,
    )
    expect(headings).toEqual(['guides', 'reference', 'Uncategorised'])

    const guidesGroup = screen.getByRole('heading', { level: 2, name: 'guides' }).closest('section')
    expect(guidesGroup).not.toBeNull()
    expect(
      within(guidesGroup as HTMLElement).getByRole('link', { name: /Onboarding/ }),
    ).toBeInTheDocument()
  })

  it("shows each document's status as a badge", async () => {
    renderDocumentList([document({ title: 'Launch plan', status: 'published' })])
    expect(await screen.findByText('published')).toBeInTheDocument()
  })
})
