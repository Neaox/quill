import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { toast } from '@quill/ui'
import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { DRAFT_CONTENT_VERSION } from '../../lib/documents/draft-content.ts'
import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { createFakeIndexedDb } from '../../lib/recovery/testing.ts'

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
      permissions: {
        view: true,
        comment: true,
        edit: true,
        publish: true,
        manage: false,
        ...permissions,
      },
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

  it('previews the unpublished changes, in a new tab, from the editor', async () => {
    await openEditor()

    const link = screen.getByRole('link', { name: /^Preview\s+your unpublished changes/u })

    expect(link.getAttribute('href')).toBe(`/preview/d/regional-failover-${KEY}?draft`)
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('is left with Done: the draft is saved, the lock is let go, nothing is published', async () => {
    const calls: string[] = []
    await openEditor(
      editorRoutes({
        'PUT /api/documents/{id}/draft': () => {
          calls.push('save')
          return jsonResponse(200, { draftVersion: 4, updatedAt: '2026-02-03T00:05:00.000Z' })
        },
        'DELETE /api/documents/{id}/lock': () => {
          calls.push('release')
          return new Response(null, { status: 204 })
        },
        'POST /api/documents/{id}/publish': () => {
          calls.push('publish')
          return jsonResponse(500, {})
        },
        'GET /api/documents/{id}/rendered': () =>
          jsonResponse(200, {
            revision: 'a'.repeat(40),
            html: '<article><p>Move traffic east.</p></article>',
            outline: [],
            slots: [],
          }),
        'GET /api/documents/{id}/history': () => jsonResponse(200, { revisions: [] }),
      }),
    )
    await userEvent.type(screen.getByRole('textbox', { name: 'Regional failover' }), ' Then west.')

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(await screen.findByRole('article', { name: 'Regional failover' })).toBeInTheDocument()
    expect(calls).toContain('save')
    expect(calls.indexOf('save')).toBeLessThan(calls.indexOf('release'))
    expect(calls).not.toContain('publish')
  })

  it('offers Done even while somebody else holds the document, because leaving is always allowed', async () => {
    await openEditor(
      editorRoutes({
        'POST /api/documents/{id}/lock/acquire': () =>
          errorResponse(409, 'held', 'This document is locked by another editor', {
            holder: { ...LOCK, holderUserId: 'user-2' },
          }),
      }),
    )

    expect(await screen.findByRole('button', { name: 'Done' })).toBeEnabled()
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
            permissions: { view: true, comment: true, edit: true, publish: true, manage: false },
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
    expect(screen.queryByRole('button', { name: /^Take over from/u })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
  })

  it('gives a contributor the way to get a change live: asking for a review, not publishing', async () => {
    await openEditor(
      editorRoutes({
        'GET /api/documents/{id}/envelope': envelope({ publish: false }),
        'GET /api/documents/{id}/review': () => jsonResponse(200, { request: null }),
      }),
    )

    expect(await screen.findByRole('button', { name: 'Request review' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
  })

  it('lets an editor ask for a review too, beside Publish', async () => {
    await openEditor(
      editorRoutes({
        'GET /api/documents/{id}/review': () => jsonResponse(200, { request: null }),
      }),
    )

    expect(await screen.findByRole('button', { name: 'Request review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument()
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

    await userEvent.click(await screen.findByRole('button', { name: /^Take over from/u }))

    await waitFor(() => {
      expect(takenOver).toBe(1)
    })
    expect(await screen.findByText('editing')).toBeInTheDocument()
  })

  it('tells apart resuming a lost lock and taking it over, and offers the second only to a manager', async () => {
    const refused = {
      'PUT /api/documents/{id}/draft': () =>
        errorResponse(423, 'lock_lost', 'You do not hold a valid lock', {
          holder: { ...LOCK, holderUserId: 'user-2' },
        }),
    }
    await openEditor(
      editorRoutes({ ...refused, 'GET /api/documents/{id}/envelope': envelope({ manage: true }) }),
    )

    await userEvent.type(screen.getByRole('textbox', { name: 'Regional failover' }), ' Then west.')

    const notice = await screen.findByRole(
      'group',
      { name: 'Danger: Your lock was lost' },
      { timeout: 4000 },
    )
    // Each says what it does: one gets the lock back if it is free, the other ends someone's session.
    expect(notice).toHaveTextContent(/if nobody else has taken the document since/u)
    expect(notice).toHaveTextContent(/ends their session/u)
    expect(within(notice).getByRole('button', { name: 'Resume editing' })).toBeInTheDocument()
    expect(within(notice).getByRole('button', { name: /^Take over from/u })).toBeInTheDocument()
  })

  describe('after the lock is pressed for again', () => {
    /** An editor whose lock is lost on the first save, and answers the next ask as told. */
    async function lostLock(
      next: () => Response,
      options: { manage?: boolean } = {},
    ): Promise<HTMLElement> {
      let asked = 0
      await openEditor(
        editorRoutes({
          'GET /api/documents/{id}/envelope': envelope({ manage: options.manage ?? false }),
          'PUT /api/documents/{id}/draft': () =>
            errorResponse(423, 'lock_lost', 'You do not hold a valid lock', {
              holder: { ...LOCK, holderUserId: 'user-2' },
            }),
          'POST /api/documents/{id}/lock/acquire': () => {
            asked += 1
            return asked === 1 ? jsonResponse(200, { lock: LOCK }) : next()
          },
          'POST /api/documents/{id}/lock/takeover': () => jsonResponse(200, { lock: LOCK }),
        }),
      )
      await userEvent.type(
        screen.getByRole('textbox', { name: 'Regional failover' }),
        ' Then west.',
      )
      return await screen.findByRole(
        'group',
        { name: 'Danger: Your lock was lost' },
        { timeout: 4000 },
      )
    }

    it('says the lock is back, so nobody has to wonder whether it worked', async () => {
      const success = vi.spyOn(toast, 'success')
      const notice = await lostLock(() => jsonResponse(200, { lock: LOCK }))

      await userEvent.click(within(notice).getByRole('button', { name: 'Resume editing' }))

      await waitFor(() => {
        expect(success).toHaveBeenCalledWith(expect.stringMatching(/You have the lock again/u))
      })
    })

    it('says who it was taken from, when a manager takes over', async () => {
      const success = vi.spyOn(toast, 'success')
      const notice = await lostLock(() => jsonResponse(200, { lock: LOCK }), { manage: true })

      await userEvent.click(within(notice).getByRole('button', { name: /^Take over from/u }))

      await waitFor(() => {
        expect(success).toHaveBeenCalledWith(expect.stringMatching(/You took over from/u))
      })
    })

    it('says why, and that the edit is safe, when someone else has the lock', async () => {
      const danger = vi.spyOn(toast, 'danger')
      const notice = await lostLock(() =>
        errorResponse(409, 'held', 'Locked', { holder: { ...LOCK, holderUserId: 'user-2' } }),
      )

      await userEvent.click(within(notice).getByRole('button', { name: 'Resume editing' }))

      await waitFor(() => {
        expect(danger).toHaveBeenCalledWith(
          expect.stringMatching(/is editing now.*safe in this browser/u),
        )
      })
    })
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
    expect(within(notice).getByRole('button', { name: 'Resume editing' })).toBeInTheDocument()
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

/**
 * Audit 2026-10-11: the five ways the editor could lose an author's work or
 * lie about it, each reproduced through the whole route.
 */
describe('the editor keeps the author’s work through failures', () => {
  const SURFACE = { name: 'Regional failover' }

  /** A draft endpoint with the server's version rule: stale writes are refused. */
  function createDraftServer() {
    let current = { ast: TREE as unknown, draftVersion: 3 }
    const writes: Array<{ text: string; expectedVersion: number }> = []
    return {
      writes,
      get draft() {
        return current
      },
      routes: {
        'GET /api/documents/{id}/draft': () =>
          jsonResponse(200, {
            documentId: 'doc-1',
            draftVersion: current.draftVersion,
            baseRevision: 'a'.repeat(40),
            ast: { version: DRAFT_CONTENT_VERSION, frontMatter: {}, ast: current.ast },
            updatedAt: '2026-02-03T00:00:00.000Z',
          }),
        'PUT /api/documents/{id}/draft': async (request: Request) => {
          const body = (await request.json()) as {
            ast: { ast: unknown }
            expectedVersion: number
          }
          if (body.expectedVersion !== current.draftVersion) {
            return errorResponse(409, 'stale_version', 'Your draft version is behind', {
              currentVersion: current.draftVersion,
            })
          }
          current = { ast: body.ast.ast, draftVersion: current.draftVersion + 1 }
          writes.push({ text: JSON.stringify(body.ast.ast), expectedVersion: body.expectedVersion })
          return jsonResponse(200, {
            draftVersion: current.draftVersion,
            updatedAt: '2026-02-03T00:05:00.000Z',
          })
        },
      } satisfies FakeRoutes,
    }
  }

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

    expect(await screen.findByText('not saved — retrying', {}, { timeout: 4000 })).toBeVisible()
    expect(await screen.findByText('draft saved', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toContain('Then west.')
  })

  it('never lets a stale tab overwrite another, and reloads for real (P0-5)', async () => {
    const server = createDraftServer()
    const routes = editorRoutes(server.routes)
    const tabA = renderApp(EDIT_PATH, routes)
    const tabB = renderApp(EDIT_PATH, routes)
    const surfaceA = await openIn(tabA)
    const surfaceB = await openIn(tabB)

    await userEvent.type(surfaceA, ' TAB1')
    await waitFor(() => {
      expect(server.draft.draftVersion).toBe(4)
    })

    // Tab B hears about it before its author types a thing.
    const notice = await within(tabB.container).findByRole('group', {
      name: 'Warning: This draft changed somewhere else',
    })

    // Typing in the stale tab sends nothing over tab A's save.
    await userEvent.type(surfaceB, ' TAB2')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(server.draft.draftVersion).toBe(4)
    expect(JSON.stringify(server.draft.ast)).toContain('TAB1')
    expect(JSON.stringify(server.draft.ast)).not.toContain('TAB2')

    // Reloading really replaces the content, and sets the unsent edit aside —
    // including the words typed a moment ago, not yet read into the buffer.
    await userEvent.type(surfaceB, ' late')
    await userEvent.click(within(notice).getByRole('button', { name: 'Reload the draft' }))
    await waitFor(() => {
      expect(within(tabB.container).getByRole('textbox', SURFACE)).toHaveTextContent('TAB1')
    })
    expect(within(tabB.container).getByRole('textbox', SURFACE)).not.toHaveTextContent('TAB2')
    const setAside = await within(tabB.container).findByRole('group', {
      name: 'Note: Your unsaved change was set aside',
    })

    // Writing on from the reloaded draft saves on top of tab A's edit...
    await userEvent.type(within(tabB.container).getByRole('textbox', SURFACE), ' more')
    await waitFor(
      () => {
        expect(server.draft.draftVersion).toBe(5)
      },
      { timeout: 4000 },
    )
    expect(JSON.stringify(server.draft.ast)).toContain('TAB1')
    expect(JSON.stringify(server.draft.ast)).toContain('more')

    // ...and now it is tab A that knows it is behind.
    expect(
      await within(tabA.container).findByRole('group', {
        name: 'Warning: This draft changed somewhere else',
      }),
    ).toBeInTheDocument()

    // The set-aside edit comes back on request.
    await userEvent.click(within(setAside).getByRole('button', { name: 'Restore my change' }))
    await waitFor(() => {
      expect(within(tabB.container).getByRole('textbox', SURFACE)).toHaveTextContent('TAB2')
    })
    expect(within(tabB.container).getByRole('textbox', SURFACE)).toHaveTextContent('late')
    tabA.unmount()
    tabB.unmount()
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

const leaf = (id: string, title: string, children: unknown[] = []) => ({
  id,
  shortId: id.padEnd(10, '0'),
  title,
  slug: id,
  status: 'published',
  children,
})

describe('the child-documents block while writing', () => {
  const withBlock = (depth: string) =>
    draft({
      ast: {
        version: DRAFT_CONTENT_VERSION,
        frontMatter: { title: 'Regional failover' },
        ast: {
          type: 'root',
          children: [
            { type: 'leafDirective', name: 'children', attributes: { depth }, children: [] },
          ],
        },
      },
    })

  const tree = () =>
    jsonResponse(200, {
      collections: [
        {
          id: 'col-1',
          name: 'Runbooks',
          slug: 'runbooks',
          documents: [
            leaf('doc-1', 'Regional failover', [
              leaf('primary', 'Primary region', [leaf('detail', 'Detail')]),
            ]),
            leaf('elsewhere', 'Somewhere else'),
          ],
        },
      ],
    })

  it('previews the documents beneath this one, as deep as the block says', async () => {
    await openEditor(
      editorRoutes({
        'GET /api/documents/{id}/draft': withBlock('2'),
        'GET /api/workspaces/{id}/tree': tree,
      }),
    )
    const block = await screen.findByRole('region', { name: 'Child documents' })
    await waitFor(() => {
      expect(within(block).getByText('Primary region')).toBeVisible()
    })
    expect(within(block).getByText('Detail')).toBeVisible()
    expect(within(block).queryByText('Somewhere else')).toBeNull()
  })

  it('shows only the direct children at the depth it starts with', async () => {
    await openEditor(
      editorRoutes({
        'GET /api/documents/{id}/draft': withBlock('1'),
        'GET /api/workspaces/{id}/tree': tree,
      }),
    )
    const block = await screen.findByRole('region', { name: 'Child documents' })
    await waitFor(() => {
      expect(within(block).getByText('Primary region')).toBeVisible()
    })
    expect(within(block).queryByText('Detail')).toBeNull()
  })
})
