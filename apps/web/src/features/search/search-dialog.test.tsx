import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import type { SearchHit } from '../../lib/api/index.ts'
import { searchHitFixture } from '../../lib/api/search-fixtures.ts'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { registerEditorCommands } from './editor-commands.ts'

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

function hit(title: string, overrides: Partial<SearchHit> = {}) {
  return searchHitFixture(title, {
    documentId: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  })
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
 * `aria-hidden-focus` is off for these two checks, and only these two.
 *
 * While a modal dialog is open, Radix brackets it with focus guards — empty
 * `aria-hidden` spans carrying `tabindex="0"` — which are how the focus trap
 * knows the edges have been reached. axe reports every one of them as a hidden
 * focusable element, which is exactly what they are and exactly what they are
 * for; the rule is about content a person can tab into and not perceive, and
 * these hold nothing. Everything else axe checks stays on, over the whole
 * composed page.
 */
const AXE_WITH_FOCUS_TRAP = { rules: { 'aria-hidden-focus': { enabled: false } } }

/**
 * An input that binds Ctrl+K itself, standing in for a real one: it answers
 * the key first and prevents the default, which is exactly how the palette is
 * told to leave the combination alone.
 */
function claimTheShortcut(event: KeyboardEvent): void {
  if (event.key === 'k') event.preventDefault()
}

const admin = () =>
  jsonResponse(200, {
    id: 'user-0',
    email: 'admin@example.com',
    displayName: 'Instance administrator',
    emailVerified: true,
    isInstanceAdmin: true,
  })

function groupLabels(): (string | null | undefined)[] {
  return screen
    .getAllByRole('group')
    .map(
      (group) => document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent,
    )
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

  it('is free of axe violations with results on screen, inside the real shell', async () => {
    await openPalette()

    await userEvent.keyboard('failover')
    await screen.findAllByRole('option')

    // The composed surface, not the primitive in isolation: the palette is a
    // dialog over the whole workspace shell, and this is the arrangement
    // people actually meet.
    await expectNoAccessibilityViolations(document.body, AXE_WITH_FOCUS_TRAP)
  })

  it('is free of axe violations in its empty state, where the listbox is absent', async () => {
    await openPalette(
      shellRoutes(() => jsonResponse(200, { query: 'zzz', current: [], elsewhere: [] })),
    )

    await userEvent.keyboard('zzz')
    await screen.findByText(/Nothing matched/)

    // `aria-expanded="false"` with `aria-controls` pointing at an id that is
    // not rendered: legal, and the combination worth pinning.
    await expectNoAccessibilityViolations(document.body, AXE_WITH_FOCUS_TRAP)
  })

  it('stays busy through the debounce, before any request has been made', async () => {
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

    // A second word: for the length of the debounce nothing is in flight, and
    // the previous answer is still on screen. The field must still say it is
    // working, or those hits read as the answer to what is now in the box.
    await userEvent.keyboard(' runbook')
    expect(field()).toHaveAttribute('aria-busy', 'true')
    expect(requests).toBe(1)
  })

  it('never says "nothing matched" about a query it has not sent yet', async () => {
    await openPalette(
      shellRoutes((request) => {
        const asked = new URL(request.url).searchParams.get('q')
        return jsonResponse(
          200,
          asked === 'failover' ? RESULTS : { query: asked, current: [], elsewhere: [] },
        )
      }),
    )

    await userEvent.keyboard('failover')
    await screen.findAllByRole('option')

    await userEvent.keyboard('x')
    expect(screen.queryByText(/Nothing matched/)).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Nothing matched “failoverx”.')).toBeVisible()
    })
  })

  it('marks the character of the query the answer is actually about', async () => {
    await openPalette(
      shellRoutes((request) => {
        const asked = new URL(request.url).searchParams.get('q') ?? ''
        return asked === 'owner:'
          ? errorResponse(422, 'invalid_query', 'That filter has no value', {
              kind: 'empty-filter-value',
              position: 5,
            })
          : jsonResponse(200, { query: asked, current: [], elsewhere: [] })
      }),
    )

    await userEvent.keyboard('owner:')
    await screen.findByRole('alert')

    // Keep typing: the refusal belonged to `owner:`, and `owner:x` is a filter
    // that now has a value, so the stale notice must not be redrawn over it.
    await userEvent.keyboard('x')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('announces the settled answer, counting the workspaces it crossed', async () => {
    await openPalette()

    await userEvent.keyboard('failover')

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        '2 results, 1 in this workspace, 1 in 1 other workspace.',
      )
    })
  })

  it('says nothing while an answer is still on the way', async () => {
    await openPalette()

    await userEvent.keyboard('failover')
    // Mid-debounce: the region is empty rather than announcing a stale count.
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('refuses a query longer than the server would read, without sending it', async () => {
    let requests = 0
    await openPalette(
      shellRoutes(() => {
        requests += 1
        return jsonResponse(200, RESULTS)
      }),
    )

    await userEvent.paste('a'.repeat(513))

    expect(await screen.findByText(/That search is too long/)).toBeVisible()
    expect(requests).toBe(0)
    expect(screen.queryByRole('link', { name: 'See all results' })).not.toBeInTheDocument()
  })

  it('offers no results page until there is a query to show results for', async () => {
    await openPalette()

    expect(screen.queryByRole('link', { name: 'See all results' })).not.toBeInTheDocument()
  })

  describe('its commands', () => {
    it('list where to go before anything is typed, without the organisation for a non-admin', async () => {
      await openPalette()

      expect(await screen.findByRole('option', { name: 'Home' })).toBeInTheDocument()
      expect(groupLabels()).toEqual(['Go to', 'Account'])
      expect(screen.getByRole('option', { name: 'Sign out' })).toBeInTheDocument()
      expect(
        screen.queryByRole('option', { name: 'Organisation settings' }),
      ).not.toBeInTheDocument()
      // The prompt still says what typing does.
      expect(screen.getByText(/Type to search every workspace you can read/)).toBeVisible()
    })

    it('offer an administrator every organisation setting, and go to the one chosen', async () => {
      const { router } = await openPalette({
        ...shellRoutes(() => jsonResponse(200, RESULTS)),
        'GET /api/me': admin,
      })

      const organisation = await screen.findByRole('group', { name: 'Organisation' })
      expect(
        within(organisation)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual([
        'Organisation settings',
        'Theme',
        'Labels and emoji',
        'Layout',
        'Links',
        'Secrets and sign-in',
        'Units and workspaces',
        'People and groups',
      ])

      await userEvent.keyboard('theme')
      expect(screen.getByRole('option', { name: 'Theme' })).toHaveAttribute('aria-selected', 'true')
      await userEvent.keyboard('{Enter}')

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/admin/settings/theme')
      })
      expect(screen.queryByRole('dialog', { name: 'Search documentation' })).not.toBeInTheDocument()
    })

    it('offer what the open editor can do at the cursor, first, and run it', async () => {
      const run = vi.fn<() => void>()
      const unregister = registerEditorCommands(() => [
        { id: 'editor:link-show-card', label: 'Show link as card', keywords: ['link'], run },
      ])
      try {
        await openPalette()

        const group = await screen.findByRole('group', { name: 'At the cursor' })
        expect(groupLabels()[0]).toBe('At the cursor')
        await userEvent.click(within(group).getByRole('option', { name: 'Show link as card' }))

        expect(run).toHaveBeenCalledOnce()
        expect(
          screen.queryByRole('dialog', { name: 'Search documentation' }),
        ).not.toBeInTheDocument()
      } finally {
        unregister()
      }
    })

    it('offer nothing at the cursor when no editor is open', async () => {
      await openPalette()
      await screen.findByRole('option', { name: 'Home' })
      expect(screen.queryByRole('group', { name: 'At the cursor' })).not.toBeInTheDocument()
    })

    it('sign out from anywhere', async () => {
      let signedOut = false
      await openPalette({
        ...shellRoutes(() => jsonResponse(200, RESULTS)),
        'POST /api/auth/sign-out': () => {
          signedOut = true
          return new Response(null, { status: 204 })
        },
      })

      await userEvent.keyboard('log out')
      await userEvent.click(await screen.findByRole('option', { name: 'Sign out' }))

      await waitFor(() => {
        expect(signedOut).toBe(true)
      })
    })

    it('are free of axe violations, listed before anything is typed', async () => {
      await openPalette({ ...shellRoutes(() => jsonResponse(200, RESULTS)), 'GET /api/me': admin })
      await screen.findByRole('group', { name: 'Organisation' })

      await expectNoAccessibilityViolations(document.body, AXE_WITH_FOCUS_TRAP)
    })
  })
})

const suggestionsRoute = () =>
  jsonResponse(200, {
    field: 'by',
    suggestions: [
      { value: 'ada', label: 'Ada Lovelace' },
      { value: 'sam', label: 'Sam Taylor' },
    ],
  })

describe('the search palette: filters', () => {
  const filterRoutes = (): FakeRoutes => ({
    ...shellRoutes(() => jsonResponse(200, RESULTS)),
    'GET /api/search/suggestions': suggestionsRoute,
  })

  it('shows the live query’s filters as chips between the field and the list', async () => {
    await openPalette(filterRoutes())

    await userEvent.type(field(), 'failover by:me -tag:old')

    const list = await screen.findByRole('list', { name: 'Filters' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['By: me', 'Not tag: old'])
  })

  it('describes each hit in one compact line: status, contributors and age, without tags', async () => {
    const enriched = hit('Regional failover', {
      status: 'draft',
      tags: ['incident'],
      contributors: [{ name: 'Ada Lovelace' }],
      contributorCount: 3,
    })
    await openPalette(
      shellRoutes(() =>
        jsonResponse(200, { query: 'failover', current: [enriched], elsewhere: [] }),
      ),
    )

    await userEvent.type(field(), 'failover')

    const option = await screen.findByRole('option', { name: 'Regional failover' })
    expect(within(option).getByText('draft')).toBeInTheDocument()
    expect(within(option).getByText('by Ada Lovelace +2')).toBeInTheDocument()
    expect(within(option).getByText(/^Updated/)).toBeInTheDocument()
    expect(within(option).queryByText('incident')).not.toBeInTheDocument()
  })

  it('shows no chip list and no empty rule for a query without filters', async () => {
    await openPalette(filterRoutes())

    await userEvent.type(field(), 'failover')

    expect(screen.queryByRole('list', { name: 'Filters' })).not.toBeInTheDocument()
  })

  it('takes a filter off the query and puts focus back in the field', async () => {
    await openPalette(filterRoutes())
    await userEvent.type(field(), 'failover by:me -tag:old')

    await userEvent.click(await screen.findByRole('button', { name: 'Remove filter By: me' }))

    expect(field()).toHaveValue('failover -tag:old')
    expect(field()).toHaveFocus()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('puts the values of the filter being typed first, before commands and results', async () => {
    await openPalette(filterRoutes())

    await userEvent.type(field(), 'by:ad')

    await screen.findByRole('option', { name: 'Ada Lovelace' })
    expect(groupLabels()[0]).toBe('By')
  })

  it('completes a value in the query without closing the palette or going anywhere', async () => {
    const { router } = await openPalette(filterRoutes())

    await userEvent.type(field(), 'failover by:ad')
    await userEvent.click(await screen.findByRole('option', { name: 'Ada Lovelace' }))

    expect(field()).toHaveValue('failover by:ada ')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/w/engineering')
    expect(await screen.findByRole('list', { name: 'Filters' })).toBeInTheDocument()
  })

  it('offers the filters a word begins, and completing one carries on to its values', async () => {
    await openPalette(filterRoutes())

    await userEvent.type(field(), 'te')
    await userEvent.click(await screen.findByRole('option', { name: 'Team' }))

    expect(field()).toHaveValue('team:')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('still opens a result with Enter when there is nothing to complete', async () => {
    const { router } = await openPalette(filterRoutes())

    await userEvent.type(field(), 'failover')
    await screen.findByRole('option', { name: 'Regional failover' })
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/w/engineering/d/regional-failover-k7m3q9v2xd')
    })
  })

  it('does not scold somebody half-way through a filter whose values it is offering', async () => {
    await openPalette({
      ...shellRoutes((request) => {
        const asked = new URL(request.url).searchParams.get('q') ?? ''
        return asked === 'team:'
          ? errorResponse(422, 'invalid_query', 'That filter has no value', {
              kind: 'empty-filter-value',
              position: 4,
            })
          : jsonResponse(200, { query: asked, current: [], elsewhere: [] })
      }),
      'GET /api/search/suggestions': () =>
        jsonResponse(200, {
          field: 'team',
          suggestions: [{ value: 'Platform', label: 'Platform' }],
        }),
    })

    await userEvent.type(field(), 'team:')

    // The values are the help; "nothing after its colon" is what they are for.
    expect(await screen.findByRole('option', { name: 'Platform' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
    expect(screen.queryByText(/nothing after its colon/u)).not.toBeInTheDocument()
  })

  it('keeps "Nothing matched" for the answers, not the suggestions', async () => {
    await openPalette({
      ...shellRoutes(() => jsonResponse(200, { query: 'te', current: [], elsewhere: [] })),
      'GET /api/search/suggestions': suggestionsRoute,
    })

    await userEvent.type(field(), 'te')

    expect(await screen.findByText(/Nothing matched/)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Team' })).toBeInTheDocument()
  })
})
