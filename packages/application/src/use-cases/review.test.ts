import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, revisionId, userId, workspaceId } from '@quill/domain'
import type { DocumentId, Role, UserId } from '@quill/domain'

import type { ScopeKind } from '../ports/persistence.ts'
import { aShortId, createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import type { FakeClock } from '../test-support/fakes.ts'
import { createFakeTokenService } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createAuthorizer } from './authorizer.ts'
import { recordPublish } from './publish-document.ts'
import {
  REVIEW_AUDIT_EVENTS,
  closeReviewOnPublish,
  decideReview,
  getAttention,
  getReview,
  isAssignedReviewer,
  listReviewerCandidates,
  requestReview,
  withdrawReview,
} from './review.ts'
import type { ReviewDependencies, ReviewRequestView } from './review.ts'
import { createReviewerAccessProbe } from './review-access.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
const OTHER_DOC = documentId('00000000-0000-4000-8000-000000000202')

const AUTHOR = userId('00000000-0000-4000-8000-0000000000a1')
const ADA = userId('00000000-0000-4000-8000-0000000000a2')
const GRACE = userId('00000000-0000-4000-8000-0000000000a3')
const OUTSIDER = userId('00000000-0000-4000-8000-0000000000a4')
const ADMIN = userId('00000000-0000-4000-8000-0000000000a5')
const GROUP_MEMBER = userId('00000000-0000-4000-8000-0000000000a6')
const NESTED_MEMBER = userId('00000000-0000-4000-8000-0000000000a7')

let uow: InMemoryUnitOfWork
let clock: FakeClock
let deps: ReviewDependencies
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

async function person(id: UserId, name: string, admin = false): Promise<void> {
  await uow.repos.users.create({
    id,
    email: `${name.toLowerCase()}@example.com`,
    displayName: name,
    now: NOW,
  })
  if (admin) await uow.repos.users.setInstanceAdmin(id, true)
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

/** Somebody edits the draft: the version moves on, with no other write. */
async function editDraft(id: DocumentId): Promise<void> {
  await uow.repos.locks.acquire({
    documentId: id,
    userId: AUTHOR,
    sessionId: 'session-author',
    now: clock.now(),
  })
  const draft = await uow.repos.drafts.find(id)
  await uow.repos.drafts.write({
    documentId: id,
    sessionId: 'session-author',
    expectedVersion: draft?.draftVersion ?? 0,
    ast: { edited: true },
    now: clock.now(),
  })
}

function asked(
  reviewers: readonly { kind: 'user' | 'group'; id: string }[],
  overrides: { message?: string; requestedBy?: UserId } = {},
) {
  return requestReview(deps, {
    documentId: DOC,
    requestedBy: overrides.requestedBy ?? AUTHOR,
    canManage: false,
    reviewers,
    ...(overrides.message === undefined ? {} : { message: overrides.message }),
  })
}

async function review(
  reviewers: readonly { kind: 'user' | 'group'; id: string }[],
): Promise<ReviewRequestView> {
  const result = await asked(reviewers)
  if (result.kind !== 'requested') throw new Error(result.kind)
  return result.review
}

function answer(user: UserId, decision: 'approve' | 'request_changes', comment?: string) {
  return decideReview(deps, {
    documentId: DOC,
    userId: user,
    canManage: false,
    decision,
    ...(comment === undefined ? {} : { comment }),
  })
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
  await person(OUTSIDER, 'Outsider')
  await person(ADMIN, 'Admin', true)
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
  await uow.repos.groups.create({
    id: 'nobody-can-see',
    unitId: 'acme',
    parentGroupId: null,
    name: 'Strangers',
    now: NOW,
  })
  await grant('group', 'reviewers', 'viewer')
  await uow.repos.groups.addMember({ groupId: 'reviewers', userId: GROUP_MEMBER, now: NOW })
  await uow.repos.groups.addMember({ groupId: 'frontend', userId: NESTED_MEMBER, now: NOW })
})

describe('requestReview', () => {
  it('records the request against the draft as it is, with its reviewers pending', async () => {
    await editDraft(DOC)
    const view = await review([
      { kind: 'user', id: ADA },
      { kind: 'group', id: 'reviewers' },
    ])

    expect(view).toMatchObject({
      status: 'open',
      documentId: DOC,
      requestedBy: { id: AUTHOR, name: 'Author' },
      draftVersion: 1,
      stale: false,
      message: null,
      canWithdraw: true,
      canDecide: false,
    })
    expect(view.assignments.map((a) => [a.reviewer.name, a.state])).toEqual([
      ['Ada', 'pending'],
      ['Reviewers', 'pending'],
    ])
    // Two people hold the group: one directly, one through the group nested in it.
    expect(view.assignments[1]?.reviewer.memberCount).toBe(2)
  })

  it('trims the message and keeps it to a thousand characters', async () => {
    const result = await asked([{ kind: 'user', id: ADA }], { message: `  ${'x'.repeat(1200)}  ` })
    expect(result.kind === 'requested' && result.review.message).toHaveLength(1000)
    const blank = await asked([{ kind: 'user', id: ADA }], { message: '   ' })
    expect(blank.kind === 'requested' && blank.review.message).toBeNull()
  })

  it('refuses nobody, and more than twenty, once duplicates are counted once', async () => {
    expect(await asked([])).toEqual({ kind: 'invalid-reviewers', count: 0 })
    const many = Array.from({ length: 21 }, (_, index) => ({
      kind: 'user' as const,
      id: `u${index}`,
    }))
    expect(await asked(many)).toEqual({ kind: 'invalid-reviewers', count: 21 })
    const twice = await asked([
      { kind: 'user', id: ADA },
      { kind: 'user', id: ADA },
    ])
    expect(twice.kind === 'requested' && twice.review.assignments).toHaveLength(1)
  })

  it('refuses a reviewer who cannot view the document, naming them', async () => {
    const result = await asked([
      { kind: 'user', id: ADA },
      { kind: 'user', id: OUTSIDER },
      { kind: 'group', id: 'nobody-can-see' },
      { kind: 'user', id: 'no-such-person' },
    ])
    expect(result).toEqual({
      kind: 'reviewers-cannot-view',
      reviewers: [
        { kind: 'user', id: OUTSIDER },
        { kind: 'group', id: 'nobody-can-see' },
        { kind: 'user', id: 'no-such-person' },
      ],
    })
    expect(await uow.repos.reviews.findActiveForDocument(DOC)).toBeNull()
  })

  it('counts a person who holds access only through a group, nested ones included', async () => {
    const result = await asked([
      { kind: 'user', id: GROUP_MEMBER },
      { kind: 'user', id: NESTED_MEMBER },
      { kind: 'group', id: 'frontend' },
    ])
    expect(result.kind).toBe('requested')
  })

  it('honours a deny: a person denied the document cannot be tagged', async () => {
    await grant('user', ADA, 'viewer', 'document', DOC, 'deny')
    const result = await asked([{ kind: 'user', id: ADA }])
    expect(result.kind).toBe('reviewers-cannot-view')
  })

  it('lets an instance administrator be tagged', async () => {
    expect((await asked([{ kind: 'user', id: ADMIN }])).kind).toBe('requested')
  })

  it('reports a document that does not exist', async () => {
    const result = await requestReview(deps, {
      documentId: documentId('00000000-0000-4000-8000-0000000009ff'),
      requestedBy: AUTHOR,
      canManage: false,
      reviewers: [{ kind: 'user', id: ADA }],
    })
    expect(result).toEqual({ kind: 'not-found' })
  })

  it('supersedes the earlier request: one is active per document', async () => {
    const first = await review([{ kind: 'user', id: ADA }])
    const second = await review([{ kind: 'user', id: GRACE }])

    expect((await uow.repos.reviews.findActiveForDocument(DOC))?.id).toBe(second.id)
    const earlier = await uow.repos.reviews.listAssignments([first.id])
    expect(earlier).toHaveLength(1)
    expect(uow.auditEvents.map((e) => e.type)).toContain(REVIEW_AUDIT_EVENTS.superseded)
    expect(
      uow.events.map((e) => [e.type, (e.payload as { reason?: string }).reason]),
    ).toContainEqual(['ReviewWithdrawn', 'superseded'])
  })

  it('writes the event and the audit row without the message', async () => {
    await asked([{ kind: 'user', id: ADA }], { message: 'private words' })
    expect(uow.events.map((e) => e.type)).toEqual(['ReviewRequested'])
    expect(uow.events[0]?.payload).toMatchObject({
      version: 1,
      documentId: DOC,
      workspaceId: WORKSPACE,
      requestedBy: AUTHOR,
      reviewers: [{ kind: 'user', id: ADA }],
    })
    expect(uow.auditEvents.map((e) => e.type)).toEqual([REVIEW_AUDIT_EVENTS.requested])
    expect(JSON.stringify([uow.events, uow.auditEvents])).not.toContain('private words')
  })
})

describe('decideReview', () => {
  it('approves, and the request is approved once everybody has', async () => {
    await review([
      { kind: 'user', id: ADA },
      { kind: 'user', id: GRACE },
    ])

    const first = await answer(ADA, 'approve', 'Looks good')
    expect(first.kind === 'decided' && first.review.status).toBe('open')
    const second = await answer(GRACE, 'approve')
    expect(second.kind === 'decided' && second.review.status).toBe('approved')
    expect(
      second.kind === 'decided' && second.review.assignments.map((a) => a.decidedBy?.name),
    ).toEqual(['Ada', 'Grace'])
    expect(second.kind === 'decided' && second.review.assignments[0]?.comment).toBe('Looks good')
  })

  it('makes the request changes_requested as soon as one reviewer asks, and lets them change their mind', async () => {
    await review([
      { kind: 'user', id: ADA },
      { kind: 'user', id: GRACE },
    ])
    await answer(GRACE, 'approve')
    const asking = await answer(ADA, 'request_changes', 'Needs an example')
    expect(asking.kind === 'decided' && asking.review.status).toBe('changes_requested')

    const relented = await answer(ADA, 'approve')
    expect(relented.kind === 'decided' && relented.review.status).toBe('approved')
  })

  it('is answered by any one member of a group, including one in a nested group', async () => {
    await review([{ kind: 'group', id: 'reviewers' }])
    const result = await answer(NESTED_MEMBER, 'approve')
    expect(result.kind).toBe('decided')
    if (result.kind !== 'decided') return
    expect(result.review.status).toBe('approved')
    expect(result.review.assignments[0]?.decidedBy).toEqual({ id: NESTED_MEMBER, name: 'Nia' })
  })

  it('answers every assignment naming the person, directly and through a group', async () => {
    await review([
      { kind: 'user', id: GROUP_MEMBER },
      { kind: 'group', id: 'reviewers' },
    ])
    const result = await answer(GROUP_MEMBER, 'approve')
    expect(result.kind === 'decided' && result.review.status).toBe('approved')
  })

  it('refuses somebody who is not tagged, and a document with nothing open', async () => {
    expect(await answer(ADA, 'approve')).toEqual({ kind: 'no-open-request' })
    await review([{ kind: 'user', id: ADA }])
    expect(await answer(GRACE, 'approve')).toEqual({ kind: 'not-assigned' })
  })

  it('emits ReviewDecided and audits it without the comment', async () => {
    await review([{ kind: 'user', id: ADA }])
    await answer(ADA, 'request_changes', 'secret remark')
    const event = uow.events.find((e) => e.type === 'ReviewDecided')
    expect(event?.payload).toMatchObject({
      version: 1,
      decidedBy: ADA,
      decision: 'request_changes',
      status: 'changes_requested',
    })
    expect(uow.auditEvents.map((e) => e.type)).toContain(REVIEW_AUDIT_EVENTS.decided)
    expect(JSON.stringify([uow.events, uow.auditEvents])).not.toContain('secret remark')
  })

  it('tells the reviewer they can decide, and the stranger they cannot', async () => {
    await review([{ kind: 'user', id: ADA }])
    const seen = async (user: UserId) =>
      (await getReview(deps, { documentId: DOC, userId: user, canEdit: false, canManage: false }))
        ?.canDecide
    expect(await seen(ADA)).toBe(true)
    expect(await seen(GRACE)).toBeUndefined()
  })
})

describe('stale', () => {
  it('becomes true when the draft is edited, with no write to the request', async () => {
    const view = await review([{ kind: 'user', id: ADA }])
    expect(view.stale).toBe(false)
    const before = await uow.repos.reviews.findActiveForDocument(DOC)

    await editDraft(DOC)

    const after = await getReview(deps, {
      documentId: DOC,
      userId: AUTHOR,
      canEdit: true,
      canManage: false,
    })
    expect(after?.stale).toBe(true)
    expect(await uow.repos.reviews.findActiveForDocument(DOC)).toEqual(before)
  })
})

describe('getReview', () => {
  it('is null for a document with no request', async () => {
    expect(
      await getReview(deps, { documentId: DOC, userId: AUTHOR, canEdit: true, canManage: false }),
    ).toBeNull()
  })

  it('shows an editor, the requester and an assignee; nobody else', async () => {
    await review([{ kind: 'group', id: 'reviewers' }])
    const read = (user: UserId, canEdit: boolean) =>
      getReview(deps, { documentId: DOC, userId: user, canEdit, canManage: false })

    expect(await read(AUTHOR, true)).not.toBeNull()
    expect(await read(GRACE, true)).not.toBeNull()
    expect(await read(NESTED_MEMBER, false)).not.toBeNull()
    expect(await read(AUTHOR, false)).not.toBeNull()
    expect(await read(GRACE, false)).toBeNull()
  })

  it('returns the latest closed request once nothing is active', async () => {
    const view = await review([{ kind: 'user', id: ADA }])
    await withdrawReview(deps, { documentId: DOC, userId: AUTHOR, canManage: false })
    const read = await getReview(deps, {
      documentId: DOC,
      userId: AUTHOR,
      canEdit: true,
      canManage: false,
    })
    expect(read).toMatchObject({
      id: view.id,
      status: 'withdrawn',
      canDecide: false,
      canWithdraw: false,
    })
  })
})

describe('withdrawReview', () => {
  it('lets the requester or a manager withdraw, and nobody else', async () => {
    await review([{ kind: 'user', id: ADA }])
    expect(
      await withdrawReview(deps, { documentId: DOC, userId: GRACE, canManage: false }),
    ).toEqual({
      kind: 'forbidden',
    })
    expect(await withdrawReview(deps, { documentId: DOC, userId: GRACE, canManage: true })).toEqual(
      {
        kind: 'withdrawn',
      },
    )
    expect(await withdrawReview(deps, { documentId: DOC, userId: GRACE, canManage: true })).toEqual(
      {
        kind: 'no-open-request',
      },
    )
    expect(uow.events.map((e) => e.type)).toEqual(['ReviewRequested', 'ReviewWithdrawn'])
    expect(uow.auditEvents.map((e) => e.type)).toContain(REVIEW_AUDIT_EVENTS.withdrawn)
  })

  it('tells a manager who is not the requester that they can withdraw', async () => {
    await review([{ kind: 'user', id: ADA }])
    const read = (canManage: boolean) =>
      getReview(deps, { documentId: DOC, userId: GRACE, canEdit: true, canManage })
    expect((await read(true))?.canWithdraw).toBe(true)
    expect((await read(false))?.canWithdraw).toBe(false)
  })
})

describe('publishing', () => {
  it('closes the active request as published in the publish transaction', async () => {
    const view = await review([{ kind: 'user', id: ADA }])
    const document = await uow.repos.documents.findById(DOC)
    if (document === null) throw new Error('no document')

    const recorded = await recordPublish(
      {
        uow,
        clock,
        ids: createFakeIdGenerator(),
        // Only the recording is exercised; the store and format are not reached.
        contentStore: undefined as never,
        format: undefined as never,
      },
      {
        document,
        revision: revisionId('a'.repeat(40)),
        title: document.title,
        summary: document.title,
        author: { userId: AUTHOR, name: 'Author', email: 'author@example.com' },
        sessionId: 'session-author',
        changeNote: null,
      },
    )
    expect(recorded.ok).toBe(true)

    expect(await uow.repos.reviews.findActiveForDocument(DOC)).toBeNull()
    const read = await getReview(deps, {
      documentId: DOC,
      userId: AUTHOR,
      canEdit: true,
      canManage: false,
    })
    expect(read).toMatchObject({ id: view.id, status: 'published', stale: false, canDecide: false })
    expect(uow.auditEvents.map((e) => e.type)).toContain(REVIEW_AUDIT_EVENTS.published)
  })

  it('does nothing when no request is active', async () => {
    await closeReviewOnPublish(uow.repos, {
      documentId: DOC,
      publishedBy: AUTHOR,
      now: NOW,
      ids: createFakeIdGenerator(),
    })
    expect(uow.auditEvents).toEqual([])
  })
})

describe('isAssignedReviewer', () => {
  it('is true for a person tagged directly or through a group, on the active request only', async () => {
    await review([
      { kind: 'user', id: ADA },
      { kind: 'group', id: 'reviewers' },
    ])
    expect(await isAssignedReviewer(deps, DOC, ADA)).toBe(true)
    expect(await isAssignedReviewer(deps, DOC, NESTED_MEMBER)).toBe(true)
    expect(await isAssignedReviewer(deps, DOC, GRACE)).toBe(false)

    await withdrawReview(deps, { documentId: DOC, userId: AUTHOR, canManage: false })
    expect(await isAssignedReviewer(deps, DOC, ADA)).toBe(false)
  })
})

describe('listReviewerCandidates', () => {
  it('lists only people and groups who can already view, for a caller without manage', async () => {
    const found = await listReviewerCandidates(deps, {
      documentId: DOC,
      query: '',
      canManage: false,
    })
    const names = found.people.map((p) => p.name)
    expect(names).toContain('Ada')
    expect(names).toContain('Gwen')
    expect(names).toContain('Nia')
    expect(names).toContain('Admin')
    expect(names).not.toContain('Outsider')
    expect(found.groups.map((g) => g.name)).toEqual(['Frontend', 'Reviewers'])
    expect(found.groups.every((g) => g.canView)).toBe(true)
    expect(found.groups.find((g) => g.name === 'Reviewers')?.memberCount).toBe(2)
  })

  it('shows those who cannot view, last and marked, to a caller who may manage', async () => {
    const found = await listReviewerCandidates(deps, {
      documentId: DOC,
      query: '',
      canManage: true,
    })
    const outsider = found.people.find((p) => p.name === 'Outsider')
    expect(outsider?.canView).toBe(false)
    expect(found.people.at(-1)?.canView).toBe(false)
    expect(found.groups.find((g) => g.name === 'Strangers')?.canView).toBe(false)
  })

  it('matches by name, ignoring case, and cuts at twenty', async () => {
    const found = await listReviewerCandidates(deps, {
      documentId: DOC,
      query: 'AD',
      canManage: false,
    })
    expect(found.people.map((p) => p.name).toSorted()).toEqual(['Ada', 'Admin'])

    await Promise.all(
      Array.from({ length: 30 }, async (_, index) => {
        const id = userId(`00000000-0000-4000-8000-0000000b${String(index).padStart(4, '0')}`)
        await person(id, `Bulk ${index}`)
        await grant('user', id, 'viewer')
      }),
    )
    const many = await listReviewerCandidates(deps, {
      documentId: DOC,
      query: 'bulk',
      canManage: false,
    })
    expect(many.people).toHaveLength(20)
  })

  it('answers nothing for a document that is not there', async () => {
    const found = await listReviewerCandidates(deps, {
      documentId: documentId('00000000-0000-4000-8000-0000000009ff'),
      query: '',
      canManage: true,
    })
    expect(found).toEqual({ people: [], groups: [] })
  })
})

describe('createReviewerAccessProbe', () => {
  it('is null for a document that is not there', async () => {
    expect(
      await createReviewerAccessProbe(
        uow.repos,
        documentId('00000000-0000-4000-8000-0000000009ff'),
      ),
    ).toBeNull()
  })

  it('lets a group with a parent that grants access view, and a loop in the tree stop', async () => {
    const probe = await createReviewerAccessProbe(uow.repos, DOC)
    expect(await probe?.canView({ kind: 'group', id: 'frontend' })).toBe(true)
    expect(await probe?.canView({ kind: 'group', id: 'missing' })).toBe(false)

    await uow.repos.groups.create({
      id: 'loop-a',
      unitId: 'acme',
      parentGroupId: 'loop-b',
      name: 'A',
      now: NOW,
    })
    await uow.repos.groups.create({
      id: 'loop-b',
      unitId: 'acme',
      parentGroupId: 'loop-a',
      name: 'B',
      now: NOW,
    })
    expect(await probe?.canView({ kind: 'group', id: 'loop-a' })).toBe(false)
  })
})

describe('getAttention', () => {
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
  const attention = (user: UserId) =>
    getAttention(deps, { userId: user, authorizer: authorizerFor(user) })

  it('lists requests waiting on a person, directly or through a group, and not on the requester', async () => {
    await review([
      { kind: 'user', id: ADA },
      { kind: 'group', id: 'reviewers' },
    ])
    expect((await attention(ADA)).map((i) => [i.kind, i.by.name, i.document.id])).toEqual([
      ['review-requested', 'Author', DOC],
    ])
    expect(await attention(NESTED_MEMBER)).toHaveLength(1)
    expect(await attention(GRACE)).toEqual([])
    expect(await attention(AUTHOR)).toEqual([])
  })

  it('stops listing a request once the person has answered it', async () => {
    await review([{ kind: 'user', id: ADA }])
    await answer(ADA, 'approve')
    expect(await attention(ADA)).toEqual([])
  })

  it('tells the requester about the answers, newest first, with who gave them', async () => {
    await review([{ kind: 'user', id: ADA }])
    clock.advance(1000)
    await answer(ADA, 'request_changes')
    expect((await attention(AUTHOR)).map((i) => [i.kind, i.by.name])).toEqual([
      ['changes-requested', 'Ada'],
    ])

    await review([{ kind: 'user', id: GRACE }])
    clock.advance(1000)
    await answer(GRACE, 'approve')
    expect((await attention(AUTHOR)).map((i) => i.kind)).toEqual(['review-approved'])
  })

  it('leaves out a document the person can no longer view', async () => {
    await review([{ kind: 'user', id: ADA }])
    await grant('user', ADA, 'viewer', 'document', DOC, 'deny')
    expect(await attention(ADA)).toEqual([])
  })
})
