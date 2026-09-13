import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'

const me = () =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'reader@example.com',
    displayName: 'Reader',
    emailVerified: true,
    isInstanceAdmin: false,
  })

const workspace = () =>
  jsonResponse(200, {
    id: 'ws-1',
    unitId: 'unit-1',
    name: 'Engineering',
    slug: 'engineering',
    createdAt: '2026-01-01T00:00:00.000Z',
  })

function hit(title: string, overrides: Record<string, unknown> = {}) {
  return {
    documentId: `doc-${title}`,
    shortId: 'k7m3q9v2xd',
    slug: 'regional-failover',
    title,
    path: 'runbooks/regional-failover',
    workspaceId: 'ws-1',
    breadcrumb: ['Engineering', 'Runbooks'],
    snippet: { text: 'Follow the failover runbook.', ranges: [{ start: 11, end: 19 }] },
    score: 1,
    ...overrides,
  }
}

const PLATFORM_GROUP = {
  workspace: { id: 'ws-2', slug: 'platform-docs', name: 'Platform docs' },
  hits: [
    hit('Platform team charter', {
      documentId: 'doc-charter',
      shortId: 'q4w8e2r6t0',
      workspaceId: 'ws-2',
      breadcrumb: ['Platform docs', 'Docs'],
    }),
  ],
}

function shellRoutes(search: FakeRoutes['x']): FakeRoutes {
  return {
    'GET /api/me': me,
    'GET /api/workspaces/{id}': workspace,
    'GET /api/workspaces/{id}/tree': () => jsonResponse(200, { collections: [] }),
    'GET /api/search': search,
  }
}

describe('the search results page', () => {
  it('lists the answer grouped, this workspace first and the rest under Elsewhere', async () => {
    renderApp(
      '/w/engineering/search?q=failover',
      shellRoutes(() =>
        jsonResponse(200, {
          query: 'failover',
          current: [hit('Regional failover')],
          elsewhere: [PLATFORM_GROUP],
        }),
      ),
    )

    expect(
      await screen.findByRole('heading', { level: 2, name: 'In this workspace' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Elsewhere' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Platform docs' })).toBeInTheDocument()
  })

  it('links every hit at its readable address, in the workspace it actually lives in', async () => {
    renderApp(
      '/w/engineering/search?q=failover',
      shellRoutes(() =>
        jsonResponse(200, {
          query: 'failover',
          current: [hit('Regional failover')],
          elsewhere: [PLATFORM_GROUP],
        }),
      ),
    )

    const here = await screen.findByRole('link', { name: /Regional failover/ })
    expect(here).toHaveAttribute('href', '/w/engineering/d/regional-failover-k7m3q9v2xd')
    expect(screen.getByRole('link', { name: /Platform team charter/ })).toHaveAttribute(
      'href',
      '/w/platform-docs/d/platform-team-charter-q4w8e2r6t0',
    )
  })

  it('marks the matched words in each snippet', async () => {
    renderApp(
      '/w/engineering/search?q=failover',
      shellRoutes(() =>
        jsonResponse(200, {
          query: 'failover',
          current: [hit('Regional failover')],
          elsewhere: [],
        }),
      ),
    )

    const link = await screen.findByRole('link', { name: /Regional failover/ })
    expect([...link.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['failover'])
  })

  it('takes the query from the URL, so a results page can be shared', async () => {
    const asked: string[] = []
    renderApp(
      '/w/engineering/search?q=database%20failover',
      shellRoutes((request) => {
        asked.push(new URL(request.url).searchParams.get('q') ?? '')
        return jsonResponse(200, { query: 'database failover', current: [], elsewhere: [] })
      }),
    )

    await screen.findByText(/Nothing matched/)
    expect(asked).toContain('database failover')
  })

  it('puts a new query in the address rather than in component state', async () => {
    const { router } = renderApp(
      '/w/engineering/search?q=failover',
      shellRoutes(() =>
        jsonResponse(200, {
          query: 'failover',
          current: [hit('Regional failover')],
          elsewhere: [],
        }),
      ),
    )

    const box = await screen.findByLabelText('Search this organisation')
    await userEvent.clear(box)
    await userEvent.type(box, 'runbook')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(router.state.location.searchStr).toBe('?q=runbook')
    })
  })

  it('lengthens the page with Show more rather than starting it again', async () => {
    const pages = [
      {
        query: 'failover',
        current: [hit('Regional failover')],
        elsewhere: [PLATFORM_GROUP],
        nextCursor: 'page-2',
      },
      {
        query: 'failover',
        current: [hit('Failover drill', { documentId: 'doc-drill', shortId: 'a1b2c3d4e5' })],
        elsewhere: [],
      },
    ]
    renderApp(
      '/w/engineering/search?q=failover',
      shellRoutes((request) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        return jsonResponse(200, cursor === null ? pages[0] : pages[1])
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }))

    expect(await screen.findByRole('link', { name: /Failover drill/ })).toBeInTheDocument()
    // The first page is still there, and its headings were not repeated.
    expect(screen.getByRole('link', { name: /Regional failover/ })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2, name: 'In this workspace' })).toHaveLength(1)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
    })
  })

  it('offers nothing more when the first page was the whole answer', async () => {
    renderApp(
      '/w/engineering/search?q=failover',
      shellRoutes(() =>
        jsonResponse(200, {
          query: 'failover',
          current: [hit('Regional failover')],
          elsewhere: [],
        }),
      ),
    )

    await screen.findByRole('link', { name: /Regional failover/ })
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  it('says what to do next when nothing matched', async () => {
    renderApp(
      '/w/engineering/search?q=zzz',
      shellRoutes(() => jsonResponse(200, { query: 'zzz', current: [], elsewhere: [] })),
    )

    expect(await screen.findByText('Nothing matched “zzz”')).toBeInTheDocument()
  })

  it('invites a query when the address carries none', async () => {
    renderApp(
      '/w/engineering/search',
      shellRoutes(() => jsonResponse(200, { query: '', current: [], elsewhere: [] })),
    )

    expect(await screen.findByText(/Type something to search/)).toBeInTheDocument()
  })

  it('shows a refused query where it went wrong, inside the shell', async () => {
    renderApp(
      '/w/engineering/search?q=owner%3A',
      shellRoutes(() =>
        errorResponse(422, 'invalid_query', 'That filter has no value', {
          kind: 'empty-filter-value',
          position: 6,
        }),
      ),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This filter has nothing after its colon. (at character 7)',
    )
    expect(screen.getByRole('navigation', { name: 'Documents' })).toBeInTheDocument()
  })

  it('reports a failing search without taking the page down', async () => {
    renderApp(
      '/w/engineering/search?q=failover',
      shellRoutes(() => errorResponse(500, 'internal_error', 'Something went wrong')),
    )

    const notice = await screen.findByText("Couldn't run that search")
    expect(within(notice.closest('div') as HTMLElement).getByText(/not answering/)).toBeVisible()
  })

  it('names the search in the document title', async () => {
    renderApp(
      '/w/engineering/search?q=failover',
      shellRoutes(() =>
        jsonResponse(200, {
          query: 'failover',
          current: [hit('Regional failover')],
          elsewhere: [],
        }),
      ),
    )

    await screen.findByRole('link', { name: /Regional failover/ })
    await waitFor(() => {
      expect(document.title).toBe('Search: failover')
    })
  })
})
