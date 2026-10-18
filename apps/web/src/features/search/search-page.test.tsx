import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import {
  facetValueFixture,
  searchHitFixture,
  searchResultsFixture,
} from '../../lib/api/search-fixtures.ts'
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

const hit = searchHitFixture

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

    expect(
      await screen.findByText(/Type to search every workspace you can read/),
    ).toBeInTheDocument()
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

  it('is free of axe violations, shell and results together', async () => {
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

    await screen.findByRole('link', { name: 'Regional failover' })

    // The whole page, shell included. It was scoped to `main` while the
    // sidebar's workspace name sat outside any landmark; #16 put it inside a
    // named section, so the broader check is the one worth keeping.
    await expectNoAccessibilityViolations(document.body)
  })

  it('names a result by its title, with the snippet and trail describing it', async () => {
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

    // Exactly, not by substring: the snippet mentions "failover" too, and a
    // link named by its whole row cannot be told from its neighbours by ear.
    const link = await screen.findByRole('link', { name: 'Regional failover' })
    // The description is the snippet and the trail. Marked words are separate
    // inline elements, and the accessible-name computation joins them without
    // spaces, so this matches on the words rather than on the whole sentence.
    expect(link).toHaveAccessibleDescription(/failover/)
    expect(link).toHaveAccessibleDescription(/Runbooks/)
  })

  it('announces what landed, counting the workspaces crossed', async () => {
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

    await screen.findByRole('link', { name: 'Regional failover' })
    await waitFor(() => {
      expect(
        screen.getByText('2 results, 1 in this workspace, 1 in 1 other workspace.'),
      ).toBeInTheDocument()
    })
  })

  it('says it is searching in words, not only with a spinner', async () => {
    const answer = Promise.withResolvers<void>()
    renderApp(
      '/w/engineering/search?q=failover',
      shellRoutes(async () => {
        await answer.promise
        return jsonResponse(200, {
          query: 'failover',
          current: [hit('Regional failover')],
          elsewhere: [],
        })
      }),
    )

    // `Spinner` is decorative by contract, so the words are what say so.
    expect(await screen.findByText('Searching…')).toBeVisible()
    answer.resolve()
    await screen.findByRole('link', { name: 'Regional failover' })
  })

  it('refuses a query longer than the server would read', async () => {
    let requests = 0
    renderApp(
      `/w/engineering/search?q=${'a'.repeat(513)}`,
      shellRoutes(() => {
        requests += 1
        return jsonResponse(200, { query: 'x', current: [], elsewhere: [] })
      }),
    )

    expect(await screen.findByText(/That search is too long/)).toBeVisible()
    expect(requests).toBe(0)
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

const answer = (query: string, current = [hit('Regional failover')]) =>
  jsonResponse(200, { query, current, elsewhere: [] })

const people = () =>
  jsonResponse(200, {
    field: 'by',
    suggestions: [
      { value: 'ada', label: 'Ada Lovelace' },
      { value: 'sam', label: 'Sam Taylor' },
    ],
  })

const box = () => screen.findByRole('combobox', { name: 'Search this organisation' })

describe('the search results page: filters', () => {
  function filterRoutes(search: FakeRoutes['x'] = () => answer('x')): FakeRoutes {
    return { ...shellRoutes(search), 'GET /api/search/suggestions': people }
  }

  it('shows the applied query’s filters as chips, in a list that counts them', async () => {
    renderApp('/w/engineering/search?q=failover%20by%3Ame%20-tag%3Aold', filterRoutes())

    const list = await screen.findByRole('list', { name: 'Filters' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['By: me', 'Not tag: old'])
    expect(
      within(list).getByRole('button', { name: 'Remove filter Not tag: old' }),
    ).toBeInTheDocument()
  })

  it('describes each hit in full, tags included', async () => {
    const enriched = hit('Regional failover', {
      status: 'draft',
      tags: ['incident', 'dr'],
      contributors: [{ name: 'Ada Lovelace' }],
      contributorCount: 1,
    })
    renderApp(
      '/w/engineering/search?q=failover',
      filterRoutes(() => answer('failover', [enriched])),
    )

    const link = await screen.findByRole('link', { name: 'Regional failover' })
    expect(within(link).getByText('draft')).toBeInTheDocument()
    expect(within(link).getByText('by Ada Lovelace')).toBeInTheDocument()
    expect(within(link).getByText('incident')).toBeInTheDocument()
    expect(link).toHaveAccessibleDescription(/Updated/)
  })

  it('renders no list at all for a query with no filters', async () => {
    renderApp('/w/engineering/search?q=failover', filterRoutes())

    await box()
    expect(screen.queryByRole('list', { name: 'Filters' })).not.toBeInTheDocument()
  })

  it('takes a filter off by searching again without it, and puts focus back in the box', async () => {
    const { router } = renderApp(
      '/w/engineering/search?q=failover%20by%3Ame%20-tag%3Aold',
      filterRoutes(),
    )
    await screen.findByRole('list', { name: 'Filters' })

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter By: me' }))

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ q: 'failover -tag:old' })
    })
    expect(await box()).toHaveFocus()
    expect(await screen.findByRole('combobox', { name: 'Search this organisation' })).toHaveValue(
      'failover -tag:old',
    )
    expect(
      within(screen.getByRole('list', { name: 'Filters' })).getAllByRole('listitem'),
    ).toHaveLength(1)
  })

  it('follows the address when it changes, without losing the box it was typed in', async () => {
    const { router } = renderApp('/w/engineering/search?q=failover', filterRoutes())
    const before = await box()
    await userEvent.type(before, ' half-typed')

    await router.navigate({
      to: '/w/$workspaceSlug/search',
      params: { workspaceSlug: 'engineering' },
      search: { q: 'runbook' },
    })

    await waitFor(() => {
      expect(before).toHaveValue('runbook')
    })
    expect(await box()).toBe(before)
  })

  it('keeps chips to what was asked, not to what is being typed', async () => {
    renderApp('/w/engineering/search?q=failover', filterRoutes())

    await userEvent.type(await box(), ' by:me')

    expect(screen.queryByRole('list', { name: 'Filters' })).not.toBeInTheDocument()
  })

  it('searches for the draft, filters and all, when the form is submitted', async () => {
    const { router } = renderApp('/w/engineering/search?q=failover', filterRoutes())

    await userEvent.type(await box(), ' by:me{Enter}')

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ q: 'failover by:me' })
    })
    expect(await screen.findByRole('list', { name: 'Filters' })).toBeInTheDocument()
  })

  it('completes a filter’s value from the server’s suggestions', async () => {
    const { router } = renderApp('/w/engineering/search', filterRoutes())

    await userEvent.type(await box(), 'by:ad')
    await userEvent.click(await screen.findByRole('option', { name: 'Ada Lovelace' }))
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ q: 'by:ada' })
    })
  })

  it('offers each filter that has values as a button, with what it finds as its description', async () => {
    renderApp('/w/engineering/search?q=failover', filterRoutes())

    const row = await screen.findByRole('list', { name: 'Add a filter:' })
    expect(
      within(row)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['By', 'Team', 'Tag', 'Collection', 'Workspace', 'Status'])
    expect(within(row).getByRole('button', { name: 'Tag' })).toHaveAccessibleDescription(
      'A tag the document carries',
    )
  })

  it('adds a filter at the end of the box and opens its suggestions', async () => {
    renderApp('/w/engineering/search?q=failover', filterRoutes())

    await userEvent.click(await screen.findByRole('button', { name: 'By' }))

    expect(await box()).toHaveValue('failover by:')
    expect(await box()).toHaveFocus()
    expect(await screen.findByRole('option', { name: 'Ada Lovelace' })).toBeInTheDocument()
  })

  it('suggests removing a filter when a search with one finds nothing', async () => {
    renderApp(
      '/w/engineering/search?q=failover%20by%3Ame',
      filterRoutes(() => answer('failover by:me', [])),
    )

    expect(await screen.findByText('Nothing matched “failover by:me”')).toBeInTheDocument()
    expect(screen.getByText(/Try removing a filter/)).toBeInTheDocument()
  })

  it('does not suggest removing a filter when there is none to remove', async () => {
    renderApp(
      '/w/engineering/search?q=zzz',
      filterRoutes(() => answer('zzz', [])),
    )

    await screen.findByText('Nothing matched “zzz”')
    expect(screen.queryByText(/Try removing a filter/)).not.toBeInTheDocument()
  })

  it('is free of axe violations with chips, the filter row and suggestions showing', async () => {
    renderApp('/w/engineering/search?q=failover%20by%3Ame', filterRoutes())
    await screen.findByRole('list', { name: 'Filters' })
    await userEvent.type(await box(), ' by:ad')
    await screen.findByRole('option', { name: 'Ada Lovelace' })

    await expectNoAccessibilityViolations(document.body)
  })
})

describe('the search results page: refining', () => {
  const facets = {
    tag: [facetValueFixture('api', 12), facetValueFixture('area/billing', 3)],
    status: [facetValueFixture('draft', 2, 'Draft')],
    collection: [facetValueFixture('Release notes', 1)],
  }

  /** Answers like the server: facets only when `facets=` was asked for, on the first page only. */
  function refineRoutes(
    reply: (url: URL) => unknown = (url) =>
      searchResultsFixture(url.searchParams.get('q') ?? '', [hit('Regional failover')], facets),
  ): { asked: URL[]; routes: FakeRoutes } {
    const asked: URL[] = []
    return {
      asked,
      routes: shellRoutes((request: Request) => {
        const url = new URL(request.url)
        asked.push(url)
        return jsonResponse(200, reply(url))
      }),
    }
  }

  it('asks for the three facets, and shows them between the filters and the results', async () => {
    const { asked, routes } = refineRoutes()
    renderApp('/w/engineering/search?q=failover%20by%3Ame', routes)

    const refine = await screen.findByRole('region', { name: 'Refine' })

    expect(asked[0]?.searchParams.get('facets')).toBe('tag,status,collection')
    expect(within(refine).getByRole('button', { name: 'api, 12 results' })).toBeInTheDocument()
    const filters = screen.getByRole('list', { name: 'Filters' })
    const results = screen.getByRole('heading', { level: 2, name: 'In this workspace' })
    expect(filters.compareDocumentPosition(refine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(refine.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('adds the choice to the query as a filter, and puts focus in the box', async () => {
    const { routes } = refineRoutes()
    const { router } = renderApp('/w/engineering/search?q=failover%20-draft', routes)

    await userEvent.click(await screen.findByRole('button', { name: 'Release notes, 1 result' }))

    await waitFor(() => {
      expect(router.state.location.search).toEqual({
        q: 'failover -draft collection:"Release notes"',
      })
    })
    expect(await box()).toHaveFocus()
  })

  it('uses the value the server wrote, not the label shown', async () => {
    const { routes } = refineRoutes()
    const { router } = renderApp('/w/engineering/search?q=failover', routes)

    await userEvent.click(await screen.findByRole('button', { name: 'Draft, 2 results' }))

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ q: 'failover status:draft' })
    })
  })

  it('no longer offers what has been chosen, once the new answer is in', async () => {
    const { routes } = refineRoutes()
    renderApp('/w/engineering/search?q=failover', routes)

    await userEvent.click(await screen.findByRole('button', { name: 'api, 12 results' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'api, 12 results' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'area/billing, 3 results' })).toBeInTheDocument()
  })

  it('keeps the previous facets on show while the refined answer is on its way', async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>()
    const { routes } = refineRoutes()
    const slow = routes['GET /api/search']
    renderApp('/w/engineering/search?q=failover', {
      ...routes,
      'GET /api/search': async (request, params) => {
        if (new URL(request.url).searchParams.get('q') !== 'failover') await gate
        return slow?.(request, params) ?? jsonResponse(500, {})
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Draft, 2 results' }))

    expect(await screen.findByText('Searching…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'area/billing, 3 results' })).toBeInTheDocument()
    release()
    await screen.findByRole('heading', { level: 2, name: 'In this workspace' })
  })

  it('does not ask again, or lose the facets, when more results are shown', async () => {
    const { asked, routes } = refineRoutes((url) =>
      url.searchParams.has('cursor')
        ? searchResultsFixture('failover', [hit('Failover drill', { documentId: 'doc-drill' })])
        : {
            ...searchResultsFixture('failover', [hit('Regional failover')], facets),
            nextCursor: 'c1',
          },
    )
    renderApp('/w/engineering/search?q=failover', routes)

    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }))

    await screen.findByRole('link', { name: 'Failover drill' })
    const paging = asked.filter((url) => url.searchParams.has('cursor'))
    expect(paging.map((url) => url.searchParams.get('cursor'))).toEqual(['c1'])
    expect(paging[0]?.searchParams.has('facets')).toBe(false)
    const firstPages = asked.filter((url) => !url.searchParams.has('cursor'))
    expect(firstPages.every((url) => url.searchParams.has('facets'))).toBe(true)
    expect(screen.getByRole('button', { name: 'api, 12 results' })).toBeInTheDocument()
  })

  it('shows no Refine section when the answer has nothing to refine by', async () => {
    const { routes } = refineRoutes((url) =>
      searchResultsFixture(url.searchParams.get('q') ?? '', [hit('Regional failover')]),
    )
    renderApp('/w/engineering/search?q=failover', routes)

    await screen.findByRole('heading', { level: 2, name: 'In this workspace' })

    expect(screen.queryByRole('region', { name: 'Refine' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Refine' })).not.toBeInTheDocument()
  })

  it('shows no Refine section when the search failed', async () => {
    renderApp(
      '/w/engineering/search?q=zzz',
      shellRoutes(() => errorResponse(500, 'internal', 'Nope')),
    )
    await screen.findByText("Couldn't run that search")

    expect(screen.queryByRole('region', { name: 'Refine' })).not.toBeInTheDocument()
  })

  it('is free of axe violations with the Refine section showing', async () => {
    const { routes } = refineRoutes()
    renderApp('/w/engineering/search?q=failover%20by%3Ame', routes)
    await screen.findByRole('region', { name: 'Refine' })

    await expectNoAccessibilityViolations(document.body)
  })
})
