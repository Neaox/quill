import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../lib/api/testing.ts'

/**
 * `/d/<reference>`: the address a link inside a document is stored as
 * (ADR-035). It names a document and nothing else — no workspace, no
 * title that has to be current — so the app resolves it and replaces it with
 * the canonical reading address, keeping the section and the query the link
 * carried (ADR-044). Before this route existed, every such link landed on
 * "We couldn't find that page".
 */

const WORKSPACE_ID = 'e3b0c442-98fc-1fc2-8f13-1a2b3c4d5e6f'
const DOCUMENT = {
  id: '11111111-2222-3333-4444-555555555555',
  shortId: 'k7m3q9v2rt',
  title: 'First page',
} as const
const CANONICAL = `/w/acme/d/first-page-${DOCUMENT.shortId}`

const documentDto = {
  id: DOCUMENT.id,
  shortId: DOCUMENT.shortId,
  workspaceId: WORKSPACE_ID,
  collectionId: 'col-1',
  parentId: null,
  slug: 'first-page',
  path: 'guides/first-page.md',
  title: DOCUMENT.title,
  status: 'draft',
  templateId: null,
  templateVersion: null,
  headRevision: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-03T00:00:00.000Z',
}

function routes(overrides: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': () =>
      jsonResponse(200, {
        id: 'user-1',
        email: 'reader@example.com',
        displayName: 'Reader',
        emailVerified: true,
        isInstanceAdmin: false,
      }),
    'GET /api/workspaces/{id}': () =>
      jsonResponse(200, {
        id: WORKSPACE_ID,
        unitId: 'unit-1',
        name: 'Acme',
        slug: 'acme',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    'GET /api/workspaces/{id}/tree': () =>
      jsonResponse(200, {
        collections: [{ id: 'col-1', name: 'Guides', slug: 'guides', documents: [] }],
      }),
    'GET /api/workspaces/{workspaceId}/documents': () => jsonResponse(200, [documentDto]),
    'GET /api/documents/{id}': (_request, params) => {
      const asked = params['id'] ?? ''
      return asked === DOCUMENT.id || asked.endsWith(DOCUMENT.shortId)
        ? jsonResponse(200, documentDto)
        : errorResponse(404, 'not_found', 'Document not found')
    },
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

async function settle(path: string, overrides: FakeRoutes = {}) {
  const { router } = renderApp(path, routes(overrides))
  await waitFor(() => {
    expect(router.state.status).toBe('idle')
    expect(router.state.isLoading).toBe(false)
  })
  return router
}

const SECOND = {
  id: '66666666-7777-8888-9999-aaaaaaaaaaaa',
  shortId: 'p4n8w2cx5b',
  title: 'Second page',
} as const

/** The first page's body, linking to the second by id and to one of its sections. */
const LINKING_BODY = `<article>
<h1 id="user-content-first-page">First page</h1>
<p>Read <a href="/d/${SECOND.id}#user-content-steps">the second page</a> next.</p>
</article>`

/** Two documents, the first of which links to the second the way a body stores it. */
function linkingRoutes(overrides: FakeRoutes = {}): FakeRoutes {
  const dto = (document: typeof DOCUMENT | typeof SECOND) => ({
    ...documentDto,
    id: document.id,
    shortId: document.shortId,
    title: document.title,
    slug: document.title.toLowerCase().replaceAll(' ', '-'),
  })
  return routes({
    'GET /api/documents/{id}': (_request, params) => {
      const asked = params['id'] ?? ''
      const found = [DOCUMENT, SECOND].find(
        (candidate) => candidate.id === asked || asked.endsWith(candidate.shortId),
      )
      return found === undefined
        ? errorResponse(404, 'not_found', 'Document not found')
        : jsonResponse(200, dto(found))
    },
    'GET /api/documents/{id}/rendered': () =>
      jsonResponse(200, {
        revision: 'b'.repeat(40),
        html: LINKING_BODY,
        outline: [{ id: 'user-content-first-page', depth: 1, text: 'First page', children: [] }],
        slots: [],
      }),
    'POST /api/documents/links': () => jsonResponse(200, { links: [] }),
    ...overrides,
  })
}

describe('following a link in a body', () => {
  it('shows the link under the readable address, from one request for the whole body', async () => {
    let asked: unknown
    let requests = 0
    renderApp(
      CANONICAL,
      linkingRoutes({
        'POST /api/documents/links': async (request) => {
          requests += 1
          asked = await request.json()
          return jsonResponse(200, {
            links: [{ reference: SECOND.id, href: `/w/acme/d/second-page-${SECOND.shortId}` }],
          })
        },
      }),
    )

    const link = await screen.findByRole('link', { name: 'the second page' })
    await waitFor(() => {
      expect(link).toHaveAttribute(
        'href',
        `/w/acme/d/second-page-${SECOND.shortId}#user-content-steps`,
      )
    })
    expect(asked).toEqual({ references: [SECOND.id] })
    expect(requests).toBe(1)
  })

  it('moves to the linked document through the router, landing on its section', async () => {
    const { router } = renderApp(CANONICAL, linkingRoutes())

    await userEvent.click(await screen.findByRole('link', { name: 'the second page' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/w/acme/d/second-page-${SECOND.shortId}`)
    })
    expect(router.state.location.hash).toBe('user-content-steps')
    // In history after the page it was followed from, so Back returns there.
    expect(router.history.length).toBe(2)
  })
})

describe('following a link while presenting', () => {
  it('moves to the linked document through the router rather than reloading', async () => {
    const { router } = renderApp(`${CANONICAL}/present`, linkingRoutes())

    await userEvent.click(await screen.findByRole('link', { name: 'the second page' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/w/acme/d/second-page-${SECOND.shortId}`)
    })
  })
})

describe('a link to a document by its id', () => {
  it('opens the document rather than a page that is not there (the original defect)', async () => {
    const router = await settle(`/d/${DOCUMENT.id}`)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(CANONICAL)
    })
    expect(screen.queryByText("We couldn't find that page")).not.toBeInTheDocument()
  })

  it.each([DOCUMENT.shortId, `an-old-title-${DOCUMENT.shortId}`])(
    'resolves the key %s, with or without words, whatever the words say',
    async (reference) => {
      const router = await settle(`/d/${reference}`)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe(CANONICAL)
      })
    },
  )

  it('keeps the section and the query the link carried', async () => {
    const router = await settle(`/d/${DOCUMENT.id}?rev=abc123#user-content-install`)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(CANONICAL)
    })
    expect(router.state.location.search).toEqual({ rev: 'abc123' })
    expect(router.state.location.hash).toBe('user-content-install')
  })

  it('replaces the address rather than pushing, so Back does not return to it', async () => {
    const router = await settle(`/d/${DOCUMENT.shortId}`)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(CANONICAL)
    })
    expect(router.history.length).toBe(1)
  })

  it('answers a document nobody may see with a not-found inside the signed-in frame', async () => {
    await settle('/d/p4n8w2cx5b', {
      'GET /api/documents/{id}': () => errorResponse(403, 'forbidden', 'Not yours'),
    })

    expect(await screen.findByText("We couldn't find that document")).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('answers a reference that names nothing without asking the API', async () => {
    let asked = false
    await settle('/d/not-a-reference', {
      'GET /api/documents/{id}': () => {
        asked = true
        return errorResponse(404, 'not_found', 'Document not found')
      },
    })

    expect(await screen.findByText("We couldn't find that document")).toBeInTheDocument()
    expect(asked).toBe(false)
  })

  it('says so, in the same frame, when the lookup fails outright', async () => {
    await settle(`/d/${DOCUMENT.id}`, {
      'GET /api/documents/{id}': () => errorResponse(500, 'internal_error', 'Oops'),
    })

    expect(await screen.findByText("Couldn't open this link")).toBeInTheDocument()
  })
})
