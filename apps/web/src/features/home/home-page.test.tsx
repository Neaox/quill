import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse } from '../../lib/api/testing.ts'

const me = {
  id: 'user-1',
  email: 'reader@example.com',
  displayName: 'Reader',
  emailVerified: true,
  isInstanceAdmin: false,
}

const workspace = (id: string, name: string, unitId: string, path: readonly string[]) => ({
  id,
  unitId,
  name,
  slug: name.toLowerCase().replaceAll(' ', '-'),
  createdAt: '2026-01-01T00:00:00.000Z',
  unit: { id: unitId, name: path.at(-1) ?? '', path },
})

const document = (overrides: {
  id: string
  shortId: string
  title: string
  workspaceId: string
  headRevision: string | null
  updatedAt: string
}) => ({
  collectionId: 'col-1',
  parentId: null,
  slug: overrides.title.toLowerCase().replaceAll(' ', '-'),
  path: 'guides/page.md',
  status: overrides.headRevision === null ? 'draft' : 'published',
  templateId: null,
  templateVersion: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const TWO_WORKSPACES = [
  workspace('ws-1', 'Engineering', 'unit-1', ['Acme']),
  workspace('ws-2', 'Platform docs', 'unit-2', ['Acme', 'Platform']),
]

describe('the signed-in home', () => {
  it('sends a signed-out visit to sign-in', async () => {
    renderApp('/', {
      'GET /api/me': () => errorResponse(401, 'unauthenticated', 'Sign in required'),
    })

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
  })

  it('opens the only workspace straight away instead of listing it', async () => {
    const { router } = renderApp('/', {
      'GET /api/me': () => jsonResponse(200, me),
      'GET /api/workspaces': () =>
        jsonResponse(200, [workspace('ws-1', 'Engineering', 'unit-1', ['Acme'])]),
      'GET /api/workspaces/{id}': () =>
        jsonResponse(200, workspace('ws-1', 'Engineering', 'unit-1', ['Acme'])),
      'GET /api/workspaces/{id}/tree': () => jsonResponse(200, { collections: [] }),
      'GET /api/workspaces/{workspaceId}/documents': () => jsonResponse(200, []),
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/w/ws-1')
    })
  })

  it('lists several workspaces grouped by unit', async () => {
    renderApp('/', {
      'GET /api/me': () => jsonResponse(200, me),
      'GET /api/workspaces': () => jsonResponse(200, TWO_WORKSPACES),
      'GET /api/workspaces/{workspaceId}/documents': () => jsonResponse(200, []),
    })

    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Your workspaces' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 3, name: 'Acme' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Acme / Platform' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Engineering/ })).toHaveAttribute(
      'href',
      '/w/engineering',
    )
    expect(screen.getByRole('link', { name: /Platform docs/ })).toHaveAttribute(
      'href',
      '/w/platform-docs',
    )
  })

  it('omits Continue and Recently updated while there is nothing in them', async () => {
    renderApp('/', {
      'GET /api/me': () => jsonResponse(200, me),
      'GET /api/workspaces': () => jsonResponse(200, TWO_WORKSPACES),
      'GET /api/workspaces/{workspaceId}/documents': () => jsonResponse(200, []),
    })

    await screen.findByRole('heading', { level: 2, name: 'Your workspaces' })
    expect(screen.queryByRole('heading', { name: 'Continue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Recently updated' })).not.toBeInTheDocument()
  })

  it('splits documents across workspaces into Continue and Recently updated', async () => {
    renderApp('/', {
      'GET /api/me': () => jsonResponse(200, me),
      'GET /api/workspaces': () => jsonResponse(200, TWO_WORKSPACES),
      'GET /api/workspaces/{workspaceId}/documents': (_request, params) =>
        jsonResponse(
          200,
          params['workspaceId'] === 'ws-1'
            ? [
                document({
                  id: 'doc-draft',
                  shortId: 'k7m3q9v2rt',
                  title: 'Failover drill',
                  workspaceId: 'ws-1',
                  headRevision: null,
                  updatedAt: '2026-03-02T00:00:00.000Z',
                }),
              ]
            : [
                document({
                  id: 'doc-published',
                  shortId: 'p4n8w2cx5b',
                  title: 'Release notes',
                  workspaceId: 'ws-2',
                  headRevision: 'a'.repeat(40),
                  updatedAt: '2026-03-01T00:00:00.000Z',
                }),
              ],
        ),
    })

    expect(await screen.findByRole('heading', { name: 'Continue' })).toBeInTheDocument()
    // The address says what it points at (ADR-035): the workspace's slug, and
    // the document's title-slug with its stable key.
    expect(screen.getByRole('link', { name: /Failover drill/ })).toHaveAttribute(
      'href',
      '/w/engineering/d/failover-drill-k7m3q9v2rt',
    )
    expect(screen.getByRole('heading', { name: 'Recently updated' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Release notes/ })).toHaveAttribute(
      'href',
      '/w/platform-docs/d/release-notes-p4n8w2cx5b',
    )
  })

  it('tells a person with no workspaces whom to ask', async () => {
    renderApp('/', {
      'GET /api/me': () => jsonResponse(200, me),
      'GET /api/workspaces': () => jsonResponse(200, []),
    })

    expect(await screen.findByText('No workspaces yet')).toBeInTheDocument()
  })

  it('walks an administrator with nothing set up through the first unit', async () => {
    renderApp('/', {
      'GET /api/me': () => jsonResponse(200, { ...me, isInstanceAdmin: true }),
      'GET /api/workspaces': () => jsonResponse(200, []),
      'GET /api/units': () => jsonResponse(200, []),
    })

    expect(await screen.findByText('Set up your organisation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create a unit' })).toBeInTheDocument()
  })

  it('offers the next step, a workspace, once a unit exists', async () => {
    renderApp('/', {
      'GET /api/me': () => jsonResponse(200, { ...me, isInstanceAdmin: true }),
      'GET /api/workspaces': () => jsonResponse(200, []),
      'GET /api/units': () =>
        jsonResponse(200, [
          {
            id: 'unit-1',
            parentId: null,
            name: 'Acme',
            slug: 'acme',
            label: 'company',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
    })

    expect(await screen.findByRole('button', { name: 'Create a workspace' })).toBeInTheDocument()
  })

  it('never shows the set-up card to somebody who could not act on it', async () => {
    renderApp('/', {
      'GET /api/me': () => jsonResponse(200, me),
      'GET /api/workspaces': () => jsonResponse(200, []),
    })

    await screen.findByText('No workspaces yet')
    expect(screen.queryByText('Set up your organisation')).not.toBeInTheDocument()
  })
})
