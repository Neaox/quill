import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDocument } from '@quill/markdown'
import { createGrant } from '@quill/application'
import { userId } from '@quill/domain'
import type { DocumentId, Role, UserId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Review requests end to end (ADR-052): asking, answering, withdrawing, what
 * a publish does to them, who may read what, and the reviewer's view of the
 * draft they were asked about. Over a real database and the real publish path.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let editor: Record<string, string>
let viewer: Record<string, string>
let admin: Record<string, string>
let outsider: Record<string, string>

// People the shared fixture does not have, made here.
const GRACE = userId('00000000-0000-4000-8000-00000000b001')
const GWEN = userId('00000000-0000-4000-8000-00000000b002')
const NIA = userId('00000000-0000-4000-8000-00000000b003')
let grace: Record<string, string>
let gwen: Record<string, string>
let nia: Record<string, string>

const GROUP = 'reviewers-group'
const CHILD_GROUP = 'frontend-group'

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
  admin = await harness.cookiesFor(tenancy.admin)
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
    name: 'Reviewers',
    now,
  })
  await repos.groups.create({
    id: CHILD_GROUP,
    unitId: tenancy.unitId,
    parentGroupId: GROUP,
    name: 'Frontend',
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

async function writeDraft(id: DocumentId, markdown: string, expectedVersion: number) {
  const { frontMatter, ast } = parseDocument(markdown)
  await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/lock/acquire`,
    cookies: editor,
  })
  const write = await harness.app.inject({
    method: 'PUT',
    url: `/api/documents/${id}/draft`,
    cookies: editor,
    payload: { ast: { version: 1, frontMatter, ast }, expectedVersion } as Record<string, unknown>,
  })
  expect(write.statusCode).toBe(200)
  await harness.app.inject({ method: 'DELETE', url: `/api/documents/${id}/lock`, cookies: editor })
}

const baseOf = async (id: DocumentId): Promise<string | null> =>
  (await harness.deps.uow.repos.drafts.find(id))?.baseRevision ?? null

const get = (url: string, cookies: Record<string, string>) =>
  harness.app.inject({ method: 'GET', url, cookies })

const ask = (
  id: DocumentId,
  reviewers: readonly { kind: 'user' | 'group'; id: string }[],
  cookies = editor,
  message?: string,
) =>
  harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/review`,
    cookies,
    payload: { reviewers, ...(message === undefined ? {} : { message }) },
  })

const decide = (
  id: DocumentId,
  cookies: Record<string, string>,
  decision: 'approve' | 'request_changes',
  comment?: string,
) =>
  harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/review/decision`,
    cookies,
    payload: { decision, ...(comment === undefined ? {} : { comment }) },
  })

/** What is waiting on this person about one document; the database is shared by every test here. */
async function attentionFor(cookies: Record<string, string>, id: DocumentId) {
  const items = (await get('/api/me/attention', cookies)).json().items as {
    document: { id: string }
  }[]
  return items.filter((item) => item.document.id === id)
}

const withdraw = (id: DocumentId, cookies: Record<string, string>) =>
  harness.app.inject({ method: 'DELETE', url: `/api/documents/${id}/review`, cookies })

describe('asking for a review', () => {
  it('creates the request, shows it to the people involved, and lists what is waiting', async () => {
    const id = await createDocument('Needs eyes')
    const created = await ask(
      id,
      [
        { kind: 'user', id: tenancy.viewer },
        { kind: 'group', id: GROUP },
      ],
      editor,
      'Please check the rotation section',
    )
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      documentId: id,
      status: 'open',
      message: 'Please check the rotation section',
      requestedBy: { id: tenancy.editor, name: 'Editor' },
      stale: false,
      canDecide: false,
      canWithdraw: true,
    })
    expect(created.json().assignments).toMatchObject([
      { reviewer: { kind: 'user', name: 'Viewer' }, state: 'pending', decidedBy: null },
      { reviewer: { kind: 'group', name: 'Reviewers', memberCount: 2 }, state: 'pending' },
    ])

    // The reviewer sees it and may decide; the requester sees it; a stranger sees nothing.
    const asReviewer = (await get(`/api/documents/${id}/review`, viewer)).json().request
    expect(asReviewer).toMatchObject({ id: created.json().id, canDecide: true, canWithdraw: false })
    expect((await get(`/api/documents/${id}/review`, editor)).json().request.id).toBe(
      created.json().id,
    )
    // Grace can view but was not asked and cannot edit: a 200 that reveals nothing.
    const stranger = await get(`/api/documents/${id}/review`, grace)
    expect(stranger.statusCode).toBe(200)
    expect(stranger.json()).toEqual({ request: null })
    // Nobody who cannot view the document is told anything about it.
    expect((await get(`/api/documents/${id}/review`, outsider)).statusCode).toBe(403)

    // What is waiting on a reviewer, directly or through a group, newest first.
    const waiting = await attentionFor(viewer, id)
    expect(waiting).toMatchObject([
      {
        kind: 'review-requested',
        requestId: created.json().id,
        document: { id, title: 'Needs eyes', workspaceId: tenancy.workspaceId },
        by: { name: 'Editor' },
      },
    ])
    expect(await attentionFor(nia, id)).toHaveLength(1)
    expect(await attentionFor(grace, id)).toEqual([])
  })

  it('needs edit, and names a reviewer who cannot view', async () => {
    const id = await createDocument('Who can see this')
    expect((await ask(id, [{ kind: 'user', id: tenancy.viewer }], viewer)).statusCode).toBe(403)

    const refused = await ask(id, [
      { kind: 'user', id: tenancy.viewer },
      { kind: 'user', id: tenancy.outsider },
    ])
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({
      code: 'reviewer_cannot_view',
      details: { reviewers: [{ kind: 'user', id: tenancy.outsider }] },
    })
  })

  it('accepts between one and twenty reviewers and a message of at most a thousand characters', async () => {
    const id = await createDocument('Limits')
    expect((await ask(id, [])).statusCode).toBe(400)
    const twentyOne = Array.from({ length: 21 }, (_, index) => ({
      kind: 'user' as const,
      id: `person-${index}`,
    }))
    expect((await ask(id, twentyOne)).statusCode).toBe(400)
    const long = await ask(id, [{ kind: 'user', id: tenancy.viewer }], editor, 'x'.repeat(1001))
    expect(long.statusCode).toBe(400)
  })

  it('refuses a field it does not know, rather than quietly dropping it', async () => {
    const id = await createDocument('Strict')
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/review`,
      cookies: editor,
      payload: { reviewers: [{ kind: 'user', id: tenancy.viewer }], publishNow: true },
    })
    expect(response.statusCode).toBe(400)
    const inner = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/review`,
      cookies: editor,
      payload: { reviewers: [{ kind: 'user', id: tenancy.viewer, role: 'admin' }] },
    })
    expect(inner.statusCode).toBe(400)
  })

  it('supersedes the earlier request, so one is open at a time', async () => {
    const id = await createDocument('Asking twice')
    const first = await ask(id, [{ kind: 'user', id: tenancy.viewer }])
    const second = await ask(id, [{ kind: 'user', id: GRACE }])
    expect(second.statusCode).toBe(201)

    const current = (await get(`/api/documents/${id}/review`, editor)).json().request
    expect(current.id).toBe(second.json().id)
    expect(current.id).not.toBe(first.json().id)
    // Whoever was asked first is no longer waited on.
    expect((await get(`/api/documents/${id}/review`, viewer)).json()).toEqual({ request: null })
    expect((await decide(id, viewer, 'approve')).statusCode).toBe(403)
  })
})

describe('answering', () => {
  it('derives the overall status, and a group is answered by any one member', async () => {
    const id = await createDocument('Answers')
    await ask(id, [
      { kind: 'user', id: tenancy.viewer },
      { kind: 'group', id: GROUP },
    ])

    const first = await decide(id, viewer, 'approve', 'Looks right')
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ status: 'open', canDecide: true })

    // Nia is in a group nested inside the one that was asked.
    harness.clock.advance(1000)
    const second = await decide(id, nia, 'approve')
    expect(second.json().status).toBe('approved')
    expect(second.json().assignments).toMatchObject([
      { state: 'approved', decidedBy: { name: 'Viewer' }, comment: 'Looks right' },
      { state: 'approved', decidedBy: { name: 'Nia' }, comment: null },
    ])

    // The author hears about it, and an answer that asks for changes outweighs the rest.
    const attention = await attentionFor(editor, id)
    expect(attention).toMatchObject([{ kind: 'review-approved', by: { name: 'Nia' } }])
    harness.clock.advance(1000)
    const changes = await decide(id, gwen, 'request_changes', 'Needs a diagram')
    expect(changes.json().status).toBe('changes_requested')
    expect(await attentionFor(editor, id)).toMatchObject([
      { kind: 'changes-requested', by: { name: 'Gwen' } },
    ])
  })

  it('refuses somebody who was not asked, and a document with no open request', async () => {
    const id = await createDocument('Not asked')
    expect((await decide(id, viewer, 'approve')).statusCode).toBe(404)
    await ask(id, [{ kind: 'user', id: tenancy.viewer }])
    expect((await decide(id, grace, 'approve')).statusCode).toBe(403)
    expect((await decide(id, outsider, 'approve')).statusCode).toBe(403)
  })

  it('marks the request stale as soon as the draft is edited', async () => {
    const id = await createDocument('Edited after')
    await writeDraft(id, '# Edited after\n\nFirst.\n', 0)
    await ask(id, [{ kind: 'user', id: tenancy.viewer }])
    await decide(id, viewer, 'approve')
    expect((await get(`/api/documents/${id}/review`, editor)).json().request.stale).toBe(false)

    await writeDraft(id, '# Edited after\n\nSecond.\n', 1)

    const after = (await get(`/api/documents/${id}/review`, editor)).json().request
    expect(after).toMatchObject({ stale: true, status: 'approved' })
    expect(after.assignments[0].state).toBe('approved')
  })
})

describe('withdrawing', () => {
  it('lets the requester or someone who can manage, and nobody else', async () => {
    const id = await createDocument('Take it back')
    await ask(id, [{ kind: 'user', id: tenancy.viewer }])
    expect((await withdraw(id, viewer)).statusCode).toBe(403)
    expect((await withdraw(id, grace)).statusCode).toBe(403)
    expect((await withdraw(id, editor)).statusCode).toBe(204)
    expect((await withdraw(id, editor)).statusCode).toBe(404)

    const closed = (await get(`/api/documents/${id}/review`, editor)).json().request
    expect(closed).toMatchObject({ status: 'withdrawn', canDecide: false, canWithdraw: false })

    await ask(id, [{ kind: 'user', id: tenancy.viewer }])
    expect((await withdraw(id, admin)).statusCode).toBe(204)
  })
})

describe('publishing', () => {
  it('closes the open request as published', async () => {
    const id = await createDocument('Goes live')
    await writeDraft(id, '# Goes live\n\nBody.\n', 0)
    const asked = await ask(id, [{ kind: 'user', id: tenancy.viewer }])

    const published = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/publish`,
      cookies: editor,
      payload: { base: await baseOf(id) },
    })
    expect(published.statusCode).toBe(200)

    const closed = (await get(`/api/documents/${id}/review`, editor)).json().request
    expect(closed).toMatchObject({
      id: asked.json().id,
      status: 'published',
      stale: false,
      canDecide: false,
    })
    expect((await decide(id, viewer, 'approve')).statusCode).toBe(404)
    expect(await attentionFor(viewer, id)).toEqual([])
  })

  it('records the request, the decision and the publish as audit rows and events, without comments', async () => {
    const id = await createDocument('Audited')
    await ask(id, [{ kind: 'user', id: tenancy.viewer }], editor, 'a private message')
    await decide(id, viewer, 'approve', 'a private comment')
    await withdraw(id, editor)

    const events = await harness.deps.uow.repos.reviews.findLatestForDocument(id)
    expect(events?.status).toBe('withdrawn')
    const { rows: outbox } = await harness.database.pool.query(
      `SELECT type, payload FROM outbox_events WHERE payload->>'documentId' = $1 ORDER BY created_at, id`,
      [id],
    )
    const types = outbox.map((row: { type: string }) => row.type)
    expect(types).toEqual(
      expect.arrayContaining(['ReviewRequested', 'ReviewDecided', 'ReviewWithdrawn']),
    )
    const { rows: audit } = await harness.database.pool.query(
      `SELECT type, metadata FROM audit_events WHERE type LIKE 'review.%' AND metadata->>'documentId' = $1`,
      [id],
    )
    expect(audit.map((row: { type: string }) => row.type)).toEqual(
      expect.arrayContaining(['review.requested', 'review.decided', 'review.withdrawn']),
    )
    const written = JSON.stringify([outbox, audit])
    expect(written).not.toContain('a private message')
    expect(written).not.toContain('a private comment')
  })
})

describe('reviewer candidates', () => {
  it('lists only people and groups who can already view, matched by name', async () => {
    const id = await createDocument('Candidates')
    const found = (await get(`/api/documents/${id}/reviewer-candidates`, editor)).json()
    const names = found.people.map((person: { name: string }) => person.name)
    expect(names).toEqual(expect.arrayContaining(['Viewer', 'Grace', 'Gwen', 'Nia', 'Admin']))
    expect(names).not.toContain('Outsider')
    expect(found.groups.map((group: { name: string }) => group.name)).toEqual([
      'Frontend',
      'Reviewers',
    ])
    expect(
      found.groups.find((group: { name: string }) => group.name === 'Reviewers'),
    ).toMatchObject({
      memberCount: 2,
      canView: true,
    })

    const narrowed = (await get(`/api/documents/${id}/reviewer-candidates?q=GR`, editor)).json()
    expect(narrowed.people.map((person: { name: string }) => person.name)).toEqual(['Grace'])
    expect(narrowed.people[0]).toMatchObject({ email: 'grace@example.com', canView: true })
  })

  it('needs edit, and shows who cannot view only to someone who may manage', async () => {
    const id = await createDocument('Manage sees more')
    expect((await get(`/api/documents/${id}/reviewer-candidates`, viewer)).statusCode).toBe(403)

    const asEditor = (
      await get(`/api/documents/${id}/reviewer-candidates?q=outsider`, editor)
    ).json()
    expect(asEditor.people).toEqual([])
    const asAdmin = (await get(`/api/documents/${id}/reviewer-candidates?q=outsider`, admin)).json()
    expect(asAdmin.people).toMatchObject([{ name: 'Outsider', canView: false }])
  })
})

describe('the reviewer reading the draft', () => {
  it('lets somebody asked to review compare the draft, and an unassigned viewer still gets 403', async () => {
    const id = await createDocument('Review this change')
    await writeDraft(id, '# Review this change\n\nBody.\n', 0)
    const published = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/publish`,
      cookies: editor,
      payload: { base: await baseOf(id) },
    })
    await writeDraft(id, '# Review this change\n\nBody, edited.\n', 1)
    const range = `from=${published.json().revision}&to=draft`

    // Before anybody is asked, a viewer cannot read the draft.
    expect((await get(`/api/documents/${id}/compare?${range}`, viewer)).statusCode).toBe(403)

    await ask(id, [
      { kind: 'user', id: tenancy.viewer },
      { kind: 'group', id: GROUP },
    ])
    const reviewer = await get(`/api/documents/${id}/compare?${range}`, viewer)
    expect(reviewer.statusCode).toBe(200)
    expect(reviewer.json().summary).toMatchObject({ changed: 1 })
    // Through a group, nested or not.
    expect((await get(`/api/documents/${id}/compare?${range}`, nia)).statusCode).toBe(200)
    // A viewer who was not asked, and a person who cannot view at all.
    expect((await get(`/api/documents/${id}/compare?${range}`, grace)).statusCode).toBe(403)
    expect((await get(`/api/documents/${id}/compare?${range}`, outsider)).statusCode).toBe(403)

    // Only the comparison: the draft itself, and its lock, stay closed to them.
    const raw = await get(`/api/documents/${id}/draft`, viewer)
    expect(raw.statusCode).toBe(403)
    const lock = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/lock/acquire`,
      cookies: viewer,
    })
    expect(lock.statusCode).toBe(403)

    // And it ends with the review.
    await withdraw(id, editor)
    expect((await get(`/api/documents/${id}/compare?${range}`, viewer)).statusCode).toBe(403)
  })
})
