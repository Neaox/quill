import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'
import type { DocumentId, Role, UserId } from '@quill/domain'

import type { ScopeKind } from '../ports/persistence.ts'
import { aShortId, createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import type { FakeClock } from '../test-support/fakes.ts'
import { createFakeTokenService } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createAuthorizer } from './authorizer.ts'
import {
  REVIEW_DECIDED,
  REVIEW_REQUESTED,
  REVIEW_WITHDRAWN,
  parseReviewDecided,
  parseReviewRequested,
  parseReviewWithdrawn,
} from './events.ts'
import {
  decodeNotificationCursor,
  listNotifications,
  markNotificationsRead,
  notifyReviewDecided,
  notifyReviewRequested,
  notifyReviewWithdrawn,
  NOTIFICATION_RETENTION_MS,
  sweepNotifications,
} from './notifications.ts'
import type { NotificationDependencies } from './notifications.ts'
import { decideReview, requestReview, withdrawReview } from './review.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
const OTHER_DOC = documentId('00000000-0000-4000-8000-000000000202')

const AUTHOR = userId('00000000-0000-4000-8000-0000000000a1')
const ADA = userId('00000000-0000-4000-8000-0000000000a2')
const GRACE = userId('00000000-0000-4000-8000-0000000000a3')
const GROUP_MEMBER = userId('00000000-0000-4000-8000-0000000000a6')
const NESTED_MEMBER = userId('00000000-0000-4000-8000-0000000000a7')

let uow: InMemoryUnitOfWork
let clock: FakeClock
let deps: NotificationDependencies
let grants = 0

async function grant(
  principalKind: 'user' | 'group',
  principalId: string,
  role: Role,
  scopeKind: ScopeKind = 'workspace',
  scopeId: string | null = WORKSPACE,
  effect: 'allow' | 'deny' = 'allow',
): Promise<void> {
  grants += 1
  await uow.repos.grants.create({
    id: `grant-${grants}`,
    principalKind,
    principalId,
    scopeKind,
    scopeId,
    role,
    effect,
    createdBy: null,
    now: NOW,
  })
}

async function person(id: UserId, name: string): Promise<void> {
  await uow.repos.users.create({
    id,
    email: `${name.toLowerCase()}@example.com`,
    displayName: name,
    now: NOW,
  })
}

async function makeDocument(id: DocumentId): Promise<void> {
  await uow.repos.documents.create({
    id,
    shortId: aShortId(),
    workspaceId: WORKSPACE,
    collectionId: 'architecture',
    parentId: null,
    slug: id,
    path: `architecture/${id}.md`,
    title: `Document ${id.slice(-3)}`,
    status: 'draft',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
  await uow.repos.drafts.init({ documentId: id, baseRevision: null, ast: {}, now: NOW })
}

/** What the outbox consumers do, applied to every event written so far, in order. */
async function deliverEvents(): Promise<void> {
  for (const event of uow.events) {
    if (event.type === REVIEW_REQUESTED) {
      const payload = parseReviewRequested(event.payload)
      if (payload !== null) await notifyReviewRequested(deps, payload)
    } else if (event.type === REVIEW_DECIDED) {
      const payload = parseReviewDecided(event.payload)
      if (payload !== null) await notifyReviewDecided(deps, payload)
    } else if (event.type === REVIEW_WITHDRAWN) {
      const payload = parseReviewWithdrawn(event.payload)
      if (payload !== null) await notifyReviewWithdrawn(deps, payload)
    }
  }
}

function ask(reviewers: readonly { kind: 'user' | 'group'; id: string }[], by: UserId = AUTHOR) {
  return requestReview(deps, {
    documentId: DOC,
    requestedBy: by,
    canManage: false,
    reviewers,
  })
}

function answer(user: UserId, decision: 'approve' | 'request_changes') {
  return decideReview(deps, { documentId: DOC, userId: user, canManage: false, decision })
}

async function rowsFor(user: UserId) {
  return uow.repos.notifications.listForUser({ userId: user, after: null, limit: 100 })
}

function authorizerFor(user: UserId) {
  return createAuthorizer(
    uow.repos,
    { userId: user, shareLinkToken: null },
    {
      uow,
      clock,
      ids: createFakeIdGenerator(),
      tokens: createFakeTokenService(),
      shareLinkPolicy: { allowed: () => true },
    },
  )
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  clock = createFakeClock(NOW)
  deps = { uow, clock, ids: createFakeIdGenerator() }
  grants = 0

  await uow.repos.units.create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'architecture',
    workspaceId: WORKSPACE,
    name: 'Architecture',
    slug: 'architecture',
    now: NOW,
  })
  await makeDocument(DOC)
  await makeDocument(OTHER_DOC)

  await person(AUTHOR, 'Author')
  await person(ADA, 'Ada')
  await person(GRACE, 'Grace')
  await person(GROUP_MEMBER, 'Gwen')
  await person(NESTED_MEMBER, 'Nia')

  await grant('user', AUTHOR, 'editor')
  await grant('user', ADA, 'viewer')
  await grant('user', GRACE, 'viewer')

  // "Reviewers" holds a viewer grant; "Frontend" nests inside it and holds none of its own.
  await uow.repos.groups.create({
    id: 'reviewers',
    unitId: 'acme',
    parentGroupId: null,
    name: 'Reviewers',
    now: NOW,
  })
  await uow.repos.groups.create({
    id: 'frontend',
    unitId: 'acme',
    parentGroupId: 'reviewers',
    name: 'Frontend',
    now: NOW,
  })
  await grant('group', 'reviewers', 'viewer')
  await uow.repos.groups.addMember({ groupId: 'reviewers', userId: GROUP_MEMBER, now: NOW })
  await uow.repos.groups.addMember({ groupId: 'frontend', userId: NESTED_MEMBER, now: NOW })
})

describe('a review request', () => {
  it('notifies each person asked and each member of a group asked, nested groups included', async () => {
    await ask([
      { kind: 'user', id: ADA },
      { kind: 'group', id: 'reviewers' },
    ])
    await deliverEvents()

    for (const recipient of [ADA, GROUP_MEMBER, NESTED_MEMBER]) {
      expect(await rowsFor(recipient)).toMatchObject([
        { kind: 'review-requested', documentId: DOC, actorUserId: AUTHOR, readAt: null },
      ])
    }
    expect(await rowsFor(GRACE)).toEqual([])
  })

  it('never notifies the requester, even when a group they belong to is asked', async () => {
    await uow.repos.groups.addMember({ groupId: 'reviewers', userId: AUTHOR, now: NOW })
    await ask([{ kind: 'group', id: 'reviewers' }])
    await deliverEvents()

    expect(await rowsFor(AUTHOR)).toEqual([])
    expect(await rowsFor(GROUP_MEMBER)).toHaveLength(1)
  })

  it('writes one row for a person named twice, directly and through a group', async () => {
    await ask([
      { kind: 'user', id: NESTED_MEMBER },
      { kind: 'group', id: 'frontend' },
      { kind: 'group', id: 'reviewers' },
    ])
    await deliverEvents()

    expect(await rowsFor(NESTED_MEMBER)).toHaveLength(1)
  })

  it('writes nothing more when the same event is delivered again', async () => {
    await ask([{ kind: 'group', id: 'reviewers' }])
    await deliverEvents()
    await deliverEvents()

    expect(await rowsFor(GROUP_MEMBER)).toHaveLength(1)
    expect(await rowsFor(NESTED_MEMBER)).toHaveLength(1)
  })

  it('skips a person who no longer exists', async () => {
    await ask([
      { kind: 'user', id: ADA },
      { kind: 'user', id: GRACE },
    ])
    const payload = parseReviewRequested(uow.events[0]?.payload)
    if (payload === null) throw new Error('expected a readable event')
    const stranger = userId('00000000-0000-4000-8000-0000000000ff')
    await notifyReviewRequested(deps, {
      ...payload,
      reviewers: [...payload.reviewers, { kind: 'user', id: stranger }],
    })

    expect(await rowsFor(ADA)).toHaveLength(1)
    expect(await rowsFor(stranger)).toEqual([])
  })
})

describe('events about a request that cannot be found', () => {
  const stranger = userId('00000000-0000-4000-8000-0000000000ff')

  it('writes nothing for a request that was never stored', async () => {
    await ask([{ kind: 'user', id: ADA }])
    const requested = parseReviewRequested(uow.events[0]?.payload)
    if (requested === null) throw new Error('expected a readable event')

    expect(await notifyReviewRequested(deps, { ...requested, requestId: 'never-stored' })).toBe(0)
    expect(await rowsFor(ADA)).toEqual([])
  })

  it('tells nobody of a decision on a request that was never stored', async () => {
    expect(
      await notifyReviewDecided(deps, {
        version: 1,
        requestId: 'never-stored',
        documentId: DOC,
        workspaceId: WORKSPACE,
        decidedBy: ADA,
        decision: 'approve',
        status: 'approved',
      }),
    ).toBe(0)
    expect(await rowsFor(AUTHOR)).toEqual([])
  })

  it('names no actor when the person who asked has gone', async () => {
    await ask([{ kind: 'user', id: ADA }])
    const requested = parseReviewRequested(uow.events[0]?.payload)
    if (requested === null) throw new Error('expected a readable event')

    await notifyReviewRequested(deps, { ...requested, requestedBy: stranger })

    expect(await rowsFor(ADA)).toMatchObject([{ kind: 'review-requested', actorUserId: null }])
  })
})

describe('a decision', () => {
  beforeEach(async () => {
    await ask([
      { kind: 'user', id: ADA },
      { kind: 'user', id: GRACE },
    ])
  })

  it('tells the requester once the answers settle the request as approved', async () => {
    await answer(ADA, 'approve')
    await deliverEvents()
    // One approval of two leaves the request open: nothing to say yet.
    expect((await rowsFor(AUTHOR)).map((row) => row.kind)).toEqual([])

    await answer(GRACE, 'approve')
    await deliverEvents()
    expect(await rowsFor(AUTHOR)).toMatchObject([
      { kind: 'review-approved', actorUserId: GRACE, documentId: DOC },
    ])
  })

  it('tells the requester when someone asks for changes, naming that person', async () => {
    await answer(ADA, 'request_changes')
    await deliverEvents()

    expect(await rowsFor(AUTHOR)).toMatchObject([{ kind: 'changes-requested', actorUserId: ADA }])
    expect(await rowsFor(ADA)).toHaveLength(1)
  })

  it('does not repeat the notification when the event is delivered again', async () => {
    await answer(ADA, 'request_changes')
    await deliverEvents()
    await deliverEvents()

    expect((await rowsFor(AUTHOR)).filter((row) => row.kind === 'changes-requested')).toHaveLength(
      1,
    )
  })
})

describe('a withdrawal', () => {
  it("reads the asked people's requests and tells them it was taken back", async () => {
    await ask([
      { kind: 'user', id: ADA },
      { kind: 'group', id: 'reviewers' },
    ])
    await deliverEvents()
    clock.advance(1000)
    await withdrawReview(deps, { documentId: DOC, userId: AUTHOR, canManage: false })
    await deliverEvents()

    for (const recipient of [ADA, GROUP_MEMBER, NESTED_MEMBER]) {
      const rows = await rowsFor(recipient)
      expect(rows.map((row) => [row.kind, row.readAt !== null])).toEqual([
        ['review-withdrawn', false],
        ['review-requested', true],
      ])
    }
    expect(await rowsFor(AUTHOR)).toEqual([])
  })

  it("reads the asked people's requests but says nothing when the author asked again", async () => {
    await ask([{ kind: 'user', id: ADA }])
    await deliverEvents()
    clock.advance(1000)
    await ask([{ kind: 'user', id: GRACE }])
    await deliverEvents()

    expect((await rowsFor(ADA)).map((row) => [row.kind, row.readAt !== null])).toEqual([
      ['review-requested', true],
    ])
    expect((await rowsFor(GRACE)).map((row) => [row.kind, row.readAt !== null])).toEqual([
      ['review-requested', false],
    ])
  })

  it('writes nothing more when the same event is delivered again', async () => {
    await ask([{ kind: 'user', id: ADA }])
    await withdrawReview(deps, { documentId: DOC, userId: AUTHOR, canManage: false })
    await deliverEvents()
    await deliverEvents()

    expect((await rowsFor(ADA)).map((row) => row.kind).toSorted()).toEqual([
      'review-requested',
      'review-withdrawn',
    ])
  })
})

describe('events delivered out of order', () => {
  it('ends where in-order delivery would: the request read, the withdrawal unread', async () => {
    await ask([{ kind: 'user', id: ADA }])
    await withdrawReview(deps, { documentId: DOC, userId: AUTHOR, canManage: false })
    for (const event of uow.events.toReversed()) {
      if (event.type === REVIEW_REQUESTED) {
        const payload = parseReviewRequested(event.payload)
        if (payload !== null) await notifyReviewRequested(deps, payload)
      } else if (event.type === REVIEW_WITHDRAWN) {
        const payload = parseReviewWithdrawn(event.payload)
        if (payload !== null) await notifyReviewWithdrawn(deps, payload)
      }
    }

    expect((await rowsFor(ADA)).map((row) => [row.kind, row.readAt !== null]).toSorted()).toEqual([
      ['review-requested', true],
      ['review-withdrawn', false],
    ])
  })
})

/** A cursor as the server would have issued it for these contents. */
const issued = (value: string) => Buffer.from(value).toString('base64url')

describe('listNotifications', () => {
  async function seed(count: number, documents: readonly DocumentId[] = [DOC]) {
    await uow.repos.notifications.insertMany(
      Array.from({ length: count }, (_, index) => ({
        id: `n-${String(index).padStart(3, '0')}`,
        recipientUserId: ADA,
        kind: 'review-requested' as const,
        documentId: documents[index % documents.length] ?? DOC,
        requestId: `request-${index}`,
        actorUserId: AUTHOR,
        createdAt: new Date(NOW.getTime() + index * 1000),
      })),
    )
  }
  const list = (limit?: number, before?: string) =>
    listNotifications(deps, { userId: ADA, authorizer: authorizerFor(ADA), limit, before })

  it('lists newest first with the document, the actor and the unread count', async () => {
    await seed(3)
    const result = await list()
    if (result.kind !== 'listed') throw new Error(result.kind)

    expect(result.items.map((item) => item.id)).toEqual(['n-002', 'n-001', 'n-000'])
    expect(result.items[0]).toMatchObject({
      kind: 'review-requested',
      document: { id: DOC, workspaceId: WORKSPACE, title: expect.any(String) },
      actor: { id: AUTHOR, name: 'Author' },
      readAt: null,
    })
    expect(result.unread).toBe(3)
    expect(result.next).toBeUndefined()
  })

  it('pages with an opaque cursor and no overlap', async () => {
    await seed(5)
    const first = await list(2)
    if (first.kind !== 'listed' || first.next === undefined) throw new Error('expected a next page')
    const second = await list(2, first.next)
    if (second.kind !== 'listed' || second.next === undefined) throw new Error('expected a third')
    const third = await list(2, second.next)
    if (third.kind !== 'listed') throw new Error(third.kind)

    expect([first, second, third].flatMap((page) => page.items.map((item) => item.id))).toEqual([
      'n-004',
      'n-003',
      'n-002',
      'n-001',
      'n-000',
    ])
    expect(third.next).toBeUndefined()
  })

  it('leaves out documents the person can no longer view and tops the page up', async () => {
    await seed(6, [DOC, OTHER_DOC])
    await grant('user', ADA, 'viewer', 'document', OTHER_DOC, 'deny')
    const result = await list(2)
    if (result.kind !== 'listed') throw new Error(result.kind)

    expect(result.items.map((item) => item.id)).toEqual(['n-004', 'n-002'])
    expect(result.next).toBeDefined()
    expect(result.unread).toBe(6)
  })

  it('refuses a cursor it did not issue', async () => {
    expect(await list(2, 'not-a-cursor')).toEqual({ kind: 'bad-cursor' })
    expect(decodeNotificationCursor('')).toBeNull()
    // Not a date at all, and a date written some way other than the one a cursor is issued in.
    expect(decodeNotificationCursor(issued('yesterday|n-1'))).toBeNull()
    expect(decodeNotificationCursor(issued('2026-01-01|n-1'))).toBeNull()
    expect(decodeNotificationCursor(issued(`${NOW.toISOString()}|n-1`))).toEqual({
      createdAt: NOW,
      id: 'n-1',
    })
  })

  it('names a gone actor as a former member', async () => {
    await uow.repos.notifications.insertMany([
      {
        id: 'n-1',
        recipientUserId: ADA,
        kind: 'review-withdrawn',
        documentId: DOC,
        requestId: 'r',
        actorUserId: null,
        createdAt: NOW,
      },
    ])
    const result = await list()
    if (result.kind !== 'listed') throw new Error(result.kind)
    expect(result.items[0]?.actor.name).toBe('Former member')
  })
})

describe('markNotificationsRead', () => {
  beforeEach(async () => {
    for (const recipient of [ADA, GRACE]) {
      await uow.repos.notifications.insertMany([
        {
          id: `n-${recipient.slice(-2)}`,
          recipientUserId: recipient,
          kind: 'review-requested',
          documentId: DOC,
          requestId: 'r',
          actorUserId: AUTHOR,
          createdAt: NOW,
        },
        {
          id: `m-${recipient.slice(-2)}`,
          recipientUserId: recipient,
          kind: 'review-withdrawn',
          documentId: DOC,
          requestId: 'r',
          actorUserId: AUTHOR,
          createdAt: NOW,
        },
      ])
    }
  })

  it("marks only the named notifications, and only the caller's own", async () => {
    const changed = await markNotificationsRead(deps, {
      userId: ADA,
      ids: [`n-${ADA.slice(-2)}`, `n-${GRACE.slice(-2)}`],
    })

    expect(changed).toBe(1)
    expect(await uow.repos.notifications.countUnread(ADA)).toBe(1)
    expect(await uow.repos.notifications.countUnread(GRACE)).toBe(2)
  })

  it("marks everything of the caller's when no ids are given", async () => {
    expect(await markNotificationsRead(deps, { userId: ADA })).toBe(2)
    expect(await uow.repos.notifications.countUnread(ADA)).toBe(0)
    expect(await uow.repos.notifications.countUnread(GRACE)).toBe(2)
  })
})

describe('sweepNotifications', () => {
  it('removes notifications older than the retention window and keeps the rest', async () => {
    const row = (id: string, createdAt: Date) => ({
      id,
      recipientUserId: ADA,
      kind: 'review-requested' as const,
      documentId: DOC,
      requestId: id,
      actorUserId: AUTHOR,
      createdAt,
    })
    await uow.repos.notifications.insertMany([
      row('old', new Date(NOW.getTime() - NOTIFICATION_RETENTION_MS - 1)),
      row('edge', new Date(NOW.getTime() - NOTIFICATION_RETENTION_MS)),
      row('new', NOW),
    ])

    expect(await sweepNotifications(deps, NOW)).toBe(1)
    expect((await rowsFor(ADA)).map((entry) => entry.id).toSorted()).toEqual(['edge', 'new'])
  })
})
