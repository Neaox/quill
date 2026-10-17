import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EVENT_PAYLOAD_VERSION, createGrant, notifyReviewRequested } from '@quill/application'
import { userId } from '@quill/domain'
import type { DocumentId, Role, UserId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * In-app notifications end to end (ADR-053): the review events, delivered by
 * the real outbox consumers, become rows that the recipient reads and marks
 * read through their own routes, over a real database.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let editor: Record<string, string>
let viewer: Record<string, string>
let outsider: Record<string, string>

const GRACE = userId('00000000-0000-4000-8000-00000000c001')
const GWEN = userId('00000000-0000-4000-8000-00000000c002')
const NIA = userId('00000000-0000-4000-8000-00000000c003')
let grace: Record<string, string>
let gwen: Record<string, string>
let nia: Record<string, string>

const GROUP = 'notify-reviewers'
const CHILD_GROUP = 'notify-frontend'

async function addPerson(id: UserId, name: string, role: Role | null): Promise<void> {
  const { repos } = harness.deps.uow
  await repos.users.create({
    id,
    email: `${name.toLowerCase()}@example.com`,
    displayName: name,
    now: harness.clock.now(),
  })
  await repos.users.markEmailVerified(id, harness.clock.now())
  if (role !== null) await grantWorkspace('user', id, role)
}

async function grantWorkspace(
  principalKind: 'user' | 'group',
  principalId: string,
  role: Role,
): Promise<void> {
  const granted = await createGrant(harness.deps, {
    principalKind,
    principalId,
    scopeKind: 'workspace',
    scopeId: tenancy.workspaceId,
    role,
    effect: 'allow',
    createdBy: tenancy.admin,
  })
  expect(granted.kind).toBe('created')
}

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
  outsider = await harness.cookiesFor(tenancy.outsider)

  await addPerson(GRACE, 'Grace', 'viewer')
  // Gwen holds access only through a group; Nia only through one nested inside it.
  await addPerson(GWEN, 'Gwen', null)
  await addPerson(NIA, 'Nia', null)
  const { repos } = harness.deps.uow
  const now = harness.clock.now()
  await repos.groups.create({
    id: GROUP,
    unitId: tenancy.unitId,
    parentGroupId: null,
    name: 'Notify reviewers',
    now,
  })
  await repos.groups.create({
    id: CHILD_GROUP,
    unitId: tenancy.unitId,
    parentGroupId: GROUP,
    name: 'Notify frontend',
    now,
  })
  await repos.groups.addMember({ groupId: GROUP, userId: GWEN, now })
  await repos.groups.addMember({ groupId: CHILD_GROUP, userId: NIA, now })
  await grantWorkspace('group', GROUP, 'viewer')

  grace = await harness.cookiesFor(GRACE)
  gwen = await harness.cookiesFor(GWEN)
  nia = await harness.cookiesFor(NIA)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

interface Item {
  id: string
  kind: string
  document: { id: string; shortId: string; title: string; workspaceId: string }
  actor: { id: string; name: string }
  at: string
  readAt: string | null
}

async function createDocument(title: string): Promise<DocumentId> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: editor,
    payload: { collectionId: tenancy.collectionId, title },
  })
  expect(response.statusCode).toBe(201)
  return response.json().document.id as DocumentId
}

const ask = (id: DocumentId, reviewers: readonly { kind: 'user' | 'group'; id: string }[]) =>
  harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/review`,
    cookies: editor,
    payload: { reviewers },
  })

const decide = (
  id: DocumentId,
  cookies: Record<string, string>,
  decision: 'approve' | 'request_changes',
) =>
  harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/review/decision`,
    cookies,
    payload: { decision },
  })

const withdraw = (id: DocumentId) =>
  harness.app.inject({ method: 'DELETE', url: `/api/documents/${id}/review`, cookies: editor })

async function notificationsFor(cookies: Record<string, string>, query = '') {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/me/notifications${query}`,
    cookies,
  })
  expect(response.statusCode).toBe(200)
  return response.json() as { items: Item[]; unread: number; next?: string }
}

/** The caller's notifications about one document: the database is shared by every test here. */
async function aboutDocument(cookies: Record<string, string>, id: DocumentId) {
  return (await notificationsFor(cookies, '?limit=50')).items.filter(
    (item) => item.document.id === id,
  )
}

const markRead = (cookies: Record<string, string>, payload: Record<string, unknown>) =>
  harness.app.inject({ method: 'POST', url: '/api/me/notifications/read', cookies, payload })

describe('being asked to review', () => {
  it('notifies each person and each group member asked, nested groups included, and not the requester', async () => {
    const id = await createDocument('Needs eyes')
    const created = await ask(id, [
      { kind: 'user', id: tenancy.viewer },
      { kind: 'user', id: GRACE },
      { kind: 'group', id: GROUP },
    ])
    expect(created.statusCode).toBe(201)
    // Nothing is written until the outbox is drained: delivery is after the request.
    expect(await aboutDocument(viewer, id)).toEqual([])
    await harness.drainOutbox()

    for (const cookies of [viewer, grace, gwen, nia]) {
      expect(await aboutDocument(cookies, id)).toMatchObject([
        {
          kind: 'review-requested',
          document: { id, title: 'Needs eyes', workspaceId: tenancy.workspaceId },
          actor: { id: tenancy.editor, name: 'Editor' },
          readAt: null,
        },
      ])
    }
    expect(await aboutDocument(editor, id)).toEqual([])
    expect((await notificationsFor(viewer)).unread).toBeGreaterThanOrEqual(1)
  })

  it('writes nothing more when an event is delivered again', async () => {
    const id = await createDocument('Delivered twice')
    const created = await ask(id, [{ kind: 'group', id: GROUP }])
    await harness.drainOutbox()
    expect(await aboutDocument(gwen, id)).toHaveLength(1)

    await notifyReviewRequested(harness.deps, {
      version: EVENT_PAYLOAD_VERSION,
      requestId: created.json().id,
      documentId: id,
      workspaceId: tenancy.workspaceId,
      requestedBy: tenancy.editor,
      reviewers: [{ kind: 'group', id: GROUP }],
    })

    expect(await aboutDocument(gwen, id)).toHaveLength(1)
    expect(await aboutDocument(nia, id)).toHaveLength(1)
  })
})

describe('answers and withdrawals', () => {
  it('tells the requester when a reviewer asks for changes, naming them', async () => {
    const id = await createDocument('Changes please')
    await ask(id, [{ kind: 'user', id: tenancy.viewer }])
    expect((await decide(id, viewer, 'request_changes')).statusCode).toBe(200)
    await harness.drainOutbox()

    expect(await aboutDocument(editor, id)).toMatchObject([
      { kind: 'changes-requested', actor: { id: tenancy.viewer, name: 'Viewer' } },
    ])
  })

  it('tells the requester when the answers approve it', async () => {
    const id = await createDocument('Looks good')
    await ask(id, [{ kind: 'user', id: tenancy.viewer }])
    await decide(id, viewer, 'approve')
    await harness.drainOutbox()

    expect(await aboutDocument(editor, id)).toMatchObject([
      { kind: 'review-approved', actor: { name: 'Viewer' } },
    ])
  })

  it('reads the requests of the people asked and tells them when it is withdrawn', async () => {
    const id = await createDocument('Never mind')
    await ask(id, [
      { kind: 'user', id: tenancy.viewer },
      { kind: 'group', id: GROUP },
    ])
    await harness.drainOutbox()
    harness.clock.advance(1000)
    expect((await withdraw(id)).statusCode).toBe(204)
    await harness.drainOutbox()

    for (const cookies of [viewer, gwen, nia]) {
      const rows = await aboutDocument(cookies, id)
      expect(rows.map((row) => [row.kind, row.readAt !== null])).toEqual([
        ['review-withdrawn', false],
        ['review-requested', true],
      ])
    }
  })

  it('reads the earlier request, with nothing more said, when the author asks again', async () => {
    const id = await createDocument('Asked twice')
    await ask(id, [{ kind: 'user', id: tenancy.viewer }])
    await harness.drainOutbox()
    harness.clock.advance(1000)
    await ask(id, [{ kind: 'user', id: GRACE }])
    await harness.drainOutbox()

    expect((await aboutDocument(viewer, id)).map((row) => [row.kind, row.readAt !== null])).toEqual(
      [['review-requested', true]],
    )
    expect((await aboutDocument(grace, id)).map((row) => [row.kind, row.readAt !== null])).toEqual([
      ['review-requested', false],
    ])
  })
})

describe('GET /api/me/notifications', () => {
  it('needs a session', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/me/notifications' })
    expect(response.statusCode).toBe(401)
  })

  it('pages newest first with an opaque cursor and rejects what it did not issue', async () => {
    const ids = [await createDocument('Page one'), await createDocument('Page two')]
    for (const id of ids) {
      expect((await ask(id, [{ kind: 'user', id: NIA }])).statusCode).toBe(201)
      harness.clock.advance(1000)
    }
    await harness.drainOutbox()

    const all = (await notificationsFor(nia, '?limit=50')).items
    expect(all.length).toBeGreaterThanOrEqual(2)
    const times = all.map((item) => item.at)
    expect(times).toEqual(times.toSorted().toReversed())

    const first = await notificationsFor(nia, '?limit=1')
    expect(first.items).toHaveLength(1)
    expect(first.next).toBeDefined()
    const second = await notificationsFor(nia, `?limit=1&before=${first.next}`)
    expect(second.items[0]?.id).toBe(all[1]?.id)

    const bad = await harness.app.inject({
      method: 'GET',
      url: '/api/me/notifications?before=nonsense',
      cookies: nia,
    })
    expect(bad.statusCode).toBe(422)
    const tooMany = await harness.app.inject({
      method: 'GET',
      url: '/api/me/notifications?limit=51',
      cookies: nia,
    })
    expect(tooMany.statusCode).toBe(400)
  })

  it('leaves out a document the person can no longer view', async () => {
    const id = await createDocument('Withdrawn access')
    await ask(id, [{ kind: 'user', id: tenancy.viewer }])
    await harness.drainOutbox()
    expect(await aboutDocument(viewer, id)).toHaveLength(1)

    const denied = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: tenancy.viewer,
      scopeKind: 'document',
      scopeId: id,
      role: 'viewer',
      effect: 'deny',
      createdBy: tenancy.admin,
    })
    expect(denied.kind).toBe('created')

    expect(await aboutDocument(viewer, id)).toEqual([])
  })

  it('shows a person nothing that was written for someone else', async () => {
    const id = await createDocument('Not yours')
    await ask(id, [{ kind: 'user', id: GRACE }])
    await harness.drainOutbox()

    expect(await aboutDocument(outsider, id)).toEqual([])
    expect(await aboutDocument(viewer, id)).toEqual([])
  })
})

describe('POST /api/me/notifications/read', () => {
  it('marks the named notifications read, ignoring ids that are not the caller', async () => {
    const id = await createDocument('Mark some')
    await ask(id, [
      { kind: 'user', id: tenancy.viewer },
      { kind: 'user', id: GRACE },
    ])
    await harness.drainOutbox()
    const mine = (await aboutDocument(viewer, id))[0]
    const graces = (await aboutDocument(grace, id))[0]
    if (mine === undefined || graces === undefined) throw new Error('expected both notifications')
    const before = (await notificationsFor(viewer)).unread

    const response = await markRead(viewer, { ids: [mine.id, graces.id] })

    expect(response.statusCode).toBe(204)
    expect((await aboutDocument(viewer, id))[0]?.readAt).not.toBeNull()
    expect((await notificationsFor(viewer)).unread).toBe(before - 1)
    expect((await aboutDocument(grace, id))[0]?.readAt).toBeNull()
  })

  it('marks everything of the caller read when no ids are given', async () => {
    const id = await createDocument('Mark all')
    await ask(id, [{ kind: 'user', id: GWEN }])
    await harness.drainOutbox()
    expect((await notificationsFor(gwen)).unread).toBeGreaterThan(0)

    expect((await markRead(gwen, {})).statusCode).toBe(204)

    expect((await notificationsFor(gwen)).unread).toBe(0)
    expect((await notificationsFor(nia)).unread).toBeGreaterThan(0)
  })

  it('refuses a body it does not know and needs a session', async () => {
    expect((await markRead(viewer, { everyone: true })).statusCode).toBe(400)
    const anonymous = await harness.app.inject({
      method: 'POST',
      url: '/api/me/notifications/read',
      payload: {},
    })
    expect(anonymous.statusCode).toBe(401)
  })
})

describe('the ninety-day sweep', () => {
  it('forgets notifications older than ninety days when the housekeeping runs', async () => {
    const id = await createDocument('Old news')
    await ask(id, [{ kind: 'user', id: tenancy.viewer }])
    await harness.drainOutbox()
    expect(await aboutDocument(viewer, id)).toHaveLength(1)

    harness.clock.advance(91 * 24 * 60 * 60 * 1000)
    expect(await harness.jobRunner.runDueJobs()).toContain('sweep-expired')

    expect(await notificationsFor(viewer)).toMatchObject({ items: [], unread: 0 })
  })
})
