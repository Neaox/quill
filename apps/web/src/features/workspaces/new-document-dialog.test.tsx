import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Button } from '@quill/ui'

import { ApiClientProvider } from '../../lib/api/client-context.tsx'
import { createFakeApiClient, errorResponse, jsonResponse } from '../../lib/api/testing.ts'
import { NewDocumentDialog } from './new-document-dialog.tsx'

const TREE_WITH_ONE_COLLECTION = () =>
  jsonResponse(200, {
    collections: [{ id: 'col-guides', name: 'Guides', slug: 'guides', documents: [] }],
  })

/**
 * A workspace with a Templates collection, which is what makes a template a
 * template (ADR-029): there is no templates route, and there does not need to
 * be one.
 */
const TREE_WITH_TEMPLATES = () =>
  jsonResponse(200, {
    collections: [
      { id: 'col-guides', name: 'Guides', slug: 'guides', documents: [] },
      {
        id: 'col-templates',
        name: 'Templates',
        slug: 'templates',
        documents: [
          {
            id: 'tmpl-adr',
            title: 'Decision record',
            slug: 'adr',
            status: 'published',
            children: [],
          },
          { id: 'tmpl-draft', title: 'Half-written', slug: 'wip', status: 'draft', children: [] },
        ],
      },
    ],
  })

const ADR_TEMPLATE = () =>
  jsonResponse(200, {
    revision: 'a'.repeat(40),
    markdown: '# Decision record',
    frontMatter: {
      template: {
        name: 'Decision record',
        questions: [
          {
            id: 'status',
            label: 'Initial status',
            type: 'choice',
            options: ['proposed', 'accepted'],
            default: 'proposed',
          },
          { id: 'securityReview', label: 'Touches secrets?', type: 'boolean' },
        ],
      },
    },
  })

function createDocumentResponse(overrides: { id: string; collectionId: string; title: string }) {
  return jsonResponse(201, {
    document: {
      id: overrides.id,
      workspaceId: 'workspace-1',
      collectionId: overrides.collectionId,
      parentId: null,
      slug: 'quarterly-plan',
      path: 'guides/quarterly-plan.md',
      title: overrides.title,
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

function renderDialog(routes: Parameters<typeof createFakeApiClient>[0]) {
  // The root route must render an `Outlet` for a navigation away from `/` to
  // show anything: a root whose own component *is* the page (no `Outlet`)
  // never displays a matched child, which is exactly what the dialog's
  // post-create navigation needs to prove.
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <NewDocumentDialog
        workspaceId="workspace-1"
        workspaceSlug="acme"
        trigger={<Button>New document</Button>}
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
  const apiClient = createFakeApiClient(routes)
  const queryClient = new QueryClient()
  return render(
    <ApiClientProvider client={apiClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiClientProvider>,
  )
}

function ControlledHarness() {
  const [open, setOpen] = useState(true)
  return (
    <NewDocumentDialog
      workspaceId="workspace-1"
      workspaceSlug="acme"
      open={open}
      onOpenChange={setOpen}
      initialCollectionId="col-guides"
    />
  )
}

describe('NewDocumentDialog', () => {
  it('creates a document in the chosen collection and navigates to it', async () => {
    renderDialog({
      'GET /api/workspaces/{id}/tree': TREE_WITH_ONE_COLLECTION,
      'POST /api/workspaces/{workspaceId}/documents': async (request) => {
        const body = (await request.json()) as { collectionId: string; title: string }
        expect(body.collectionId).toBe('col-guides')
        return createDocumentResponse({
          id: 'doc-9',
          collectionId: 'col-guides',
          title: body.title,
        })
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'New document' }))
    await userEvent.type(await screen.findByLabelText('Title', { exact: false }), 'Quarterly plan')
    await userEvent.selectOptions(await screen.findByLabelText('Collection'), 'col-guides')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('heading', { name: 'Document page' })).toBeInTheDocument()
  })

  it('shows the server error and keeps the dialog open when creation fails', async () => {
    renderDialog({
      'GET /api/workspaces/{id}/tree': TREE_WITH_ONE_COLLECTION,
      'POST /api/workspaces/{workspaceId}/documents': () =>
        errorResponse(403, 'forbidden', 'Workspace admin required'),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'New document' }))
    await userEvent.type(await screen.findByLabelText('Title', { exact: false }), 'Quarterly plan')
    await userEvent.selectOptions(await screen.findByLabelText('Collection'), 'col-guides')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace admin required')
    expect(screen.getByRole('dialog', { name: 'New document' })).toBeInTheDocument()
  })

  it('disables Create until a title is entered', async () => {
    renderDialog({ 'GET /api/workspaces/{id}/tree': TREE_WITH_ONE_COLLECTION })
    await userEvent.click(await screen.findByRole('button', { name: 'New document' }))
    expect(await screen.findByRole('button', { name: 'Create' })).toBeDisabled()

    // A collection is chosen the moment one exists (below) — nothing
    // interactive sits disabled with no explanation, per
    // docs/design/feedback.md — so a title is all that is left to enable it.
    await userEvent.type(screen.getByLabelText('Title', { exact: false }), 'X')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
    })
  })

  it('preselects the workspace’s first collection, changeably, so Create is never disabled for an unexplained reason', async () => {
    renderDialog({ 'GET /api/workspaces/{id}/tree': TREE_WITH_TEMPLATES })
    await userEvent.click(await screen.findByRole('button', { name: 'New document' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Collection')).toHaveValue('col-guides')
    })

    await userEvent.selectOptions(screen.getByLabelText('Collection'), 'col-templates')
    expect(screen.getByLabelText('Collection')).toHaveValue('col-templates')
  })

  it('closes without creating anything when Cancel is clicked', async () => {
    renderDialog({ 'GET /api/workspaces/{id}/tree': TREE_WITH_ONE_COLLECTION })
    await userEvent.click(await screen.findByRole('button', { name: 'New document' }))
    await screen.findByRole('dialog', { name: 'New document' })

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('offers the workspace’s published templates, and a blank document', async () => {
    renderDialog({
      'GET /api/workspaces/{id}/tree': TREE_WITH_TEMPLATES,
      'GET /api/documents/{id}/content': ADR_TEMPLATE,
    })

    await userEvent.click(await screen.findByRole('button', { name: 'New document' }))
    const startFrom = await screen.findByLabelText('Start from')

    // An unpublished template has nothing to instantiate, so it is not offered.
    expect([...startFrom.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Blank document',
      'Decision record',
    ])
  })

  it('asks the template’s own questions and sends the answers', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderDialog({
      'GET /api/workspaces/{id}/tree': TREE_WITH_TEMPLATES,
      'GET /api/documents/{id}/content': ADR_TEMPLATE,
      'POST /api/workspaces/{workspaceId}/documents': async (request) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return createDocumentResponse({
          id: 'doc-10',
          collectionId: 'col-guides',
          title: 'Use Postgres',
        })
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'New document' }))
    await userEvent.type(await screen.findByLabelText('Title', { exact: false }), 'Use Postgres')
    await userEvent.selectOptions(await screen.findByLabelText('Collection'), 'col-guides')
    await userEvent.selectOptions(await screen.findByLabelText('Start from'), 'tmpl-adr')

    await userEvent.selectOptions(await screen.findByLabelText('Initial status'), 'accepted')
    await userEvent.click(screen.getByLabelText('Touches secrets?'))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('heading', { name: 'Document page' })).toBeInTheDocument()
    expect(bodies).toEqual([
      {
        title: 'Use Postgres',
        collectionId: 'col-guides',
        templateId: 'tmpl-adr',
        answers: { status: 'accepted', securityReview: true },
      },
    ])
  })

  it('creates a blank document when no template is chosen, with no templateId at all', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderDialog({
      'GET /api/workspaces/{id}/tree': TREE_WITH_TEMPLATES,
      'POST /api/workspaces/{workspaceId}/documents': async (request) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return createDocumentResponse({
          id: 'doc-11',
          collectionId: 'col-guides',
          title: 'Notes',
        })
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'New document' }))
    await userEvent.type(await screen.findByLabelText('Title', { exact: false }), 'Notes')
    await userEvent.selectOptions(await screen.findByLabelText('Collection'), 'col-guides')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('heading', { name: 'Document page' })).toBeInTheDocument()
    expect(bodies).toEqual([{ title: 'Notes', collectionId: 'col-guides' }])
  })

  it('offers no template picker at all in a workspace that has none', async () => {
    renderDialog({ 'GET /api/workspaces/{id}/tree': TREE_WITH_ONE_COLLECTION })

    await userEvent.click(await screen.findByRole('button', { name: 'New document' }))
    await screen.findByLabelText('Collection')

    expect(screen.queryByLabelText('Start from')).not.toBeInTheDocument()
  })

  it('says so and disables Create when the workspace has no collections yet', async () => {
    renderDialog({ 'GET /api/workspaces/{id}/tree': () => jsonResponse(200, { collections: [] }) })
    await userEvent.click(await screen.findByRole('button', { name: 'New document' }))

    expect(await screen.findByText('No collections yet')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Title', { exact: false }), 'Quarterly plan')
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('creates the first collection inline, then lets the document be created in it', async () => {
    const bodies: Array<Record<string, unknown>> = []
    // Stateful: `useCreateCollection` invalidates the tree query on success,
    // so the refetch this test's mocked `GET` answers has to actually carry
    // the collection just created, the way the real route would.
    let collections: Array<Record<string, unknown>> = []
    renderDialog({
      'GET /api/workspaces/{id}/tree': () => jsonResponse(200, { collections }),
      'POST /api/workspaces/{id}/collections': async (request) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        const created = {
          id: 'col-new',
          workspaceId: 'workspace-1',
          name: 'Guides',
          slug: 'guides',
          createdAt: '2026-01-01T00:00:00.000Z',
        }
        collections = [{ ...created, documents: [] }]
        return jsonResponse(201, created)
      },
      'POST /api/workspaces/{workspaceId}/documents': async (request) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return createDocumentResponse({
          id: 'doc-12',
          collectionId: 'col-new',
          title: 'Onboarding',
        })
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'New document' }))
    await screen.findByText('No collections yet')
    await userEvent.type(screen.getByLabelText('New collection'), 'Guides')
    await userEvent.click(screen.getByRole('button', { name: 'Create collection' }))

    // The Collection field appears, already set to the collection just made.
    await waitFor(() => {
      expect(screen.getByLabelText('Collection')).toHaveValue('col-new')
    })

    await userEvent.type(screen.getByLabelText('Title', { exact: false }), 'Onboarding')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('heading', { name: 'Document page' })).toBeInTheDocument()
    expect(bodies).toEqual([{ name: 'Guides' }, { title: 'Onboarding', collectionId: 'col-new' }])
  })

  it('offers a parent document picker once a collection with documents is chosen, and sends the parent picked', async () => {
    const bodies: Array<Record<string, unknown>> = []
    renderDialog({
      'GET /api/workspaces/{id}/tree': () =>
        jsonResponse(200, {
          collections: [
            {
              id: 'col-guides',
              name: 'Guides',
              slug: 'guides',
              documents: [
                {
                  id: 'doc-parent',
                  title: 'Getting started',
                  slug: 'start',
                  status: 'published',
                  children: [],
                },
              ],
            },
          ],
        }),
      'POST /api/workspaces/{workspaceId}/documents': async (request) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return createDocumentResponse({
          id: 'doc-13',
          collectionId: 'col-guides',
          title: 'Step two',
        })
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'New document' }))
    await userEvent.type(await screen.findByLabelText('Title', { exact: false }), 'Step two')
    await userEvent.selectOptions(await screen.findByLabelText('Collection'), 'col-guides')

    await userEvent.click(await screen.findByRole('button', { name: 'Getting started' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('heading', { name: 'Document page' })).toBeInTheDocument()
    expect(bodies).toEqual([
      { title: 'Step two', collectionId: 'col-guides', parentId: 'doc-parent' },
    ])
  })

  it('supports a controlled, preset open mode for entry points with no trigger of their own', async () => {
    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: ControlledHarness,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    render(
      <ApiClientProvider
        client={createFakeApiClient({ 'GET /api/workspaces/{id}/tree': TREE_WITH_ONE_COLLECTION })}
      >
        <QueryClientProvider client={new QueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ApiClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Collection')).toHaveValue('col-guides')
    })
  })
})
