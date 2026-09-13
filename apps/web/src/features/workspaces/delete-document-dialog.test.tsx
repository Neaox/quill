import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'

const me = () =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'lead@example.com',
    displayName: 'Lead',
    emailVerified: true,
    isInstanceAdmin: false,
  })

/** Each document's public handle, and the canonical address it makes (ADR-035). */
const KEYS: Readonly<Record<string, string>> = { 'doc-1': 'k7m3q9v2rt', 'doc-2': 'p4n8w2cx5b' }
const PLAN_PATH = `/w/acme/d/quarterly-plan-${KEYS['doc-1'] ?? ''}`

const documentDto = (id: string, title: string) => ({
  id,
  shortId: KEYS[id] ?? 'z0z0z0z0z0',
  workspaceId: 'acme',
  collectionId: 'col-1',
  parentId: null,
  slug: title.toLowerCase().replaceAll(' ', '-'),
  path: `guides/${id}.md`,
  title,
  status: 'draft',
  templateId: null,
  templateVersion: null,
  headRevision: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-03T00:00:00.000Z',
})

/** A parent with one child, so the dialog has children to speak about. */
function routes(overrides: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': me,
    'GET /api/workspaces/{id}': () =>
      jsonResponse(200, {
        id: 'acme',
        unitId: 'unit-1',
        name: 'Acme',
        slug: 'acme',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    'GET /api/workspaces/{id}/tree': () =>
      jsonResponse(200, {
        collections: [
          {
            id: 'col-1',
            name: 'Guides',
            slug: 'guides',
            documents: [
              {
                id: 'doc-1',
                shortId: KEYS['doc-1'],
                title: 'Quarterly plan',
                slug: 'quarterly-plan',
                status: 'draft',
                children: [
                  {
                    id: 'doc-2',
                    shortId: KEYS['doc-2'],
                    title: 'Appendix',
                    slug: 'appendix',
                    status: 'draft',
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    'GET /api/workspaces/{workspaceId}/documents': () =>
      jsonResponse(200, [documentDto('doc-1', 'Quarterly plan'), documentDto('doc-2', 'Appendix')]),
    // Resolves a reference the way the real route does (ADR-035): the key is
    // the only part that decides, so the title slug in front of it is ignored.
    'GET /api/documents/{id}': (_request, params) =>
      jsonResponse(
        200,
        (params['id'] ?? '').endsWith(KEYS['doc-2'] ?? '')
          ? documentDto('doc-2', 'Appendix')
          : documentDto('doc-1', 'Quarterly plan'),
      ),
    'GET /api/documents/{id}/envelope': () =>
      jsonResponse(200, {
        permissions: { view: true, comment: false, edit: true, manage: true },
        lock: null,
        lastPublished: null,
        review: null,
        health: [],
      }),
    'GET /api/documents/{id}/history': () => jsonResponse(200, { revisions: [] }),
    'GET /api/documents/{id}/rendered': () =>
      errorResponse(404, 'not_found', 'Nothing published yet'),
    ...overrides,
  }
}

describe('deleting a document', () => {
  it('is offered from the document header, names the document, and says what happens to its children', async () => {
    renderApp(PLAN_PATH, routes())

    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for Quarterly plan' }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))

    const dialog = await screen.findByRole('dialog', { name: /Delete .Quarterly plan/ })
    expect(
      within(dialog).getByText(/moves up to the top level of its collection/),
    ).toBeInTheDocument()
  })

  it('is offered from the tree row of the document being read', async () => {
    renderApp(PLAN_PATH, routes())

    const tree = await screen.findByRole('navigation', { name: 'Documents' })
    await userEvent.click(
      within(tree).getByRole('button', { name: 'More actions for Quarterly plan' }),
    )
    // The menu's panel is portalled to the body, as every floating panel is;
    // it is the trigger that lives in the tree.
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))

    expect(await screen.findByRole('dialog', { name: /Delete/ })).toBeInTheDocument()
  })

  it('deletes, goes back to the workspace, and says so once', async () => {
    const deleted: string[] = []
    const { router } = renderApp(
      PLAN_PATH,
      routes({
        'DELETE /api/documents/{id}': (_request, params) => {
          deleted.push(params['id'] ?? '')
          return new Response(null, { status: 204 })
        },
      }),
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for Quarterly plan' }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))
    const dialog = await screen.findByRole('dialog', { name: /Delete/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleted).toEqual(['doc-1'])
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/w/acme')
    })
    // The tree is redrawn from the server rather than patched, so the deleted
    // document cannot linger in it. (The "Deleted …" toast the dialog raises
    // belongs to the `Toaster` in the application shell, which `renderApp`
    // does not mount; `e2e/organise.spec.ts` is where it is seen.)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a refusal from the server inline rather than closing', async () => {
    renderApp(
      PLAN_PATH,
      routes({
        'DELETE /api/documents/{id}': () =>
          errorResponse(403, 'forbidden', 'You may not delete this document'),
      }),
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for Quarterly plan' }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))
    const dialog = await screen.findByRole('dialog', { name: /Delete/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You may not delete this document',
    )
  })

  it('offers nothing destructive to somebody who may only read', async () => {
    renderApp(
      PLAN_PATH,
      routes({
        'GET /api/documents/{id}/envelope': () =>
          jsonResponse(200, {
            permissions: { view: true, comment: false, edit: false, manage: false },
            lock: null,
            lastPublished: null,
            review: null,
            health: [],
          }),
      }),
    )

    const tree = await screen.findByRole('navigation', { name: 'Documents' })
    await userEvent.click(
      within(tree).getByRole('button', { name: 'More actions for Quarterly plan' }),
    )

    // The row still offers "New child document"; what a reader never sees is
    // anything that changes or removes the document itself.
    expect(within(tree).queryByRole('menuitem', { name: 'Delete…' })).not.toBeInTheDocument()
    expect(within(tree).queryByRole('menuitem', { name: 'Move to…' })).not.toBeInTheDocument()
  })
})
