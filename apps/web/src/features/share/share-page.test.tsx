import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'

/**
 * Reading a document through a share link, with no account (use case 25).
 *
 * Mounted through the application's own router at `/share/<token>`, because
 * what is being asserted is as much about the route as about the page: that
 * nothing above it authenticates, that no page of the signed-in world is
 * around it, and that every refusal lands on one identical answer.
 */

const TOKEN = 'kQ3nS8vT1wX5yZ7aB9cD2eF4gH6jK0mN'
const CHILD_KEY = 'p4r7t9w2xz'
const CHILD_PATH = `/share/${TOKEN}/d/failover-drill-${CHILD_KEY}`

const BODY_HTML = `<article>
<h1 id="regional-failover">Regional failover</h1>
<p>How to move traffic between regions.</p>
<h2 id="steps">Steps</h2>
<p>Drain the region.</p>
<h2 id="afterwards">Afterwards</h2>
<p>Tell the on-call engineer.</p>
</article>`

const OUTLINE = [
  {
    id: 'regional-failover',
    depth: 1,
    text: 'Regional failover',
    children: [
      { id: 'steps', depth: 2, text: 'Steps', children: [] },
      { id: 'afterwards', depth: 2, text: 'Afterwards', children: [] },
    ],
  },
]

const TARGET = {
  id: 'doc-1',
  shortId: 'k7m3q9v2rt',
  title: 'Regional failover',
  slug: 'regional-failover',
  updatedAt: '2026-02-03T00:00:00.000Z',
}

const CHILD = {
  id: 'doc-2',
  shortId: CHILD_KEY,
  title: 'Failover drill',
  slug: 'failover-drill',
  updatedAt: '2026-02-04T00:00:00.000Z',
}

/** The link's target, as `GET /api/share/:token` answers it. */
function shared(overrides: Record<string, unknown> = {}) {
  return () =>
    jsonResponse(200, {
      link: { scope: 'document', role: 'viewer', expiresAt: '2026-10-01T00:00:00.000Z' },
      document: TARGET,
      rendered: { revision: 'b'.repeat(40), html: BODY_HTML, outline: OUTLINE, slots: [] },
      children: [],
      ...overrides,
    })
}

const subtree = () =>
  shared({
    link: { scope: 'subtree', role: 'viewer', expiresAt: null },
    children: [{ ...CHILD, children: [] }],
  })()

const childBody = () =>
  jsonResponse(200, {
    document: CHILD,
    rendered: {
      revision: 'c'.repeat(40),
      html: '<article><h1 id="failover-drill">Failover drill</h1><p>Run it quarterly.</p></article>',
      outline: [{ id: 'failover-drill', depth: 1, text: 'Failover drill', children: [] }],
      slots: [],
    },
  })

function shareRoutes(overrides: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/share/{token}': shared(),
    'GET /api/share/{token}/documents/{id}/rendered': childBody,
    ...overrides,
  }
}

/** The one sentence the surface says for every refusal, whatever the reason. */
const NOT_AVAILABLE = 'This link is not available'

/** What the surface says when the request failed rather than the link. */
const COULD_NOT_LOAD = 'This page could not be loaded'

/** The identical refusal, whatever the reason (the contract's one `404`). */
const refused = () => errorResponse(404, 'not_found', 'This link is not valid')

/** Not an answer from the server at all: the connection never arrived. */
const offline = () => {
  throw new TypeError('Failed to fetch')
}

describe('the share-link page', () => {
  it('renders the published body for a reader with no session', async () => {
    renderApp(`/share/${TOKEN}`, shareRoutes())

    const article = await screen.findByRole('article', { name: 'Regional failover' })
    expect(within(article).getByText('How to move traffic between regions.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Regional failover' })).toBeInTheDocument()
  })

  it('says the reader was given a link, and when it runs out', async () => {
    renderApp(`/share/${TOKEN}`, shareRoutes())
    await screen.findByRole('article', { name: 'Regional failover' })

    const header = screen.getByRole('banner')
    expect(header).toHaveTextContent('Quill')
    expect(header).toHaveTextContent('Shared with you · expires 2026-10-01')
  })

  it('says so plainly when the link does not expire', async () => {
    renderApp(`/share/${TOKEN}`, shareRoutes({ 'GET /api/share/{token}': subtree }))
    await screen.findByRole('article', { name: 'Regional failover' })

    expect(screen.getByRole('banner')).toHaveTextContent('this link does not expire')
  })

  it('lists the document’s own sections', async () => {
    renderApp(`/share/${TOKEN}`, shareRoutes())

    const contents = await screen.findByRole('navigation', { name: 'On this page' })
    expect(
      within(contents)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Steps', 'Afterwards'])
  })

  it('carries nothing from the signed-in world, and asks nobody to sign in', async () => {
    const asked: string[] = []
    renderApp(`/share/${TOKEN}`, {
      ...shareRoutes(),
      'GET /api/me': () => {
        asked.push('me')
        return jsonResponse(200, {})
      },
    })
    await screen.findByRole('article', { name: 'Regional failover' })

    // The route is outside `_authenticated`, so nothing ever asks who this is.
    expect(asked).toEqual([])
    expect(screen.queryByRole('navigation', { name: 'Documents' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Sign in/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('sends no cookie with either reading request', async () => {
    const credentials: string[] = []
    renderApp(
      `/share/${TOKEN}`,
      shareRoutes({
        'GET /api/share/{token}': (request) => {
          credentials.push(request.credentials)
          return shared()()
        },
      }),
    )
    await screen.findByRole('article', { name: 'Regional failover' })

    // The server does not read the session on these routes at all, so the
    // cookie has no business travelling with them.
    expect(credentials).toEqual(['omit'])
  })

  it('is in no index', async () => {
    renderApp(`/share/${TOKEN}`, shareRoutes())
    await screen.findByRole('article', { name: 'Regional failover' })

    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    )
  })

  it('has no axe violations', async () => {
    const { container } = renderApp(
      `/share/${TOKEN}`,
      shareRoutes({ 'GET /api/share/{token}': subtree }),
    )
    await screen.findByRole('article', { name: 'Regional failover' })

    await expectNoAccessibilityViolations(container)
  })
})

describe('a subtree link', () => {
  it('offers the documents it opens, and nothing else', async () => {
    renderApp(`/share/${TOKEN}`, shareRoutes({ 'GET /api/share/{token}': subtree }))

    const navigation = await screen.findByRole('navigation', { name: 'Shared documents' })
    expect(navigation.textContent).toContain('Regional failover')
    expect(within(navigation).getByRole('link', { name: 'Failover drill' })).toHaveAttribute(
      'href',
      CHILD_PATH,
    )
  })

  it('reads a child document through its own route', async () => {
    const asked: string[] = []
    renderApp(
      `/share/${TOKEN}`,
      shareRoutes({
        'GET /api/share/{token}': subtree,
        'GET /api/share/{token}/documents/{id}/rendered': (_request, params) => {
          asked.push(params['id'] ?? '')
          return childBody()
        },
      }),
    )

    const navigation = await screen.findByRole('navigation', { name: 'Shared documents' })
    await userEvent.click(within(navigation).getByRole('link', { name: 'Failover drill' }))

    expect(await screen.findByRole('article', { name: 'Failover drill' })).toBeInTheDocument()
    // The address carries the reference, not a bare id (ADR-035).
    expect(asked).toEqual([`failover-drill-${CHILD_KEY}`])
    // The chrome did not move: the link's terms are still on screen.
    expect(screen.getByRole('banner')).toHaveTextContent('Shared with you')
  })

  it('does not read a document because a mouse passed over its title', async () => {
    const user = userEvent.setup()
    const asked: string[] = []
    renderApp(
      `/share/${TOKEN}`,
      shareRoutes({
        'GET /api/share/{token}': subtree,
        'GET /api/share/{token}/documents/{id}/rendered': (_request, params) => {
          asked.push(params['id'] ?? '')
          return childBody()
        },
      }),
    )
    const navigation = await screen.findByRole('navigation', { name: 'Shared documents' })
    const child = within(navigation).getByRole('link', { name: 'Failover drill' })

    await user.hover(child)
    child.focus()
    // The router preloads on intent everywhere else, where a read costs a
    // cached request. Here a read is an audited *use* of the link: it writes
    // an audit row, moves the "last opened" stamp the share dialog reports,
    // and spends an anonymous rate-limit budget of ten a minute — so running
    // an eye down a list would lock the reader out of a link that is good.
    expect(asked).toEqual([])

    await user.click(child)
    expect(await screen.findByRole('article', { name: 'Failover drill' })).toBeInTheDocument()
    expect(asked).toHaveLength(1)
  })

  it('does not offer a navigation at all for a document-scoped link', async () => {
    renderApp(`/share/${TOKEN}`, shareRoutes())
    await screen.findByRole('article', { name: 'Regional failover' })

    expect(screen.queryByRole('navigation', { name: 'Shared documents' })).not.toBeInTheDocument()
  })
})

describe('a link that does not open anything', () => {
  it('says the same thing for a token nobody issued', async () => {
    renderApp(`/share/${TOKEN}`, { 'GET /api/share/{token}': refused })

    expect(await screen.findByRole('heading', { name: NOT_AVAILABLE })).toBeInTheDocument()
    expect(screen.queryByText('Regional failover')).not.toBeInTheDocument()
  })

  it('says the same thing for an expired or revoked link', async () => {
    // Indistinguishable on the wire, and therefore indistinguishable here:
    // both arrive as the contract's one `404`.
    renderApp(`/share/${TOKEN}`, { 'GET /api/share/{token}': refused })

    expect(await screen.findByRole('heading', { name: NOT_AVAILABLE })).toBeInTheDocument()
    expect(screen.getByText(/expired, been revoked, or never have existed/)).toBeInTheDocument()
  })

  it('offers no way into the application from it', async () => {
    renderApp(`/share/${TOKEN}`, { 'GET /api/share/{token}': refused })
    await screen.findByRole('heading', { name: NOT_AVAILABLE })

    // There is nowhere to send somebody who has no account, so nothing is
    // offered — least of all a sign-in wall in front of the content.
    expect(screen.queryAllByRole('link')).toEqual([])
  })

  it('says the same thing for a document that has left the link’s scope', async () => {
    renderApp(CHILD_PATH, {
      'GET /api/share/{token}': subtree,
      'GET /api/share/{token}/documents/{id}/rendered': refused,
    })

    expect(await screen.findByRole('heading', { name: NOT_AVAILABLE })).toBeInTheDocument()
    // The link itself is still good, so its chrome is still around the answer.
    expect(screen.getByRole('banner')).toHaveTextContent('Shared with you')
  })

  it('has no axe violations', async () => {
    const { container } = renderApp(`/share/${TOKEN}`, { 'GET /api/share/{token}': refused })
    await screen.findByRole('heading', { name: NOT_AVAILABLE })

    await expectNoAccessibilityViolations(container)
  })
})

describe('a request that failed rather than a link that is closed', () => {
  it('does not tell a reader their link is dead because the network is', async () => {
    renderApp(`/share/${TOKEN}`, { 'GET /api/share/{token}': offline })

    // Every *refusal* is indistinguishable, which is the contract; a failure
    // that is not a refusal says nothing about the link and is not dressed up
    // as one, or a reader throws away a link that still works.
    expect(await screen.findByRole('heading', { name: COULD_NOT_LOAD })).toBeInTheDocument()
    expect(screen.queryByText(NOT_AVAILABLE)).not.toBeInTheDocument()
  })

  it('offers no way into the application from it either', async () => {
    renderApp(`/share/${TOKEN}`, { 'GET /api/share/{token}': offline })
    await screen.findByRole('heading', { name: COULD_NOT_LOAD })

    // The root error boundary would have offered "Go to your workspaces",
    // which on this surface is a sign-in wall in front of content a stranger
    // was legitimately given.
    expect(screen.queryAllByRole('link')).toEqual([])
    expect(screen.getByRole('banner')).toHaveTextContent('Quill')
  })

  it('says the same about a child document inside a good link', async () => {
    renderApp(CHILD_PATH, {
      'GET /api/share/{token}': subtree,
      'GET /api/share/{token}/documents/{id}/rendered': offline,
    })

    expect(await screen.findByRole('heading', { name: COULD_NOT_LOAD })).toBeInTheDocument()
    // The link itself answered, so its chrome is still around the failure.
    expect(screen.getByRole('banner')).toHaveTextContent('Shared with you')
  })
})
