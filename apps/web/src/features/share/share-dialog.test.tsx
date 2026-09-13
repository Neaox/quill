import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { expiryFrom, localDate } from './share-dialog.tsx'

/**
 * Sharing a document outside the organisation, through the interface (use
 * cases 24 and 26).
 *
 * Mounted at the reading route rather than around the dialog on its own,
 * because "Share is offered to whoever may manage the document" is half of
 * what is being asserted: the control, the dialog, the list, and the two
 * writes are one journey through the real router and the real query cache.
 */

const KEY = 'k7m3q9v2rt'
const READING_PATH = `/w/acme/d/regional-failover-${KEY}`

const me = () =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'lead@example.com',
    displayName: 'Lead',
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
    status: 'published',
    templateId: null,
    templateVersion: null,
    headRevision: 'b'.repeat(40),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-03T00:00:00.000Z',
  })

const rendered = () =>
  jsonResponse(200, {
    revision: 'b'.repeat(40),
    html: '<article><h1 id="t">Regional failover</h1><p>How to move traffic.</p></article>',
    outline: [{ id: 't', depth: 1, text: 'Regional failover', children: [] }],
    slots: [],
  })

function envelope(manage: boolean) {
  return () =>
    jsonResponse(200, {
      permissions: { view: true, comment: true, edit: true, manage },
      lock: null,
      lastPublished: { revision: 'b'.repeat(40), author: 'Ada', at: '2026-02-03T00:00:00.000Z' },
      review: null,
      health: [],
    })
}

const history = () => jsonResponse(200, { revisions: [] })

/** One of each state the list has to read correctly. */
const LINKS = [
  {
    id: 'link-live',
    documentId: 'doc-1',
    scope: 'document',
    role: 'viewer',
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    createdAt: '2026-02-01T09:00:00.000Z',
    revokedAt: null,
    lastUsedAt: '2026-02-02T10:00:00.000Z',
  },
  {
    id: 'link-forever',
    documentId: 'doc-1',
    scope: 'subtree',
    role: 'viewer',
    expiresAt: null,
    createdBy: 'user-2',
    createdAt: '2026-01-20T09:00:00.000Z',
    revokedAt: null,
    lastUsedAt: null,
  },
  {
    id: 'link-expired',
    documentId: 'doc-1',
    scope: 'document',
    role: 'viewer',
    expiresAt: '2020-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    createdAt: '2019-12-01T09:00:00.000Z',
    revokedAt: null,
    lastUsedAt: null,
  },
  {
    id: 'link-revoked',
    documentId: 'doc-1',
    scope: 'document',
    role: 'viewer',
    expiresAt: null,
    createdBy: 'user-1',
    createdAt: '2026-01-05T09:00:00.000Z',
    revokedAt: '2026-01-06T09:00:00.000Z',
    lastUsedAt: '2026-01-05T12:00:00.000Z',
  },
]

function shareRoutes(overrides: FakeRoutes = {}, manage = true): FakeRoutes {
  return {
    'GET /api/me': me,
    'GET /api/workspaces/{id}': workspace,
    'GET /api/workspaces/{id}/tree': () => jsonResponse(200, { collections: [] }),
    'GET /api/workspaces/{workspaceId}/documents': () => jsonResponse(200, []),
    'GET /api/documents/{id}': document,
    'GET /api/documents/{id}/rendered': rendered,
    'GET /api/documents/{id}/envelope': envelope(manage),
    'GET /api/documents/{id}/history': history,
    'GET /api/documents/{id}/share-links': () => jsonResponse(200, { links: LINKS }),
    ...overrides,
  }
}

/** Opens the document, presses Share, and waits for the dialog. */
async function openShare(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Share' }))
  return screen.findByRole('dialog', { name: 'Share “Regional failover”' })
}

describe('the Share control', () => {
  it('is offered to someone who may manage the document', async () => {
    renderApp(READING_PATH, shareRoutes())

    expect(await screen.findByRole('button', { name: 'Share' })).toBeInTheDocument()
  })

  it('is not rendered at all for someone who may not', async () => {
    renderApp(READING_PATH, shareRoutes({}, false))

    await screen.findByRole('article', { name: 'Regional failover' })
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
  })

  it('carries the work of fetching its own chunk', async () => {
    const user = userEvent.setup()
    renderApp(READING_PATH, shareRoutes())
    const share = await screen.findByRole('button', { name: 'Share' })

    // The dialog is a lazy chunk, so the press starts something that takes
    // time — and a control that swallows a click teaches people not to trust
    // the next one (`docs/design/feedback.md`). The spinner is on the button
    // that was pressed, not a page-level bar.
    const opening = user.click(share)
    await expect.poll(() => share.getAttribute('aria-busy')).toBe('true')
    await opening

    await screen.findByRole('dialog', { name: 'Share “Regional failover”' })
    expect(share).toHaveAttribute('aria-busy', 'false')
  })
})

describe('the share dialog', () => {
  it('lists every link with what it opens, its term, and when it was last used', async () => {
    const user = userEvent.setup()
    renderApp(READING_PATH, shareRoutes())
    const dialog = await openShare(user)

    const rows = await within(dialog).findAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('This document')
    expect(rows[0]).toHaveTextContent('Expires 2099-01-01')
    expect(rows[0]).toHaveTextContent('created by you')
    expect(rows[0]).toHaveTextContent('last opened 2026-02-02')
    expect(rows[1]).toHaveTextContent('This document and everything under it')
    expect(rows[1]).toHaveTextContent('Never expires')
    expect(rows[1]).toHaveTextContent('created by a colleague')
    expect(rows[1]).toHaveTextContent('never opened')
    expect(rows[2]).toHaveTextContent('Expired 2020-01-01')
    expect(rows[3]).toHaveTextContent('Revoked 2026-01-06')
  })

  it('offers Revoke only on a link that is still open', async () => {
    const user = userEvent.setup()
    renderApp(READING_PATH, shareRoutes())
    const dialog = await openShare(user)

    // Three live links, one revoked one: a revoked link has nothing left to do
    // to it, so it carries no control rather than a disabled one.
    expect(await within(dialog).findAllByRole('button', { name: 'Revoke' })).toHaveLength(3)
    expect(within(within(dialog).getAllByRole('listitem')[3]!).queryByRole('button')).toBeNull()
  })

  it('says so, rather than showing an empty list, when nothing is shared yet', async () => {
    const user = userEvent.setup()
    renderApp(
      READING_PATH,
      shareRoutes({
        'GET /api/documents/{id}/share-links': () => jsonResponse(200, { links: [] }),
      }),
    )
    const dialog = await openShare(user)

    expect(await within(dialog).findByText(/No links yet/)).toBeInTheDocument()
  })
})

/** `POST`'s reply: the link, and the raw token, which is only ever sent once. */
const created = (body: unknown) =>
  jsonResponse(201, {
    link: {
      id: 'link-new',
      documentId: 'doc-1',
      scope: (body as { scope?: string }).scope ?? 'document',
      role: 'viewer',
      expiresAt: (body as { expiresAt?: string | null }).expiresAt ?? null,
      createdBy: 'user-1',
      createdAt: '2026-02-04T09:00:00.000Z',
      revokedAt: null,
      lastUsedAt: null,
    },
    token: 'the-raw-token',
    url: 'https://quill.example/share/the-raw-token',
  })

describe('creating a link', () => {
  it('sends the scope and a preset expiry, and shows the address exactly once', async () => {
    const user = userEvent.setup()
    const sent: { scope: string; expiresAt: string | null }[] = []
    renderApp(
      READING_PATH,
      shareRoutes({
        'POST /api/documents/{id}/share-links': async (request) => {
          const body = (await request.json()) as { scope: string; expiresAt: string | null }
          sent.push(body)
          return created(body)
        },
      }),
    )
    const dialog = await openShare(user)

    await user.selectOptions(
      within(dialog).getByLabelText('What it opens'),
      'This document and everything under it',
    )
    await user.selectOptions(within(dialog).getByLabelText('Expires'), 'In 7 days')
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }))

    expect(
      await within(dialog).findByRole('group', { name: 'Success: Link created' }),
    ).toBeVisible()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.scope).toBe('subtree')
    const days = (Date.parse(sent[0]?.expiresAt ?? '') - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)

    // The one-time token, and the sentence that says it is one.
    expect(within(dialog).getByLabelText('Share link')).toHaveValue(
      'https://quill.example/share/the-raw-token',
    )
    expect(within(dialog).getByText(/only time it is shown/)).toBeInTheDocument()
  })

  it('takes an exact date, and makes it last to the end of that day where the person is', async () => {
    const user = userEvent.setup()
    const sent: { expiresAt: string | null }[] = []
    renderApp(
      READING_PATH,
      shareRoutes({
        'POST /api/documents/{id}/share-links': async (request) => {
          const body = (await request.json()) as { scope: string; expiresAt: string | null }
          sent.push(body)
          return created(body)
        },
      }),
    )
    const dialog = await openShare(user)

    await user.selectOptions(within(dialog).getByLabelText('Expires'), 'On a date…')
    await user.type(within(dialog).getByLabelText(/Expiry date/), '2026-09-20')
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }))

    await within(dialog).findByRole('group', { name: 'Success: Link created' })
    // The end of the 20th *here*, not the end of the 20th in UTC: a bare date
    // on a form is the day the person choosing it is living in, and asserting
    // a `Z` literal would be asserting the test machine's offset is zero.
    expect(sent[0]?.expiresAt).toBe(new Date(2026, 8, 20, 23, 59, 59, 999).toISOString())
  })

  it('will not offer a date that has already gone', async () => {
    const user = userEvent.setup()
    renderApp(READING_PATH, shareRoutes())
    const dialog = await openShare(user)

    await user.selectOptions(within(dialog).getByLabelText('Expires'), 'On a date…')

    // The server refuses `share_link_expiry_in_the_past`; the picker saying so
    // first is the same answer without a round trip.
    expect(within(dialog).getByLabelText(/Expiry date/)).toHaveAttribute(
      'min',
      localDate(Date.now()),
    )
  })

  it('never creates a link with a role this release does not have', async () => {
    const user = userEvent.setup()
    const sent: Record<string, unknown>[] = []
    renderApp(
      READING_PATH,
      shareRoutes({
        'POST /api/documents/{id}/share-links': async (request) => {
          const body = (await request.json()) as Record<string, unknown>
          sent.push(body)
          return created(body)
        },
      }),
    )
    const dialog = await openShare(user)
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }))
    await within(dialog).findByRole('group', { name: 'Success: Link created' })

    // View is the only role there is, so it is a readout rather than a control
    // with one choice, and the request says nothing about a role at all. Read
    // from the create form by name: the list beside it also says a link's
    // role, and "the role this would be created with" is the form's answer.
    expect(sent[0]).not.toHaveProperty('role')
    const form = within(dialog).getByRole('form', { name: 'Create a link' })
    expect(within(form).getByText('Viewer')).toBeInTheDocument()
  })

  it('carries the pending state on the button that was pressed', async () => {
    const user = userEvent.setup()
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    renderApp(
      READING_PATH,
      shareRoutes({
        'POST /api/documents/{id}/share-links': async (request) => {
          await held
          return created(await request.json())
        },
      }),
    )
    const dialog = await openShare(user)
    const create = within(dialog).getByRole('button', { name: 'Create link' })
    await user.click(create)

    expect(create).toHaveAttribute('aria-busy', 'true')
    expect(create).toBeDisabled()

    release?.()
    await within(dialog).findByRole('group', { name: 'Success: Link created' })
    expect(create).toHaveAttribute('aria-busy', 'false')
  })

  it('copies the address, and forgets it when the dialog is closed', async () => {
    const user = userEvent.setup()
    renderApp(
      READING_PATH,
      shareRoutes({
        'POST /api/documents/{id}/share-links': async (request) => created(await request.json()),
      }),
    )
    const dialog = await openShare(user)
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }))
    await within(dialog).findByRole('group', { name: 'Success: Link created' })

    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(await navigator.clipboard.readText()).toBe('https://quill.example/share/the-raw-token')
    // Polled: the clipboard write settles in a microtask of its own, so the
    // status is a state change that lands after the click has returned.
    await expect.poll(() => within(dialog).getByRole('status').textContent).toContain('Link copied')

    // Only `POST` ever answers with the token, so an address left on screen
    // after the dialog is closed would be a promise the server cannot keep.
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    const reopened = await openShare(user)
    expect(within(reopened).queryByLabelText('Share link')).not.toBeInTheDocument()
  })

  it('explains a policy that forbids links in place, and stops offering the form', async () => {
    const user = userEvent.setup()
    renderApp(
      READING_PATH,
      shareRoutes({
        'POST /api/documents/{id}/share-links': () =>
          errorResponse(
            403,
            'share_links_disabled',
            'This organisation does not allow share links',
          ),
      }),
    )
    const dialog = await openShare(user)
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }))

    expect(
      await within(dialog).findByRole('group', { name: 'Warning: Share links are turned off' }),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Create link' })).not.toBeInTheDocument()
    // The links that already exist are still the record of what was opened.
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(4)
  })

  it('shows any other refusal without losing what was chosen', async () => {
    const user = userEvent.setup()
    renderApp(
      READING_PATH,
      shareRoutes({
        'POST /api/documents/{id}/share-links': () =>
          errorResponse(
            422,
            'share_link_expiry_in_the_past',
            'A share link cannot expire in the past',
          ),
      }),
    )
    const dialog = await openShare(user)
    await user.selectOptions(
      within(dialog).getByLabelText('What it opens'),
      'This document and everything under it',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }))

    // Announced where it happened, with the form still holding what was
    // chosen, so the answer is to press again rather than to start again.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A share link cannot expire in the past',
    )
    expect(within(dialog).getByLabelText('What it opens')).toHaveValue('subtree')
    expect(within(dialog).getByRole('button', { name: 'Create link' })).toBeEnabled()
  })

  it('says why Create is unavailable to somebody whose address is not verified', async () => {
    const user = userEvent.setup()
    renderApp(
      READING_PATH,
      shareRoutes({
        'GET /api/me': () =>
          jsonResponse(200, {
            id: 'user-1',
            email: 'lead@example.com',
            displayName: 'Lead',
            emailVerified: false,
            isInstanceAdmin: false,
          }),
      }),
    )
    const dialog = await openShare(user)

    // The server needs a verified address to create or revoke and only a
    // session to list, so the list is still there and the control says what
    // stands between it and working (`docs/design/feedback.md`).
    expect(within(dialog).getByRole('button', { name: 'Create link' })).toBeDisabled()
    expect(within(dialog).getByText(/Verify your email address/)).toBeInTheDocument()
  })
})

describe('choosing an expiry', () => {
  it('reads a preset as that many days from now', () => {
    const from = Date.parse('2026-09-13T09:00:00.000Z')
    expect(expiryFrom('7', '', from)).toBe('2026-09-20T09:00:00.000Z')
    expect(expiryFrom('never', '', from)).toBeNull()
  })

  it('refuses to read a missing date as “never”, which is its opposite', () => {
    // Unreachable through the form, whose field is `required`. It is guarded
    // because the one answer it must never give is a permanent link to
    // somebody who asked for a link that ends.
    expect(() => expiryFrom('date', '', Date.now())).toThrow(/needs a date/)
  })

  it('spells an instant as the day the person is living in', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30).getTime())).toBe('2026-01-05')
  })
})

describe('revoking a link', () => {
  it('asks first, then closes the link and re-reads the list', async () => {
    const user = userEvent.setup()
    const revoked: string[] = []
    let listed = LINKS
    renderApp(
      READING_PATH,
      shareRoutes({
        'GET /api/documents/{id}/share-links': () => jsonResponse(200, { links: listed }),
        'DELETE /api/share-links/{id}': (_request, params) => {
          revoked.push(params['id'] ?? '')
          listed = LINKS.filter((link) => link.id !== params['id'])
          return new Response(null, { status: 204 })
        },
      }),
    )
    const dialog = await openShare(user)
    await user.click(within(dialog).getAllByRole('button', { name: 'Revoke' })[0]!)

    const confirm = await screen.findByRole('dialog', { name: 'Revoke this link?' })
    await user.click(within(confirm).getByRole('button', { name: 'Revoke' }))

    expect(revoked).toEqual(['link-live'])
    await expect.poll(() => within(dialog).getAllByRole('listitem').length).toBe(3)
  })

  it('can be thought better of', async () => {
    const user = userEvent.setup()
    const revoked: string[] = []
    renderApp(
      READING_PATH,
      shareRoutes({
        'DELETE /api/share-links/{id}': (_request, params) => {
          revoked.push(params['id'] ?? '')
          return new Response(null, { status: 204 })
        },
      }),
    )
    const dialog = await openShare(user)
    await user.click(within(dialog).getAllByRole('button', { name: 'Revoke' })[0]!)

    const confirm = await screen.findByRole('dialog', { name: 'Revoke this link?' })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))

    expect(revoked).toEqual([])
  })

  it('does not greet the next link with the last one’s failure', async () => {
    const user = userEvent.setup()
    renderApp(
      READING_PATH,
      shareRoutes({
        'DELETE /api/share-links/{id}': () =>
          errorResponse(403, 'forbidden', 'You may not manage this document'),
      }),
    )
    const dialog = await openShare(user)
    const revokeButtons = await within(dialog).findAllByRole('button', { name: 'Revoke' })

    await user.click(revokeButtons[0]!)
    const first = await screen.findByRole('dialog', { name: 'Revoke this link?' })
    await user.click(within(first).getByRole('button', { name: 'Revoke' }))
    expect(await within(first).findByRole('alert')).toHaveTextContent('You may not manage')
    await user.click(within(first).getByRole('button', { name: 'Cancel' }))

    // A failure belongs to the link it was attempted on; the next question is
    // asked without an answer to a different one already on screen.
    await user.click(revokeButtons[1]!)
    const second = await screen.findByRole('dialog', { name: 'Revoke this link?' })
    expect(within(second).queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('accessibility', () => {
  it('has no axe violations', async () => {
    const user = userEvent.setup()
    renderApp(READING_PATH, shareRoutes())
    // The dialog itself, as the design system's own dialog tests do: the page
    // behind an open modal is `aria-hidden` by the primitive, which axe reads
    // as a hidden region full of focusable controls.
    await expectNoAccessibilityViolations(await openShare(user))
  })

  it('has no axe violations with a link’s address on screen', async () => {
    const user = userEvent.setup()
    renderApp(
      READING_PATH,
      shareRoutes({
        'POST /api/documents/{id}/share-links': () => created({}),
      }),
    )
    const dialog = await openShare(user)
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }))
    await within(dialog).findByRole('group', { name: 'Success: Link created' })

    await expectNoAccessibilityViolations(dialog)
  })
})
