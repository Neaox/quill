import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { ApiClientProvider } from '../../lib/api/client-context.tsx'
import { createFakeApiClient, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { WorkspaceTree } from './workspace-navigation.tsx'

/**
 * The sidebar is drawn from `GET /workspaces/:id/tree` — the one route that
 * knows a collection's name, the collections' order, and which document is
 * nested under which — so that is what these fake it with.
 */
/** Each document's ten-character public handle, which its address is built on (ADR-035). */
const KEYS: Readonly<Record<string, string>> = {
  'doc-1': 'k7m3q9v2rt',
  'doc-3': 'p4n8w2cx5b',
}

const treeNode = (id: string, title: string, children: unknown[] = []) => ({
  id,
  shortId: KEYS[id] ?? 'z0z0z0z0z0',
  title,
  slug: title.toLowerCase().replaceAll(' ', '-'),
  status: 'draft',
  children,
})

const TREE = () =>
  jsonResponse(200, {
    collections: [
      {
        id: 'col-guides',
        name: 'Guides',
        slug: 'guides',
        documents: [treeNode('doc-1', 'Quarterly plan', [treeNode('doc-3', 'Appendix')])],
      },
      { id: 'col-archive', name: 'Archive', slug: 'archive', documents: [] },
    ],
  })

function createdDocumentResponse(overrides: {
  id: string
  collectionId: string
  parentId?: string
}) {
  return jsonResponse(201, {
    document: {
      id: overrides.id,
      workspaceId: 'workspace-1',
      collectionId: overrides.collectionId,
      parentId: overrides.parentId ?? null,
      slug: 'sub-section',
      path: 'guides/sub-section.md',
      title: 'Sub-section',
      status: 'draft',
      templateId: null,
      templateVersion: null,
      headRevision: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    draft: {
      documentId: overrides.id,
      draftVersion: 0,
      baseRevision: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    requiredSections: [],
    warnings: [],
  })
}

/**
 * `NewDocumentDialog` (which `WorkspaceTree` owns several openers of) navigates
 * to the created document on success, so this needs a real router underneath
 * it — the same shape `new-document-dialog.test.tsx` uses — rather than the
 * plain API-and-query wrapper most of this directory's tests get by with.
 */
function renderTree(
  props: Partial<Parameters<typeof WorkspaceTree>[0]> = {},
  routes: FakeRoutes = {},
) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <WorkspaceTree
        workspaceSlug="acme"
        workspaceId="workspace-1"
        workspaceName="Acme docs"
        {...props}
      />
    ),
  })
  const documentRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/d/$documentId',
    component: () => <h1>Document page</h1>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, documentRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const apiClient = createFakeApiClient({ 'GET /api/workspaces/{id}/tree': TREE, ...routes })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <ApiClientProvider client={apiClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiClientProvider>,
  )
  return { ...view, router }
}

describe('WorkspaceTree navigation', () => {
  it('navigates through the router on click, rather than a full page reload', async () => {
    const { router } = renderTree()

    await userEvent.click(await screen.findByRole('link', { name: 'Quarterly plan' }))

    // A plain `<a href>` (the bug: `packages/ui`'s `Tree` defaulting to one,
    // with no router underneath to intercept the click) would leave the
    // in-memory router exactly where it started — jsdom does not actually
    // reload the page, it just does nothing, which is indistinguishable from
    // "worked" unless the router's own state is checked.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/w/acme/d/quarterly-plan-${KEYS['doc-1'] ?? ''}`)
    })
    expect(await screen.findByRole('heading', { name: 'Document page' })).toBeInTheDocument()
  })

  it('nests a child document under its parent, as the tree route says', async () => {
    renderTree()

    const parent = await screen.findByRole('link', { name: 'Quarterly plan' })
    const child = screen.getByRole('link', { name: 'Appendix' })
    // The nesting is the list structure, not a class: the child's list is
    // inside the parent's item.
    expect(parent.closest('li')?.contains(child)).toBe(true)
  })

  it('keeps the collections in the order the tree route returned them', async () => {
    renderTree()

    await screen.findByText('Guides')
    const labels = screen.getAllByText(/^(Guides|Archive)$/).map((node) => node.textContent)
    expect(labels).toEqual(['Guides', 'Archive'])
  })
})

describe('WorkspaceTree creation entry points', () => {
  it('opens New document from the sidebar control', async () => {
    renderTree()

    await userEvent.click(await screen.findByRole('button', { name: 'New' }))

    expect(await screen.findByRole('dialog', { name: 'New document' })).toBeInTheDocument()
  })

  it('opens New document preset to a collection from its "+"', async () => {
    renderTree()

    await userEvent.click(await screen.findByRole('button', { name: 'New document in Guides' }))

    const dialog = await screen.findByRole('dialog', { name: 'New document' })
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Collection')).toHaveValue('col-guides')
    })
  })

  it('creates a child document from a row\'s "New child document", preset to its parent and collection', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderTree(
      {},
      {
        'POST /api/workspaces/{workspaceId}/documents': async (request) => {
          bodies.push((await request.json()) as Record<string, unknown>)
          return createdDocumentResponse({
            id: 'doc-2',
            collectionId: 'col-guides',
            parentId: 'doc-1',
          })
        },
      },
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for Quarterly plan' }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'New child document' }))

    const dialog = await screen.findByRole('dialog', { name: 'New document' })
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Collection')).toHaveValue('col-guides')
    })
    await userEvent.type(within(dialog).getByLabelText('Title', { exact: false }), 'Sub-section')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(bodies).toEqual([
        { title: 'Sub-section', collectionId: 'col-guides', parentId: 'doc-1' },
      ])
    })
  })

  it('opens New document on the "c" shortcut, but not while typing in a field', async () => {
    renderTree()
    await screen.findByRole('button', { name: 'New' })

    await userEvent.keyboard('c')
    expect(await screen.findByRole('dialog', { name: 'New document' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    const titleField = document.createElement('input')
    document.body.appendChild(titleField)
    titleField.focus()
    await userEvent.keyboard('c')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    titleField.remove()
  })

  it('has no axe violations', async () => {
    const { container } = renderTree()
    await screen.findByRole('button', { name: 'New' })

    await expectNoAccessibilityViolations(container)
  })
})

describe('WorkspaceTree collection flows', () => {
  it('creates a collection from the "+" beside the workspace heading', async () => {
    const names: string[] = []
    renderTree(
      {},
      {
        'POST /api/workspaces/{id}/collections': async (request) => {
          const body = (await request.json()) as { name: string }
          names.push(body.name)
          return jsonResponse(201, {
            id: 'col-new',
            workspaceId: 'workspace-1',
            name: body.name,
            slug: 'runbooks',
            createdAt: '2026-01-01T00:00:00.000Z',
          })
        },
      },
    )

    await userEvent.click(await screen.findByRole('button', { name: 'New collection' }))
    const dialog = await screen.findByRole('dialog', { name: 'New collection' })
    await userEvent.type(within(dialog).getByLabelText('Name', { exact: false }), 'Runbooks')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(names).toEqual(['Runbooks'])
    })
  })

  it('renames a collection from its overflow menu', async () => {
    const renames: string[] = []
    renderTree(
      {},
      {
        'PATCH /api/collections/{id}': async (request) => {
          const body = (await request.json()) as { name: string }
          renames.push(body.name)
          return jsonResponse(200, {
            id: 'col-guides',
            workspaceId: 'workspace-1',
            name: body.name,
            slug: 'guides',
            createdAt: '2026-01-01T00:00:00.000Z',
          })
        },
      },
    )

    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Guides' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }))

    const dialog = await screen.findByRole('dialog', { name: /Rename/ })
    const field = within(dialog).getByLabelText('Name', { exact: false })
    await userEvent.clear(field)
    await userEvent.type(field, 'Handbooks')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(renames).toEqual(['Handbooks'])
    })
  })

  it('refuses to delete a collection that still holds documents, and says why', async () => {
    renderTree()

    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Guides' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))

    const dialog = await screen.findByRole('dialog', { name: /Delete/ })
    // Two documents, counting the one nested inside the other.
    expect(within(dialog).getByText(/still holds 2 documents/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Move documents first' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('deletes an empty collection', async () => {
    const deleted: string[] = []
    renderTree(
      {},
      {
        'DELETE /api/collections/{id}': (_request, params) => {
          deleted.push(params['id'] ?? '')
          return new Response(null, { status: 204 })
        },
      },
    )

    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Archive' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))

    const dialog = await screen.findByRole('dialog', { name: /Delete/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleted).toEqual(['col-archive'])
    })
  })
})
