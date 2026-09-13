import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { DRAFT_CONTENT_VERSION } from '../../lib/documents/draft-content.ts'
import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'

const me = () =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'writer@example.com',
    displayName: 'Writer',
    emailVerified: true,
    isInstanceAdmin: false,
  })

const workspace = () =>
  jsonResponse(200, {
    id: 'acme',
    unitId: 'unit-1',
    name: 'Engineering',
    slug: 'engineering',
    createdAt: '2026-01-01T00:00:00.000Z',
  })

/** The document's public handle, and the canonical address it makes (ADR-035). */
const KEY = 'k7m3q9v2rt'
const EDIT_PATH = `/w/acme/d/regional-failover-${KEY}/edit`

const document = () =>
  jsonResponse(200, {
    id: 'doc-1',
    shortId: KEY,
    workspaceId: 'acme',
    collectionId: 'col-1',
    parentId: null,
    slug: 'failover',
    path: 'runbooks/failover.md',
    title: 'Regional failover',
    status: 'draft',
    templateId: null,
    templateVersion: null,
    headRevision: 'a'.repeat(40),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-03T00:00:00.000Z',
  })

const TREE = {
  type: 'root',
  children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Move traffic east.' }] }],
}

function draft(overrides: Record<string, unknown> = {}) {
  return () =>
    jsonResponse(200, {
      documentId: 'doc-1',
      draftVersion: 3,
      baseRevision: 'a'.repeat(40),
      ast: {
        version: DRAFT_CONTENT_VERSION,
        frontMatter: { title: 'Regional failover' },
        ast: TREE,
      },
      updatedAt: '2026-02-03T00:00:00.000Z',
      ...overrides,
    })
}

function envelope(permissions: Record<string, boolean> = {}) {
  return () =>
    jsonResponse(200, {
      permissions: { view: true, comment: true, edit: true, manage: false, ...permissions },
      lock: null,
      lastPublished: { revision: 'a'.repeat(40), author: 'Ada', at: '2026-02-03T00:00:00.000Z' },
      review: null,
      health: [],
    })
}

const LOCK = {
  documentId: 'doc-1',
  holderUserId: 'user-1',
  holderSessionId: 'session-1',
  acquiredAt: '2026-02-03T00:00:00.000Z',
  lastHeartbeatAt: '2026-02-03T00:00:00.000Z',
  expiresAt: '2026-02-03T00:01:00.000Z',
}

function editorRoutes(overrides: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': me,
    'GET /api/workspaces/{id}': workspace,
    'GET /api/documents/{id}': document,
    'GET /api/workspaces/{workspaceId}/documents': () => jsonResponse(200, []),
    'GET /api/documents/{id}/draft': draft(),
    'GET /api/documents/{id}/envelope': envelope(),
    'POST /api/documents/{id}/lock/acquire': () => jsonResponse(200, { lock: LOCK }),
    'DELETE /api/documents/{id}/lock': () => new Response(null, { status: 204 }),
    ...overrides,
  }
}

async function openEditor(routes: FakeRoutes = editorRoutes()) {
  const view = renderApp(EDIT_PATH, routes)
  // The route is code-split, so the very first mount in a file also waits for
  // the editor chunk to be imported.
  await screen.findByRole('textbox', { name: 'Regional failover' }, { timeout: 5000 })
  return view
}

describe('the editor route', () => {
  it('opens the draft in the editor and takes the document lock', async () => {
    let acquired = 0
    await openEditor(
      editorRoutes({
        'POST /api/documents/{id}/lock/acquire': () => {
          acquired += 1
          return jsonResponse(200, { lock: LOCK })
        },
      }),
    )

    expect(screen.getByRole('textbox', { name: 'Regional failover' })).toHaveTextContent(
      'Move traffic east.',
    )
    await waitFor(() => {
      expect(acquired).toBe(1)
    })
  })

  it('autosaves what is typed, in the envelope the draft arrived in', async () => {
    const saved: Array<{ ast: { frontMatter: unknown }; expectedVersion: number }> = []
    await openEditor(
      editorRoutes({
        'PUT /api/documents/{id}/draft': async (request) => {
          saved.push(
            (await request.json()) as { ast: { frontMatter: unknown }; expectedVersion: number },
          )
          return jsonResponse(200, { draftVersion: 4, updatedAt: '2026-02-03T00:05:00.000Z' })
        },
      }),
    )

    await userEvent.type(screen.getByRole('textbox', { name: 'Regional failover' }), ' Then west.')

    await waitFor(
      () => {
        expect(saved.length).toBeGreaterThan(0)
      },
      { timeout: 4000 },
    )
    // The front matter the editor never looked at is still there.
    expect(saved[0]?.ast.frontMatter).toEqual({ title: 'Regional failover' })
    expect(saved[0]?.expectedVersion).toBe(3)
    expect(await screen.findByText('draft saved')).toBeInTheDocument()
  })

  it('says the document is held by someone else, and offers no takeover to an editor', async () => {
    await openEditor(
      editorRoutes({
        'POST /api/documents/{id}/lock/acquire': () =>
          errorResponse(409, 'held', 'This document is locked by another editor', {
            holder: { ...LOCK, holderUserId: 'user-2' },
          }),
        'GET /api/documents/{id}/envelope': () =>
          jsonResponse(200, {
            permissions: { view: true, comment: true, edit: true, manage: false },
            lock: {
              holderUserId: 'user-2',
              holderName: 'Grace',
              expiresAt: '2026-02-03T00:01:00.000Z',
            },
            lastPublished: null,
            review: null,
            health: [],
          }),
      }),
    )

    expect(
      await screen.findByRole('group', { name: 'Warning: Grace is editing this document' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take over the lock' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
  })

  it('offers a workspace admin the takeover ADR-021 reserves for them', async () => {
    let takenOver = 0
    await openEditor(
      editorRoutes({
        'GET /api/documents/{id}/envelope': envelope({ manage: true }),
        'POST /api/documents/{id}/lock/acquire': () =>
          errorResponse(409, 'held', 'Locked', { holder: { ...LOCK, holderUserId: 'user-2' } }),
        'POST /api/documents/{id}/lock/takeover': () => {
          takenOver += 1
          return jsonResponse(200, { lock: LOCK })
        },
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Take over the lock' }))

    await waitFor(() => {
      expect(takenOver).toBe(1)
    })
    expect(await screen.findByText('editing')).toBeInTheDocument()
  })

  it('keeps an edit that the server refused, and offers the way back', async () => {
    await openEditor(
      editorRoutes({
        'PUT /api/documents/{id}/draft': () =>
          errorResponse(423, 'lock_lost', 'You do not hold a valid lock', {
            holder: { ...LOCK, holderUserId: 'user-2' },
          }),
      }),
    )

    await userEvent.type(screen.getByRole('textbox', { name: 'Regional failover' }), ' Then west.')

    const notice = await screen.findByRole(
      'group',
      { name: 'Danger: Your lock was lost' },
      {
        timeout: 4000,
      },
    )
    expect(within(notice).getByText(/held safely in this browser/)).toBeInTheDocument()
    expect(within(notice).getByRole('button', { name: 'Take the lock again' })).toBeInTheDocument()
    expect(await screen.findByText('lock lost')).toBeInTheDocument()
  })

  it('publishes the draft against the revision it was based on, then shows it', async () => {
    const published: Array<{ base: string | null }> = []
    await openEditor(
      editorRoutes({
        'POST /api/documents/{id}/publish': async (request) => {
          published.push((await request.json()) as { base: string | null })
          return jsonResponse(200, {
            kind: 'published',
            revision: 'b'.repeat(40),
            warnings: [],
            frontMatterIssues: [],
            incompleteRequiredSections: [],
          })
        },
        'GET /api/documents/{id}/rendered': () =>
          jsonResponse(200, {
            revision: 'b'.repeat(40),
            html: '<article><p>Move traffic east.</p></article>',
            outline: [],
            slots: [],
          }),
        'GET /api/documents/{id}/history': () => jsonResponse(200, { revisions: [] }),
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByRole('article', { name: 'Regional failover' })).toBeInTheDocument()
    expect(published).toEqual([{ base: 'a'.repeat(40) }])
  })

  it('explains a merge, in the three texts a person needs to decide', async () => {
    await openEditor(
      editorRoutes({
        'POST /api/documents/{id}/publish': () =>
          jsonResponse(409, {
            kind: 'merge-required',
            current: 'c'.repeat(40),
            conflicts: [
              {
                documentId: 'doc-1',
                path: 'runbooks/failover.md',
                base: 'the original line',
                ours: 'what we wrote',
                theirs: 'what they published',
                conflicted: '<<<<<<< ours',
              },
            ],
          }),
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))

    const dialog = await screen.findByRole('dialog', { name: 'Someone else published first' })
    expect(within(dialog).getByText(/Nothing has been lost/)).toBeInTheDocument()
    expect(within(dialog).getByText('the original line')).toBeInTheDocument()
    expect(within(dialog).getByText('what we wrote')).toBeInTheDocument()
    expect(within(dialog).getByText('what they published')).toBeInTheDocument()
  })

  it('offers to show what changed, which is the comparison view', async () => {
    await openEditor(
      editorRoutes({
        'POST /api/documents/{id}/publish': () =>
          jsonResponse(409, { kind: 'merge-required', current: 'c'.repeat(40), conflicts: [] }),
        'GET /api/documents/{id}/history': () => jsonResponse(200, { revisions: [] }),
        'GET /api/documents/{id}/diff': () =>
          jsonResponse(200, {
            from: 'a'.repeat(40),
            to: 'c'.repeat(40),
            unified: '@@ -1 +1 @@\n-was\n+is',
            added: 1,
            removed: 1,
          }),
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))
    const dialog = await screen.findByRole('dialog', { name: 'Someone else published first' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'See what changed' }))

    expect(await screen.findByRole('group', { name: 'Unified diff' })).toBeInTheDocument()
  })

  it('refuses to open a draft written by a newer release rather than losing it', async () => {
    renderApp(
      EDIT_PATH,
      editorRoutes({
        'GET /api/documents/{id}/draft': draft({
          ast: { version: 99, frontMatter: {}, ast: TREE },
        }),
      }),
    )

    expect(
      await screen.findByRole('group', { name: 'Danger: This draft cannot be opened' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('reports a draft that cannot be loaded at all', async () => {
    renderApp(
      EDIT_PATH,
      editorRoutes({
        'GET /api/documents/{id}/draft': () => errorResponse(404, 'not_found', 'Draft not found'),
      }),
    )

    expect(await screen.findByText('Draft not found')).toBeInTheDocument()
  })

  /*
   * Review 2026-09-13, M8: this used `window.prompt` — unlabelled, unstyled,
   * outside the focus model, and suppressed outright by some browsers. It is a
   * real dialog now, so the address is asked for the way every other value is.
   */
  it('asks for an address in a labelled dialog rather than inserting a broken image', async () => {
    await openEditor()
    const surface = screen.getByRole('textbox', { name: 'Regional failover' })

    await userEvent.click(surface)
    await userEvent.keyboard('/image')
    await userEvent.click(await screen.findByRole('option', { name: /Image/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Insert an image' })
    const field = within(dialog).getByLabelText('Image address', { exact: false })
    expect(within(dialog).getByRole('button', { name: 'Insert' })).toBeDisabled()

    await userEvent.type(field, 'https://example.com/map.png')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }))

    expect(screen.queryByRole('dialog', { name: 'Insert an image' })).not.toBeInTheDocument()
    expect(surface.querySelector('img')).toHaveAttribute('src', 'https://example.com/map.png')
  })

  it('has no axe violations', async () => {
    const { container } = await openEditor()

    await expectNoAccessibilityViolations(container)
  })
})

describe("the document's properties, where its front matter used to be", () => {
  const withProperties = (overrides: FakeRoutes = {}) =>
    editorRoutes({
      'GET /api/documents/{id}/draft': draft({
        ast: {
          version: DRAFT_CONTENT_VERSION,
          frontMatter: {
            id: 'doc-1',
            title: 'Regional failover',
            type: 'runbook',
            status: 'draft',
            owners: ['sre@example.com'],
            tags: ['on-call'],
            somethingNobodyKnows: 'kept',
          },
          ast: TREE,
        },
      }),
      ...overrides,
    })

  it('never shows the writer YAML', async () => {
    await openEditor(withProperties())
    expect(screen.queryByText(/somethingNobodyKnows:/)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Document properties' })).toBeInTheDocument()
  })

  it('shows who owns the document, which nothing in the shell knew before', async () => {
    await openEditor(withProperties())
    const summary = within(screen.getByRole('list', { name: 'Summary' }))
    expect(summary.getByText('sre@example.com')).toBeInTheDocument()
    expect(summary.getByText('runbook')).toBeInTheDocument()
    expect(summary.getByText('#on-call')).toBeInTheDocument()
  })

  it('says so rather than inventing facts when a document names none', async () => {
    await openEditor()
    expect(screen.getByText('Nothing set yet')).toBeInTheDocument()
  })

  it('saves a changed property into the draft, front matter and all', async () => {
    const saved: Array<{ ast: { frontMatter: Record<string, unknown> } }> = []
    await openEditor(
      withProperties({
        'PUT /api/documents/{id}/draft': async (request) => {
          saved.push((await request.json()) as { ast: { frontMatter: Record<string, unknown> } })
          return jsonResponse(200, { draftVersion: 4, updatedAt: '2026-02-03T00:05:00.000Z' })
        },
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Properties' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'published')

    await waitFor(
      () => {
        expect(saved.length).toBeGreaterThan(0)
      },
      { timeout: 4000 },
    )
    expect(saved.at(-1)?.ast.frontMatter).toMatchObject({
      status: 'published',
      // Everything the strip has no control for survives the round trip (rule 7).
      somethingNobodyKnows: 'kept',
      id: 'doc-1',
    })
  })

  it('has no axe violations with the properties open', async () => {
    const { container } = await openEditor(withProperties())
    await userEvent.click(screen.getByRole('button', { name: 'Properties' }))

    await expectNoAccessibilityViolations(container)
  })
})
