import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../../lib/api/render-app.tsx'
import { jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'

const me = () =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'reader@example.com',
    displayName: 'Reader',
    emailVerified: true,
    isInstanceAdmin: true,
  })

/** Two workspaces, because a list of one redirects straight into it. */
const workspaceList = () =>
  jsonResponse(200, [
    {
      id: 'ws-1',
      unitId: 'unit-1',
      name: 'Engineering',
      slug: 'engineering',
      createdAt: '2026-01-01T00:00:00.000Z',
      unit: { id: 'unit-1', name: 'Acme', path: ['Acme'] },
    },
    {
      id: 'ws-2',
      unitId: 'unit-2',
      name: 'Platform docs',
      slug: 'platform-docs',
      createdAt: '2026-01-01T00:00:00.000Z',
      unit: { id: 'unit-2', name: 'Platform', path: ['Acme', 'Platform'] },
    },
  ])

const results = () =>
  jsonResponse(200, {
    query: 'failover',
    current: [],
    elsewhere: [
      {
        workspace: { id: 'ws-1', slug: 'engineering', name: 'Engineering' },
        hits: [
          {
            documentId: 'doc-1',
            shortId: 'k7m3q9v2xd',
            slug: 'regional-failover',
            title: 'Regional failover',
            path: 'runbooks/regional-failover',
            workspaceId: 'ws-1',
            breadcrumb: ['Engineering', 'Runbooks'],
            snippet: { text: 'The failover runbook.', ranges: [{ start: 4, end: 12 }] },
            score: 1,
          },
        ],
      },
    ],
  })

const HOME_ROUTES: FakeRoutes = {
  'GET /api/me': me,
  'GET /api/workspaces': workspaceList,
  'GET /api/units': () => jsonResponse(200, []),
  'GET /api/search': results,
}

/**
 * The home page sits outside the authenticated layout route on purpose
 * (`routes/index.tsx`), so it is the one signed-in surface whose palette comes
 * from `AppPage` rather than from that layout. These prove it is there, and
 * that the page inside the layout does not end up with two.
 */
describe('the search palette outside a workspace', () => {
  it('opens on the signed-in home, where there is no workspace to prefer', async () => {
    renderApp('/', HOME_ROUTES)
    await screen.findByRole('button', { name: 'Search documentation' })

    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.type(
      await screen.findByRole('combobox', { name: 'Search documentation' }),
      'failover',
    )

    // Nothing is "in this workspace": every match is a grouped suggestion.
    const groups = await screen.findAllByRole('group')
    expect(
      groups.map(
        (group) =>
          document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent,
      ),
    ).toEqual(['Engineering'])
  })

  it('searches without naming a workspace when there is none in scope', async () => {
    const asked: (string | null)[] = []
    renderApp('/', {
      ...HOME_ROUTES,
      'GET /api/search': (request) => {
        asked.push(new URL(request.url).searchParams.get('workspace'))
        return results()
      },
    })
    await screen.findByRole('button', { name: 'Search documentation' })

    await userEvent.keyboard('{Control>}k{/Control}')
    await userEvent.type(
      await screen.findByRole('combobox', { name: 'Search documentation' }),
      'failover',
    )
    await screen.findAllByRole('option')

    expect(asked).toEqual([null])
  })

  it('opens one palette, not two, on a page inside both hosts', async () => {
    renderApp('/admin/organisation', {
      ...HOME_ROUTES,
      'GET /api/units': () => jsonResponse(200, []),
    })
    await screen.findByRole('button', { name: 'Search documentation' })

    await userEvent.keyboard('{Control>}k{/Control}')

    await waitFor(() => {
      expect(screen.getAllByRole('dialog', { name: 'Search documentation' })).toHaveLength(1)
    })
  })
})
