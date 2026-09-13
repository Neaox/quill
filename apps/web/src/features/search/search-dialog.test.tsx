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
    documentId: '11111111-1111-4111-8111-111111111111',
    shortId: 'k7m3q9v2xd',
    slug: 'regional-failover',
    title,
    path: 'runbooks/regional-failover',
    workspaceId: 'ws-1',
    breadcrumb: ['Engineering', 'Runbooks'],
    snippet: {
      text: 'Follow the failover runbook.',
      ranges: [{ start: 11, end: 19 }],
    },
    score: 1,
    ...overrides,
  }
}

const RESULTS = {
  query: 'failover',
  current: [hit('Regional failover')],
  elsewhere: [
    {
      workspace: { id: 'ws-2', slug: 'platform-docs', name: 'Platform docs' },
      hits: [
        hit('Platform team charter', {
          documentId: '22222222-2222-4222-8222-222222222222',
          shortId: 'q4w8e2r6t0',
          workspaceId: 'ws-2',
          breadcrumb: ['Platform docs', 'Docs'],
          snippet: { text: 'The failover owner is Platform.', ranges: [{ start: 4, end: 12 }] },
        }),
      ],
    },
  ],
}

/** The workspace shell, with whatever search answer a test wants behind it. */
function shellRoutes(search: FakeRoutes['x']): FakeRoutes {
  return {
    'GET /api/me': me,
    'GET /api/workspaces/{id}': workspace,
    'GET /api/workspaces/{id}/tree': () => jsonResponse(200, { collections: [] }),
    'GET /api/workspaces/{workspaceId}/documents': () => jsonResponse(200, []),
    'GET /api/search': search,
  }
}

async function openPalette(routes: FakeRoutes = shellRoutes(() => jsonResponse(200, RESULTS))) {
  const app = renderApp('/w/engineering', routes)
  await userEvent.click(await screen.findByRole('button', { name: 'Search documentation' }))
  return { ...app, palette: await screen.findByRole('dialog', { name: 'Search documentation' }) }
}

function field(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Search documentation' })
}

/**
 * An input that binds Ctrl+K itself, standing in for a real one: it answers
 * the key first and prevents the default, which is exactly how the palette is
 * told to leave the combination alone.
 */
function claimTheShortcut(event: KeyboardEvent): void {
  if (event.key === 'k') event.preventDefault()
}

describe('the search palette', () => {
  it('is not on screen until it is opened', async () => {
    renderApp(
      '/w/engineering',
      shellRoutes(() => jsonResponse(200, RESULTS)),
    )

    await screen.findByRole('button', { name: 'Search documentation' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens from the top bar field with the query box focused and nothing searched yet', async () => {
    await openPalette()

    expect(field()).toHaveFocus()
    expect(field()).toHaveValue('')
    expect(screen.getByText(/Type to search every workspace you can read/)).toBeVisible()
  })

  it('opens on Ctrl+K from anywhere on the page, and closes again on the same keys', async () => {
    renderApp(
      '/w/engineering',
      shellRoutes(() => jsonResponse(200, RESULTS)),
    )
    await screen.findByRole('button', { name: 'Search documentation' })

    await userEvent.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: 'Search documentation' })).toBeInTheDocument()

    await userEvent.keyboard('{Control>}k{/Control}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('opens on Cmd+K too, for a keyboard that has one', async () => {
    renderApp(
      '/w/engineering',
      shellRoutes(() => jsonResponse(200, RESULTS)),
    )
    await screen.findByRole('button', { name: 'Search documentation' })

    await userEvent.keyboard('{Meta>}k{/Meta}')

    expect(await screen.findByRole('dialog', { name: 'Search documentation' })).toBeInTheDocument()
  })

  it('leaves the key alone when something else has already handled it', async () => {
    renderApp(
      '/w/engineering',
      shellRoutes(() => jsonResponse(200, RESULTS)),
    )
    await screen.findByRole('button', { name: 'Search documentation' })
    window.addEventListener('keydown', claimTheShortcut, { capture: true })

    await userEvent.keyboard('{Control>}k{/Control}')
    window.removeEventListener('keydown', claimTheShortcut, { capture: true })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('groups the answer: this workspace first, then each other workspace by name', async () => {
    await openPalette()

    await userEvent.keyboard('failover')

    const groups = await screen.findAllByRole('group')
    expect(
      groups.map(
        (group) =>
          document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent,
      ),
    ).toEqual(['In this workspace', 'Platform docs'])
    expect(within(groups[0] as HTMLElement).getByRole('option')).toHaveTextContent(
      'Regional failover',
    )
    expect(within(groups[1] as HTMLElement).getByRole('option')).toHaveTextContent(
      'Platform team charter',
    )
  })

  it('marks the matched words with <mark>, from offsets and never from server HTML', async () => {
    await openPalette()

    await userEvent.keyboard('failover')

    const option = await screen.findByRole('option', { name: /Regional failover/ })
    const marks = option.querySelectorAll('mark')
    expect([...marks].map((mark) => mark.textContent)).toEqual(['failover'])
  })

  it('shows where each hit lives, under its title', async () => {
    await openPalette()

    await userEvent.keyboard('failover')

    const option = await screen.findByRole('option', { name: /Regional failover/ })
    expect(option).toHaveTextContent('Engineering')
    expect(option).toHaveTextContent('Runbooks')
  })

  it('opens the document the arrows and Enter land on, and closes behind itself', async () => {
    const { router } = await openPalette()

    await userEvent.keyboard('failover')
    await screen.findAllByRole('option')
    await userEvent.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        '/w/platform-docs/d/platform-team-charter-q4w8e2r6t0',
      )
    })
    expect(screen.queryByRole('dialog', { name: 'Search documentation' })).not.toBeInTheDocument()
  })

  it('opens the document a pointer chooses', async () => {
    const { router } = await openPalette()

    await userEvent.keyboard('failover')
    await userEvent.click(await screen.findByRole('option', { name: /Regional failover/ }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/w/engineering/d/regional-failover-k7m3q9v2xd')
    })
  })

  it('closes on Escape, leaving the page behind it alone', async () => {
    const { router } = await openPalette()

    await userEvent.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(router.state.location.pathname).toBe('/w/engineering')
  })

  it('says so when nothing matched, naming what was searched for', async () => {
    await openPalette(
      shellRoutes(() => jsonResponse(200, { query: 'zzz', current: [], elsewhere: [] })),
    )

    await userEvent.keyboard('zzz')

    expect(await screen.findByText('Nothing matched “zzz”.')).toBeVisible()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows a refused query where it went wrong, rather than as a failure', async () => {
    await openPalette(
      shellRoutes(() =>
        errorResponse(422, 'invalid_query', 'A quotation mark is never closed', {
          kind: 'unterminated-quote',
          position: 6,
        }),
      ),
    )

    await userEvent.keyboard('owner"ada')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This quotation mark is never closed. (at character 7)',
    )
  })

  it('says search is unavailable when the server fails outright', async () => {
    await openPalette(
      shellRoutes(() => errorResponse(500, 'internal_error', 'Something went wrong')),
    )

    await userEvent.keyboard('failover')

    expect(await screen.findByRole('alert')).toHaveTextContent('Search is not answering right now')
  })

  it('marks the field busy while an answer is on the way', async () => {
    // Held open, so the busy state can be observed mid-flight.
    const answer = Promise.withResolvers<void>()
    await openPalette(
      shellRoutes(async () => {
        await answer.promise
        return jsonResponse(200, RESULTS)
      }),
    )

    await userEvent.keyboard('failover')

    await waitFor(() => {
      expect(field()).toHaveAttribute('aria-busy', 'true')
    })
    answer.resolve()
    await waitFor(() => {
      expect(field()).toHaveAttribute('aria-busy', 'false')
    })
  })

  it('sends one request for a word typed in one go, not one per keystroke', async () => {
    let requests = 0
    await openPalette(
      shellRoutes(() => {
        requests += 1
        return jsonResponse(200, RESULTS)
      }),
    )

    await userEvent.keyboard('failover')
    await screen.findAllByRole('option')

    expect(requests).toBe(1)
  })

  it('runs the search from the workspace the person is in', async () => {
    const asked: string[] = []
    await openPalette(
      shellRoutes((request) => {
        asked.push(new URL(request.url).searchParams.get('workspace') ?? '')
        return jsonResponse(200, RESULTS)
      }),
    )

    await userEvent.keyboard('failover')
    await screen.findAllByRole('option')

    expect(asked).toEqual(['ws-1'])
  })

  it('offers the full results page for the query, and goes there', async () => {
    const { router } = await openPalette()

    await userEvent.keyboard('failover')
    await userEvent.click(await screen.findByRole('link', { name: 'See all results' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/w/engineering/search')
    })
    expect(router.state.location.searchStr).toBe('?q=failover')
  })

  it('offers no results page until there is a query to show results for', async () => {
    await openPalette()

    expect(screen.queryByRole('link', { name: 'See all results' })).not.toBeInTheDocument()
  })
})
