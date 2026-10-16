import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'

const WORKSPACES = ['Engineering', 'Platform docs'].map((name, index) => ({
  id: `ws-${index}`,
  unitId: 'unit-1',
  name,
  slug: name.toLowerCase().replaceAll(' ', '-'),
  createdAt: '2026-01-01T00:00:00.000Z',
  unit: { id: 'unit-1', name: 'Acme', path: ['Acme'] },
}))

const item = (id: string, kind: string, actor: string, title: string, readAt: string | null) => ({
  id,
  kind,
  document: { id: `doc-${id}`, shortId: 'k7m3q9v2rt', title, workspaceId: 'ws-0' },
  actor: { id: `u-${actor}`, name: actor },
  at: '2026-10-13T08:00:00.000Z',
  readAt,
})

function signedIn(extra: FakeRoutes = {}) {
  return renderApp('/', {
    'GET /api/me': () =>
      jsonResponse(200, {
        id: 'user-1',
        email: 'ada@example.com',
        displayName: 'Ada Writer',
        emailVerified: true,
        isInstanceAdmin: false,
      }),
    'GET /api/workspaces': () => jsonResponse(200, WORKSPACES),
    'GET /api/home': () =>
      jsonResponse(200, {
        stats: [],
        drafts: { total: 0, items: [] },
        recent: [],
        anyPublished: false,
        scope: 'everywhere',
        hasHistory: false,
        jumpBackIn: [],
      }),
    'GET /api/me/attention': () => jsonResponse(200, { items: [] }),
    ...extra,
  })
}

const unread = (count: number, items: unknown[]) => ({
  'GET /api/me/notifications': () => jsonResponse(200, { items, unread: count }),
})

describe('the notifications bell', () => {
  it('says how many are unread, in its name as well as on its face', async () => {
    signedIn(
      unread(2, [
        item('1', 'review-requested', 'Grace', 'Release notes', null),
        item('2', 'changes-requested', 'Linus', 'Failover drill', null),
        item('3', 'review-approved', 'Ada', 'Old thing', '2026-10-12T08:00:00.000Z'),
      ]),
    )

    expect(
      await screen.findByRole('button', { name: 'Notifications, 2 unread' }),
    ).toBeInTheDocument()
  })

  it('is quiet when there is nothing unread, and says so when opened', async () => {
    signedIn(unread(0, []))

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }))

    const panel = await screen.findByRole('dialog', { name: 'Notifications' })
    expect(within(panel).getByText('You’re all caught up.')).toBeInTheDocument()
    await expectNoAccessibilityViolations(panel)
  })

  it('lists what happened as sentences, each a way into the document, unread first marked', async () => {
    signedIn(
      unread(1, [
        item('1', 'review-requested', 'Grace', 'Release notes', null),
        item('2', 'review-approved', 'Linus', 'Failover drill', '2026-10-12T08:00:00.000Z'),
      ]),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    const panel = await screen.findByRole('dialog', { name: 'Notifications' })

    const links = within(panel).getAllByRole('link')
    expect(links[0]).toHaveTextContent('Grace asked you to review Release notes')
    expect(links[0]).toHaveAttribute('href', '/w/engineering/d/release-notes-k7m3q9v2rt')
    expect(links[0]).toHaveTextContent('Unread')
    expect(links[1]).toHaveTextContent('Linus approved Failover drill')
    expect(links[1]).not.toHaveTextContent('Unread')
    await expectNoAccessibilityViolations(panel)
  })

  it('marks everything read on request', async () => {
    const marked: unknown[] = []
    signedIn({
      ...unread(2, [
        item('1', 'review-requested', 'Grace', 'Release notes', null),
        item('2', 'changes-requested', 'Linus', 'Failover drill', null),
      ]),
      'POST /api/me/notifications/read': async (request) => {
        marked.push(await request.json())
        return new Response(undefined, { status: 204 })
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }))
    const panel = await screen.findByRole('dialog', { name: 'Notifications' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark all as read' }))

    await waitFor(() => {
      expect(marked).toEqual([{}])
    })
  })

  it('marks the one that is followed as read', async () => {
    const marked: unknown[] = []
    signedIn({
      ...unread(1, [item('1', 'review-requested', 'Grace', 'Release notes', null)]),
      'POST /api/me/notifications/read': async (request) => {
        marked.push(await request.json())
        return new Response(undefined, { status: 204 })
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    const panel = await screen.findByRole('dialog', { name: 'Notifications' })
    await userEvent.click(within(panel).getByRole('link', { name: /Release notes/u }))

    await waitFor(() => {
      expect(marked).toEqual([{ ids: ['1'] }])
    })
  })
})
