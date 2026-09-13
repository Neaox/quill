import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../lib/api/testing.ts'

/**
 * The route tree's own behaviour: who is let in, what is loaded before a page
 * renders, what a missing thing answers, and — the one this file exists for —
 * that the workspace shell is rendered once and survives every navigation
 * inside the workspace.
 */

const me = (overrides: Record<string, unknown> = {}) =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'reader@example.com',
    displayName: 'Reader',
    emailVerified: true,
    isInstanceAdmin: false,
    ...overrides,
  })

const WORKSPACE_ID = 'e3b0c442-98fc-1fc2-8f13-1a2b3c4d5e6f'

const workspace = () =>
  jsonResponse(200, {
    id: WORKSPACE_ID,
    unitId: 'unit-1',
    name: 'Acme',
    slug: 'acme',
    createdAt: '2026-01-01T00:00:00.000Z',
  })

/**
 * Two documents, each with the ten-character public handle ADR-035 gives every
 * document, so an address in these tests is the one a person would actually
 * see: `<title-slug>-<key>`.
 */
const DOCUMENTS = [
  { id: '11111111-2222-3333-4444-555555555555', shortId: 'k7m3q9v2rt', title: 'First page' },
  { id: '66666666-7777-8888-9999-aaaaaaaaaaaa', shortId: 'p4n8w2cx5b', title: 'Second page' },
] as const

const FIRST = DOCUMENTS[0]
const SECOND = DOCUMENTS[1]

function reference(document: (typeof DOCUMENTS)[number]): string {
  return `${document.title.toLowerCase().replaceAll(' ', '-')}-${document.shortId}`
}

/** What `GET /api/documents/{id}` resolves: the id, the bare key, or a reference ending in it. */
function resolveDocument(idOrReference: string): (typeof DOCUMENTS)[number] | undefined {
  return DOCUMENTS.find(
    (candidate) =>
      candidate.id === idOrReference ||
      candidate.shortId === idOrReference ||
      idOrReference.endsWith(`-${candidate.shortId}`),
  )
}

const documentDto = (document: (typeof DOCUMENTS)[number]) => ({
  id: document.id,
  shortId: document.shortId,
  workspaceId: WORKSPACE_ID,
  collectionId: 'col-1',
  parentId: null,
  slug: document.title.toLowerCase().replaceAll(' ', '-'),
  path: `guides/${document.shortId}.md`,
  title: document.title,
  status: 'draft',
  templateId: null,
  templateVersion: null,
  headRevision: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-03T00:00:00.000Z',
})

const treeNode = (document: (typeof DOCUMENTS)[number]) => ({
  id: document.id,
  shortId: document.shortId,
  title: document.title,
  slug: document.title.toLowerCase().replaceAll(' ', '-'),
  status: 'draft',
  children: [],
})

/** A workspace with two documents, enough to navigate between them. */
function workspaceRoutes(): FakeRoutes {
  return {
    'GET /api/me': () => me(),
    'GET /api/workspaces/{id}': workspace,
    'GET /api/workspaces/{id}/tree': () =>
      jsonResponse(200, {
        collections: [
          {
            id: 'col-1',
            name: 'Guides',
            slug: 'guides',
            documents: [treeNode(FIRST), treeNode(SECOND)],
          },
        ],
      }),
    'GET /api/workspaces/{workspaceId}/documents': () =>
      jsonResponse(200, [documentDto(FIRST), documentDto(SECOND)]),
    'GET /api/documents/{id}': (_request, params) => {
      const found = resolveDocument(params['id'] ?? '')
      return found === undefined
        ? errorResponse(404, 'not_found', 'Document not found')
        : jsonResponse(200, documentDto(found))
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
  }
}

describe('the authentication gate', () => {
  it('redirects a signed-out visit to sign-in with the original path as the return path', async () => {
    const path = `/w/acme/d/${reference(FIRST)}`
    const { router } = renderApp(path, {
      'GET /api/me': () => errorResponse(401, 'unauthenticated', 'Sign in required'),
    })

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ redirect: path })
  })

  it('renders the protected route when the session is valid', async () => {
    renderApp('/w/acme', workspaceRoutes())

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme' })).toBeInTheDocument()
  })
})

describe('the workspace shell', () => {
  it('keeps the same sidebar mounted while moving between two documents', async () => {
    renderApp(`/w/acme/d/${reference(FIRST)}`, workspaceRoutes())

    const sidebar = await screen.findByRole('navigation', { name: 'Documents' })
    const header = screen.getByRole('banner')

    await userEvent.click(await screen.findByRole('link', { name: 'Second page' }))
    await screen.findByRole('link', { name: 'Second page' })

    // Node identity, not "a navigation is present": a shell that unmounted and
    // came back would satisfy the latter while flashing, which is the bug
    // `docs/design/feedback.md` calls a route-structure bug.
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Documents' })).toBe(sidebar)
    })
    expect(screen.getByRole('banner')).toBe(header)
  })

  it('keeps the shell when a document cannot be found', async () => {
    renderApp('/w/acme/d/missing', {
      ...workspaceRoutes(),
      'GET /api/documents/{id}': () => errorResponse(404, 'not_found', 'Document not found'),
    })

    expect(await screen.findByText("We couldn't find that document")).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Documents' })).toBeInTheDocument()
  })

  it('names the document in the tab title when it is opened for editing', async () => {
    renderApp(`/w/acme/d/${reference(FIRST)}/edit`, workspaceRoutes())

    // The editor's own chunk is not what this is about: the loader resolves
    // the title, so the tab is right before the surface has finished loading.
    await waitFor(() => {
      expect(globalThis.document.title).toBe(`Editing ${FIRST.title}`)
    })
  })

  it('keeps the shell when a document cannot be opened for editing', async () => {
    renderApp(`/w/acme/d/${reference(FIRST)}/edit`, {
      ...workspaceRoutes(),
      'GET /api/documents/{id}': () => errorResponse(404, 'not_found', 'Document not found'),
    })

    expect(await screen.findByText("We couldn't find that document")).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Documents' })).toBeInTheDocument()
  })

  it('shows the route notice rather than a raw error screen when a load fails outright', async () => {
    renderApp(`/w/acme/d/${reference(FIRST)}`, {
      ...workspaceRoutes(),
      'GET /api/documents/{id}': () => errorResponse(500, 'internal_error', 'Oops'),
    })

    expect(await screen.findByText("Couldn't load this document")).toBeInTheDocument()
  })

  it('answers a workspace nobody may see with a not-found rather than an error', async () => {
    renderApp('/w/secret', {
      'GET /api/me': () => me(),
      'GET /api/workspaces/{id}': () => errorResponse(403, 'forbidden', 'Not yours'),
    })

    expect(await screen.findByText("We couldn't find that workspace")).toBeInTheDocument()
  })
})

/**
 * ADR-035: the key is the only part of a document address that decides, and
 * the loader corrects the rest. Every one of these was untested before the
 * 2026-09-13 review (M10) — including the two the ADR calls out by name, an
 * old UUID link and a document that has been moved to another workspace.
 */
describe('canonicalising a document address', () => {
  async function openAndSettle(path: string) {
    const { router } = renderApp(path, workspaceRoutes())
    await screen.findByRole('navigation', { name: 'Documents' })
    await waitFor(() => {
      expect(router.state.status).toBe('idle')
    })
    return router
  }

  it('leaves the canonical address alone', async () => {
    const router = await openAndSettle(`/w/acme/d/${reference(FIRST)}`)

    expect(router.state.location.pathname).toBe(`/w/acme/d/${reference(FIRST)}`)
  })

  it('corrects a stale title slug, because the words are advisory', async () => {
    const router = await openAndSettle(`/w/acme/d/the-old-title-${FIRST.shortId}`)

    expect(router.state.location.pathname).toBe(`/w/acme/d/${reference(FIRST)}`)
  })

  it('fills in the words when the address is the bare key', async () => {
    const router = await openAndSettle(`/w/acme/d/${FIRST.shortId}`)

    expect(router.state.location.pathname).toBe(`/w/acme/d/${reference(FIRST)}`)
  })

  it('still resolves an old UUID link, and rewrites it to the readable form', async () => {
    const router = await openAndSettle(`/w/acme/d/${FIRST.id}`)

    expect(router.state.location.pathname).toBe(`/w/acme/d/${reference(FIRST)}`)
  })

  it('corrects the workspace segment for a document that has been moved', async () => {
    const router = await openAndSettle(`/w/archive/d/${reference(FIRST)}`)

    expect(router.state.location.pathname).toBe(`/w/acme/d/${reference(FIRST)}`)
  })

  it('leaves a workspace segment that names this workspace by its id, because it is not wrong', async () => {
    const router = await openAndSettle(`/w/${WORKSPACE_ID}/d/${reference(FIRST)}`)

    expect(router.state.location.pathname).toBe(`/w/${WORKSPACE_ID}/d/${reference(FIRST)}`)
  })

  it('replaces rather than pushes, so Back does not land on the address just left', async () => {
    const router = await openAndSettle(`/w/acme/d/${FIRST.shortId}`)

    // One entry, not two: the corrected address took the place of the one
    // typed rather than stacking on top of it.
    expect(router.history.length).toBe(1)
  })
})

describe('presenting a document', () => {
  it('names the document in the tab title once its body is loaded', async () => {
    renderApp(`/w/acme/d/${reference(FIRST)}/present`, {
      ...workspaceRoutes(),
      'GET /api/documents/{id}/rendered': () =>
        jsonResponse(200, {
          revision: 'a'.repeat(40),
          html: '<article><h1 id="first">First page</h1><p>Body.</p></article>',
          outline: [{ id: 'first', depth: 1, text: 'First page', children: [] }],
          slots: [],
        }),
    })

    await waitFor(() => {
      expect(globalThis.document.title).toBe(`Presenting ${FIRST.title}`)
    })
  })

  it('says there is nothing to present when the document is gone', async () => {
    renderApp(`/w/acme/d/${reference(FIRST)}/present`, {
      ...workspaceRoutes(),
      'GET /api/documents/{id}': () => errorResponse(404, 'not_found', 'Document not found'),
    })

    expect(await screen.findByText("We couldn't find that document")).toBeInTheDocument()
  })

  it('is an empty state, not a failure, for a document that has never been published', async () => {
    renderApp(`/w/acme/d/${reference(FIRST)}/present`, workspaceRoutes())

    expect(await screen.findByText('Nothing published yet')).toBeInTheDocument()
  })
})

describe('the administration route', () => {
  it('is not there for somebody who is not an instance administrator', async () => {
    renderApp('/admin/organisation', { 'GET /api/me': () => me() })

    expect(await screen.findByText('This page is not available')).toBeInTheDocument()
  })

  it('loads the units and workspaces before it renders, for an administrator', async () => {
    renderApp('/admin/organisation', {
      'GET /api/me': () => me({ isInstanceAdmin: true }),
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
      'GET /api/workspaces': () => jsonResponse(200, []),
    })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Organisation' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
  })
})
