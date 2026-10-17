import { act, screen, waitFor, within } from '@testing-library/react'
import { parseMarkdown } from '@quill/markdown'
import { toast } from '@quill/ui'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { DRAFT_CONTENT_VERSION } from '../../lib/documents/draft-content.ts'
import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { createFakeIndexedDb } from '../../lib/recovery/testing.ts'
import { OFFLINE_LABEL } from './editor-status.tsx'

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
    // Typing schedules an autosave, and a test that finishes before the
    // debounce fires would otherwise leave the save rejecting against a route
    // that is not there — an unhandled rejection that fails the whole run.
    // The tests that are *about* autosave override this and watch what it
    // receives.
    'PUT /api/documents/{id}/draft': () =>
      jsonResponse(200, { draftVersion: 4, updatedAt: '2026-02-03T00:05:00.000Z' }),
    'GET /api/documents/{id}/envelope': envelope(),
    'POST /api/documents/{id}/lock/acquire': () => jsonResponse(200, { lock: LOCK }),
    'DELETE /api/documents/{id}/lock': () => new Response(null, { status: 204 }),
    ...overrides,
  }
}

/** The image dialog, opened the way a writer opens it: the slash menu. */
async function openImageDialog(): Promise<HTMLElement> {
  const surface = screen.getByRole('textbox', { name: 'Regional failover' })
  await userEvent.click(surface)
  await userEvent.keyboard('/image')
  await userEvent.click(await screen.findByRole('option', { name: /Image/ }))
  return screen.findByRole('dialog', { name: 'Insert an image' })
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

  it('mounts with the organisation’s labels, even when the theme answers late (ADR-037)', async () => {
    const labelled = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Sold on ' },
            {
              type: 'textDirective',
              name: 'airbnb',
              attributes: {},
              children: [{ type: 'text', value: 'Airbnb' }],
            },
          ],
        },
      ],
    }
    await openEditor(
      editorRoutes({
        'GET /api/documents/{id}/draft': draft({
          ast: { version: DRAFT_CONTENT_VERSION, frontMatter: {}, ast: labelled },
        }),
        'GET /api/settings/organisation/theme': async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return jsonResponse(200, {
            themeId: 'instrument',
            stylesheetHref: '/api/settings/organisation/theme.css?v=1',
            attributes: {},
            labels: ['airbnb'],
          })
        },
      }),
    )

    const surface = screen.getByRole('textbox', { name: 'Regional failover' })
    const label = within(surface).getByText('Airbnb')
    expect(label.closest('.badge')).toHaveAttribute('data-label', 'airbnb')
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

    // The lock is taken again once by itself; a server that still refuses
    // leaves it to the author, with the edit kept.
    await waitFor(
      () => {
        const notice = screen.getByRole('group', { name: 'Danger: Your lock was lost' })
        expect(within(notice).getByText(/held safely in this browser/)).toBeInTheDocument()
        expect(
          within(notice).getByRole('button', { name: 'Take the lock again' }),
        ).toBeInTheDocument()
      },
      { timeout: 6000 },
    )
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
        'GET /api/documents/{id}/compare': () =>
          jsonResponse(200, {
            html: '<article><p data-change="changed" data-change-id="c1">is</p></article>',
            summary: {
              sections: 1,
              added: 0,
              removed: 0,
              changed: 1,
              moved: 0,
              wordsAdded: 1,
              wordsRemoved: 1,
            },
            changes: [],
            sections: [],
            properties: [],
          }),
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))
    const dialog = await screen.findByRole('dialog', { name: 'Someone else published first' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'See what changed' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: /^Changes between/ }),
    ).toBeInTheDocument()
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
   * real dialog now, so the address is asked for the way every other value is,
   * and it gained an Upload panel with attachments (ADR-011).
   */
  it('asks for an address in a labelled dialog rather than inserting a broken image', async () => {
    await openEditor()
    const surface = screen.getByRole('textbox', { name: 'Regional failover' })

    const dialog = await openImageDialog()
    const field = within(dialog).getByLabelText('Image address', { exact: false })
    expect(within(dialog).getByRole('button', { name: 'Insert' })).toBeDisabled()

    await userEvent.type(field, 'https://example.com/map.png')
    // An address alone is not enough: a picture nobody can read is not a
    // document, so Insert stays unavailable until it is described.
    expect(within(dialog).getByRole('button', { name: 'Insert' })).toBeDisabled()

    await userEvent.type(
      within(dialog).getByLabelText('Alternative text', { exact: false }),
      'A map of the regions',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }))

    expect(screen.queryByRole('dialog', { name: 'Insert an image' })).not.toBeInTheDocument()
    const image = surface.querySelector('img')
    expect(image).toHaveAttribute('src', 'https://example.com/map.png')
    expect(image).toHaveAttribute('alt', 'A map of the regions')
  })

  it('uploads a chosen file and inserts the attachment it became', async () => {
    await openEditor(
      editorRoutes({
        'POST /api/documents/{id}/attachments': () =>
          jsonResponse(201, {
            id: 'attachment-1',
            documentId: 'doc-1',
            url: '/api/attachments/attachment-1',
            filename: 'diagram.png',
            contentType: 'image/png',
            size: 12,
            sha256: 'a'.repeat(64),
            uploadedBy: 'user-1',
            createdAt: '2026-02-03T00:00:00.000Z',
          }),
      }),
    )
    const surface = screen.getByRole('textbox', { name: 'Regional failover' })

    const dialog = await openImageDialog()
    await userEvent.upload(
      within(dialog).getByLabelText('Image file', { exact: false }),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'diagram.png', { type: 'image/png' }),
    )
    await userEvent.type(
      within(dialog).getByLabelText('Alternative text', { exact: false }),
      'The failover sequence',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Insert an image' })).not.toBeInTheDocument()
    })
    const image = surface.querySelector('img')
    expect(image).toHaveAttribute('src', '/api/attachments/attachment-1')
    expect(image).toHaveAttribute('alt', 'The failover sequence')
  })

  it('inserts a link, not an image, for a file that is not a picture', async () => {
    await openEditor(
      editorRoutes({
        'POST /api/documents/{id}/attachments': () =>
          jsonResponse(201, {
            id: 'attachment-2',
            documentId: 'doc-1',
            url: '/api/attachments/attachment-2',
            filename: 'runbook.pdf',
            contentType: 'application/pdf',
            size: 4096,
            sha256: 'b'.repeat(64),
            uploadedBy: 'user-1',
            createdAt: '2026-02-03T00:00:00.000Z',
          }),
      }),
    )
    const surface = screen.getByRole('textbox', { name: 'Regional failover' })

    const dialog = await openImageDialog()
    await userEvent.upload(
      within(dialog).getByLabelText('Image file', { exact: false }),
      new File(['%PDF-1.7'], 'runbook.pdf', { type: 'application/pdf' }),
    )
    // The field asks for link text rather than alternative text, because what
    // is being inserted is a link.
    await userEvent.type(
      within(dialog).getByLabelText('Link text', { exact: false }),
      'The failover runbook',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Insert an image' })).not.toBeInTheDocument()
    })
    // An `<img>` pointing at a PDF is a broken image; a link is what this is.
    expect(surface.querySelector('img')).toBeNull()
    const link = surface.querySelector('a')
    expect(link).toHaveAttribute('href', '/api/attachments/attachment-2')
    expect(link).toHaveTextContent('The failover runbook')
  })

  it('refuses a file over the cap before sending it, and says why', async () => {
    let attempted = 0
    await openEditor(
      editorRoutes({
        'POST /api/documents/{id}/attachments': () => {
          attempted += 1
          return jsonResponse(201, {})
        },
      }),
    )

    const dialog = await openImageDialog()
    const enormous = new File([new Uint8Array(16)], 'enormous.png', { type: 'image/png' })
    Object.defineProperty(enormous, 'size', { value: 40 * 1024 * 1024 })
    await userEvent.upload(within(dialog).getByLabelText('Image file', { exact: false }), enormous)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/over the 25 MB limit/)
    expect(within(dialog).getByRole('button', { name: 'Insert' })).toBeDisabled()
    expect(attempted).toBe(0)
  })

  it('keeps the dialog open with the reason when the server refuses the file', async () => {
    await openEditor(
      editorRoutes({
        'POST /api/documents/{id}/attachments': () =>
          errorResponse(
            422,
            'file_type_not_allowed',
            'SVG files are not accepted: an SVG is a document that can carry scripts.',
          ),
      }),
    )
    const surface = screen.getByRole('textbox', { name: 'Regional failover' })

    const dialog = await openImageDialog()
    await userEvent.upload(
      within(dialog).getByLabelText('Image file', { exact: false }),
      // What the person actually chose: an SVG renamed `.png`, which the
      // browser declares as `image/png` and only the server can see through.
      new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.png', { type: 'image/png' }),
    )
    await userEvent.type(
      within(dialog).getByLabelText('Alternative text', { exact: false }),
      'A logo',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/SVG files are not accepted/)
    expect(screen.getByRole('dialog', { name: 'Insert an image' })).toBeInTheDocument()
    expect(surface.querySelector('img')).toBeNull()
  })

  it('opens the dialog on a file dropped onto the document', async () => {
    await openEditor()
    const surface = screen.getByRole('textbox', { name: 'Regional failover' })
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'pasted.png', {
      type: 'image/png',
    })

    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: Object.assign([file], { item: () => file }),
        getData: () => '',
        types: ['Files'],
      },
    })
    await act(async () => {
      surface.dispatchEvent(event)
    })

    const dialog = await screen.findByRole('dialog', { name: 'Insert an image' })
    expect(within(dialog).getByText(/Ready to upload: pasted.png/)).toBeInTheDocument()
    // The file is there; the description is not, so nothing can be inserted yet.
    expect(within(dialog).getByRole('button', { name: 'Insert' })).toBeDisabled()
  })

  it('has no axe violations with the image dialog open', async () => {
    await openEditor()
    const dialog = await openImageDialog()

    // The dialog rather than the page: Radix marks everything behind a modal
    // `aria-hidden`, and axe reports that background — correctly inert, and
    // not what this test is about — as focusable hidden content.
    await expectNoAccessibilityViolations(dialog)
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
    expect(screen.getByRole('region', { name: 'Properties' })).toBeInTheDocument()
  })

  it('shows who owns the document as a person, which nothing in the shell knew before', async () => {
    await openEditor(
      withProperties({
        'GET /api/documents/{id}/people': () =>
          jsonResponse(200, {
            people: [
              { value: 'sre@example.com', name: 'Site Reliability', detail: 'sre@example.com' },
            ],
          }),
      }),
    )
    const line = screen.getByRole('group', { name: 'Document properties' })
    expect(
      await within(line).findByRole('button', { name: 'Owners: Site Reliability' }),
    ).toBeInTheDocument()
    expect(within(line).getByRole('button', { name: 'Type: runbook' })).toBeInTheDocument()
    expect(within(line).getByRole('button', { name: 'Tags: on-call' })).toBeInTheDocument()
  })

  it('offers what could be set rather than inventing facts when a document names none', async () => {
    await openEditor()
    expect(screen.getByRole('button', { name: 'Add property' })).toBeInTheDocument()
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

    // The fixture's `status` is one an earlier release wrote: the lifecycle
    // is unset, so it is added, and replaces it (ADR-005 amendment).
    await userEvent.click(screen.getByRole('button', { name: 'Add property' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Lifecycle' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /^In review/u }))

    await waitFor(
      () => {
        expect(saved.length).toBeGreaterThan(0)
      },
      { timeout: 4000 },
    )
    expect(saved.at(-1)?.ast.frontMatter).toMatchObject({
      status: 'in-review',
      // Everything the strip has no control for survives the round trip (rule 7).
      somethingNobodyKnows: 'kept',
      id: 'doc-1',
    })
  })

  it('has no axe violations with the properties open', async () => {
    const { container } = await openEditor(withProperties())
    await userEvent.click(screen.getByRole('button', { name: 'All properties' }))

    await expectNoAccessibilityViolations(container)
  })
})

/**
 * Audit 2026-10-11: the five ways the editor could lose an author's work or
 * lie about it, each reproduced through the whole route.
 */
/**
 * A draft endpoint with the server's version rule — stale writes are
 * refused — that can be cut off, and written to by somebody else.
 */
function createDraftServer(initial: unknown = TREE) {
  let current: { ast: unknown; draftVersion: number; writtenBy?: unknown } = {
    ast: initial,
    draftVersion: 3,
  }
  const writes: Array<{ text: string; expectedVersion: number }> = []
  let down = false
  return {
    writes,
    get draft() {
      return current
    },
    cutOff() {
      down = true
    },
    reconnect() {
      down = false
    },
    /** Somebody else saved a draft while this one could not. */
    writeAs(name: string, ast: unknown) {
      current = {
        ast,
        draftVersion: current.draftVersion + 1,
        writtenBy: { userId: `user-${name}`, displayName: name },
      }
    },
    routes: {
      'GET /api/documents/{id}/draft': () =>
        jsonResponse(200, {
          documentId: 'doc-1',
          draftVersion: current.draftVersion,
          baseRevision: 'a'.repeat(40),
          ast: {
            version: DRAFT_CONTENT_VERSION,
            frontMatter: {},
            ast: current.ast,
            ...(current.writtenBy === undefined ? {} : { writtenBy: current.writtenBy }),
          },
          updatedAt: '2026-02-03T00:00:00.000Z',
        }),
      'PUT /api/documents/{id}/draft': async (request: Request) => {
        if (down) return errorResponse(503, 'unavailable', 'Down')
        const body = (await request.json()) as {
          ast: { ast: unknown; writtenBy?: unknown }
          expectedVersion: number
        }
        if (body.expectedVersion !== current.draftVersion) {
          return errorResponse(409, 'stale_version', 'Your draft version is behind', {
            currentVersion: current.draftVersion,
          })
        }
        current = {
          ast: body.ast.ast,
          draftVersion: current.draftVersion + 1,
          writtenBy: body.ast.writtenBy,
        }
        writes.push({ text: JSON.stringify(body.ast.ast), expectedVersion: body.expectedVersion })
        return jsonResponse(200, {
          draftVersion: current.draftVersion,
          updatedAt: '2026-02-03T00:05:00.000Z',
        })
      },
    } satisfies FakeRoutes,
  }
}

describe('the editor keeps the author’s work through failures', () => {
  const SURFACE = { name: 'Regional failover' }

  async function openIn(view: ReturnType<typeof renderApp>) {
    return within(view.container).findByRole('textbox', SURFACE, { timeout: 5000 })
  }

  it('survives a 5xx on a background refresh while editing (P0-2)', async () => {
    let failing = false
    const view = await openEditor(
      editorRoutes({
        'GET /api/documents/{id}': () =>
          failing ? errorResponse(502, 'bad_gateway', 'Bad gateway') : document(),
        'GET /api/documents/{id}/draft': () =>
          failing ? errorResponse(502, 'bad_gateway', 'Bad gateway') : draft()(),
      }),
    )
    // The retry policy has its own tests; this is about what the route does
    // once a refresh has failed for good.
    view.queryClient.setDefaultOptions({ queries: { retry: false } })
    const surface = screen.getByRole('textbox', SURFACE)
    await userEvent.type(surface, ' Then west.')

    failing = true
    await act(async () => {
      await view.queryClient.refetchQueries()
    })

    expect(
      await screen.findByRole('group', { name: 'Note: Couldn’t refresh this document' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', SURFACE)).toHaveTextContent('Then west.')
    expect(screen.queryByText("Couldn't open this document for editing")).not.toBeInTheDocument()
  })

  it('retries a save the server failed with a 502, and says so meanwhile (P0-1)', async () => {
    const saved: string[] = []
    let failures = 1
    await openEditor(
      editorRoutes({
        'PUT /api/documents/{id}/draft': async (request) => {
          if (failures > 0) {
            failures -= 1
            return errorResponse(502, 'bad_gateway', 'Bad gateway')
          }
          saved.push(JSON.stringify(await request.json()))
          return jsonResponse(200, { draftVersion: 4, updatedAt: '2026-02-03T00:05:00.000Z' })
        },
      }),
    )

    await userEvent.type(screen.getByRole('textbox', SURFACE), ' Then west.')

    expect(
      (await screen.findAllByText(OFFLINE_LABEL, {}, { timeout: 4000 })).length,
    ).toBeGreaterThan(0)
    expect(await screen.findByText('draft saved', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toContain('Then west.')
  })

  it('never lets a stale tab overwrite another: it takes the newer draft in first (P0-5)', async () => {
    const server = createDraftServer()
    const routes = editorRoutes(server.routes)
    const tabA = renderApp(EDIT_PATH, routes)
    const tabB = renderApp(EDIT_PATH, routes)
    const surfaceA = await openIn(tabA)
    await openIn(tabB)

    await userEvent.type(surfaceA, ' TAB1')
    await waitFor(() => {
      expect(server.draft.draftVersion).toBe(4)
    })

    // Tab B hears about it before its author types a thing, and carries on
    // from the newer draft rather than writing over it.
    await waitFor(() => {
      expect(within(tabB.container).getByRole('textbox', SURFACE)).toHaveTextContent('TAB1')
    })
    await userEvent.type(within(tabB.container).getByRole('textbox', SURFACE), ' TAB2')
    await waitFor(
      () => {
        expect(server.draft.draftVersion).toBe(5)
      },
      { timeout: 4000 },
    )
    expect(JSON.stringify(server.draft.ast)).toContain('TAB1')
    expect(JSON.stringify(server.draft.ast)).toContain('TAB2')

    // ...and now tab A takes tab B's in.
    await waitFor(() => {
      expect(within(tabA.container).getByRole('textbox', SURFACE)).toHaveTextContent('TAB2')
    })
    tabA.unmount()
    tabB.unmount()
  })

  it('says it is offline, in words, when saves fail though the browser says online', async () => {
    const server = createDraftServer()
    await openEditor(editorRoutes(server.routes))
    server.cutOff()
    await userEvent.type(screen.getByRole('textbox', SURFACE), ' Then west.')
    expect(
      (await screen.findAllByText(OFFLINE_LABEL, {}, { timeout: 4000 })).length,
    ).toBeGreaterThan(0)
    // Typing never waits: the words are in the document all along.
    expect(screen.getByRole('textbox', SURFACE)).toHaveTextContent('Then west.')

    server.reconnect()
    expect(await screen.findByText('draft saved', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(JSON.stringify(server.draft.ast)).toContain('Then west.')
  })

  const TWO_BLOCKS = parseMarkdown('Move traffic east.\n\nPage the on-call.\n')

  it('merges offline changes with what somebody else saved meanwhile, and says so', async () => {
    const info = vi.spyOn(toast, 'info')
    const server = createDraftServer(TWO_BLOCKS)
    await openEditor(editorRoutes(server.routes))
    server.cutOff()
    await userEvent.type(screen.getByRole('textbox', SURFACE), ' Then west.')
    expect(
      (await screen.findAllByText(OFFLINE_LABEL, {}, { timeout: 4000 })).length,
    ).toBeGreaterThan(0)

    server.writeAs('Sam', parseMarkdown('Move traffic east.\n\nPage the on-call, then the lead.\n'))
    server.reconnect()

    await waitFor(
      () => {
        expect(JSON.stringify(server.draft.ast)).toContain('Then west.')
      },
      { timeout: 8000 },
    )
    expect(JSON.stringify(server.draft.ast)).toContain('then the lead')
    expect(screen.getByRole('textbox', SURFACE)).toHaveTextContent('then the lead')
    expect(info).toHaveBeenCalledWith('Merged your offline changes with Sam’s')
    info.mockRestore()
  })

  it('asks the author to resolve a block both people changed, and saves the choice', async () => {
    const server = createDraftServer(TWO_BLOCKS)
    await openEditor(editorRoutes(server.routes))
    server.cutOff()
    await userEvent.type(screen.getByRole('textbox', SURFACE), ' Then west.')
    expect(
      (await screen.findAllByText(OFFLINE_LABEL, {}, { timeout: 4000 })).length,
    ).toBeGreaterThan(0)

    // The writer typed onto the first word of the first block; Sam changed that word.
    server.writeAs('Sam', parseMarkdown('Run traffic east.\n\nPage the on-call.\n'))
    server.reconnect()

    const view = await screen.findByRole(
      'region',
      { name: 'Your offline changes overlap with Sam’s' },
      { timeout: 8000 },
    )
    // Nothing is sent while it is open.
    expect(JSON.stringify(server.draft.ast)).not.toContain('Then west.')
    expect(screen.getByRole('textbox', SURFACE)).toHaveAttribute('contenteditable', 'false')
    await expectNoAccessibilityViolations(view)

    await userEvent.click(within(view).getByRole('radio', { name: 'Keep both' }))
    await userEvent.click(within(view).getByRole('button', { name: 'Save the merged draft' }))
    await waitFor(
      () => {
        expect(JSON.stringify(server.draft.ast)).toContain('Then west.')
      },
      { timeout: 8000 },
    )
    expect(JSON.stringify(server.draft.ast)).toContain('Run traffic east.')
    expect(screen.queryByRole('region', { name: /overlap/ })).not.toBeInTheDocument()
  })

  it('tells the author when somebody merged offline changes into their draft', async () => {
    await openEditor(
      editorRoutes({
        'GET /api/documents/{id}/draft': draft({
          ast: {
            version: DRAFT_CONTENT_VERSION,
            frontMatter: {},
            ast: TREE,
            mergedBy: { userId: 'user-2', displayName: 'Alex' },
          },
        }),
      }),
    )
    expect(
      await screen.findByRole('group', {
        name: 'Note: Alex merged offline changes into this draft',
      }),
    ).toBeInTheDocument()
  })

  it('records an unsent edit under StrictMode and offers it back after a crash (P0-3)', async () => {
    const { factory, rows } = createFakeIndexedDb()
    vi.stubGlobal('indexedDB', factory)
    try {
      const down = renderApp(
        EDIT_PATH,
        editorRoutes({
          'PUT /api/documents/{id}/draft': () => errorResponse(503, 'unavailable', 'Down'),
        }),
        { strictMode: true },
      )
      await userEvent.type(await openIn(down), ' Unsent words.')
      await waitFor(() => {
        expect(JSON.stringify([...rows.values()])).toContain('Unsent words.')
      })

      // The tab dies with the edit unsent.
      down.unmount()

      const saved: string[] = []
      const reloaded = renderApp(
        EDIT_PATH,
        editorRoutes({
          'PUT /api/documents/{id}/draft': async (request) => {
            saved.push(JSON.stringify(await request.json()))
            return jsonResponse(200, { draftVersion: 4, updatedAt: '2026-02-03T00:05:00.000Z' })
          },
        }),
        { strictMode: true },
      )

      expect(await openIn(reloaded)).toHaveTextContent('Unsent words.')
      expect(
        await within(reloaded.container).findByRole('group', {
          name: 'Note: Recovered an unsent edit',
        }),
      ).toBeInTheDocument()
      await waitFor(
        () => {
          expect(saved.join()).toContain('Unsent words.')
        },
        { timeout: 4000 },
      )
      reloaded.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
