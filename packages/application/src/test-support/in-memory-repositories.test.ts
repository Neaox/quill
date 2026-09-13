import { describe, expect, it } from 'vitest'
import { documentId, revisionId, userId, workspaceId } from '@quill/domain'

import { createInMemoryUnitOfWork } from './in-memory-repositories.ts'
import { aShortId } from './fakes.ts'

const USER_1 = userId('00000000-0000-4000-8000-000000000001')
const USER_2 = userId('00000000-0000-4000-8000-000000000002')
const NOPE_USER = userId('00000000-0000-4000-8000-0000000000ff')
const ADMIN_USER = userId('00000000-0000-4000-8000-0000000000ad')
const WORKSPACE_1 = workspaceId('00000000-0000-4000-8000-000000000101')
const NOPE_WORKSPACE = workspaceId('00000000-0000-4000-8000-0000000001ff')
const DOC_1 = documentId('00000000-0000-4000-8000-000000000201')
const NO_LOCK_DOC = documentId('00000000-0000-4000-8000-000000000202')
const NOPE_DOC = documentId('00000000-0000-4000-8000-0000000002ff')
const REVISION = revisionId('a'.repeat(40))
const OTHER_REVISION = revisionId('b'.repeat(40))

/**
 * This fake stands in for the real, Postgres-backed `UnitOfWork` in unit
 * tests of the use cases. It lives under `src/`, so — same as any other
 * module here — it is held to the same coverage bar; these are its own
 * tests, independent of whatever use case happens to exercise it.
 */
const NOW = new Date('2026-01-01T00:00:00.000Z')

describe('createInMemoryUnitOfWork: users', () => {
  it('creates, finds, verifies, and promotes a user; misses report null or are no-ops', async () => {
    const uow = createInMemoryUnitOfWork()
    const user = await uow.repos.users.create({
      id: USER_1,
      email: 'a@example.com',
      displayName: 'A',
      now: NOW,
    })
    expect(user.isInstanceAdmin).toBe(false)
    expect(user.emailVerifiedAt).toBeNull()

    expect(await uow.repos.users.findById(USER_1)).toEqual(user)
    expect(await uow.repos.users.findById(NOPE_USER)).toBeNull()
    expect(await uow.repos.users.findByEmail('a@example.com')).toEqual(user)
    expect(await uow.repos.users.findByEmail('nope@example.com')).toBeNull()

    await uow.repos.users.markEmailVerified(USER_1, NOW)
    expect((await uow.repos.users.findById(USER_1))?.emailVerifiedAt).toEqual(NOW)
    await uow.repos.users.markEmailVerified(NOPE_USER, NOW) // no-op, does not throw

    await uow.repos.users.setInstanceAdmin(USER_1, true)
    expect((await uow.repos.users.findById(USER_1))?.isInstanceAdmin).toBe(true)
    await uow.repos.users.setInstanceAdmin(NOPE_USER, true) // no-op, does not throw
  })
})

describe('createInMemoryUnitOfWork: credentials', () => {
  it('upserts, finds, and deletes', async () => {
    const uow = createInMemoryUnitOfWork()
    expect(await uow.repos.credentials.findByUserId(USER_1)).toBeNull()
    await uow.repos.credentials.upsert({ userId: USER_1, passwordHash: 'h1', now: NOW })
    expect(await uow.repos.credentials.findByUserId(USER_1)).toEqual({
      userId: USER_1,
      passwordHash: 'h1',
      updatedAt: NOW,
    })
    await uow.repos.credentials.delete(USER_1)
    expect(await uow.repos.credentials.findByUserId(USER_1)).toBeNull()
  })
})

describe('createInMemoryUnitOfWork: sessions', () => {
  const expiresAt = new Date(NOW.getTime() + 1000)

  async function seedThree(uow: ReturnType<typeof createInMemoryUnitOfWork>): Promise<void> {
    await uow.repos.sessions.create({
      id: 's1',
      userId: USER_1,
      tokenHash: 'hash-1',
      now: NOW,
      expiresAt,
    })
    await uow.repos.sessions.create({
      id: 's2',
      userId: USER_1,
      tokenHash: 'hash-2',
      now: NOW,
      expiresAt,
    })
    await uow.repos.sessions.create({
      id: 's3',
      userId: USER_2,
      tokenHash: 'hash-3',
      now: NOW,
      expiresAt,
    })
  }

  it('creates, finds, deletes one, and deletes all for a user', async () => {
    const uow = createInMemoryUnitOfWork()
    await seedThree(uow)

    expect(await uow.repos.sessions.findById('s1')).not.toBeNull()
    expect(await uow.repos.sessions.findById('nope')).toBeNull()

    await uow.repos.sessions.delete('s1')
    expect(await uow.repos.sessions.findById('s1')).toBeNull()

    await uow.repos.sessions.deleteAllForUser(USER_1)
    expect(await uow.repos.sessions.findById('s2')).toBeNull()
    expect(await uow.repos.sessions.findById('s3')).not.toBeNull()
  })

  it('finds by token hash, which is the only key a cookie can reach', async () => {
    const uow = createInMemoryUnitOfWork()
    await seedThree(uow)
    expect((await uow.repos.sessions.findByTokenHash('hash-2'))?.id).toBe('s2')
    expect(await uow.repos.sessions.findByTokenHash('nope')).toBeNull()
  })

  it('stamps last seen, and ignores a stamp for a session that is gone', async () => {
    const uow = createInMemoryUnitOfWork()
    await seedThree(uow)
    const later = new Date(NOW.getTime() + 500)
    await uow.repos.sessions.touch('s1', later)
    expect((await uow.repos.sessions.findById('s1'))?.lastSeenAt).toEqual(later)
    await uow.repos.sessions.touch('nope', later) // no-op, does not throw
  })

  it('lists one user’s sessions, newest first', async () => {
    const uow = createInMemoryUnitOfWork()
    await seedThree(uow)
    await uow.repos.sessions.create({
      id: 's4',
      userId: USER_1,
      tokenHash: 'hash-4',
      now: new Date(NOW.getTime() + 100),
      expiresAt,
    })
    expect((await uow.repos.sessions.listForUser(USER_1)).map((row) => row.id)).toEqual([
      's4',
      's1',
      's2',
    ])
  })

  it('keeps one session when signing out everywhere else', async () => {
    const uow = createInMemoryUnitOfWork()
    await seedThree(uow)
    await uow.repos.sessions.deleteAllForUserExcept(USER_1, 's2')
    expect((await uow.repos.sessions.listForUser(USER_1)).map((row) => row.id)).toEqual(['s2'])
    expect(await uow.repos.sessions.findById('s3')).not.toBeNull()
  })

  it('sweeps expired and idle sessions, dropping the locks they held, and keeps the rest', async () => {
    const uow = createInMemoryUnitOfWork()
    await uow.repos.sessions.create({
      id: 'expired',
      userId: USER_1,
      tokenHash: 'h-expired',
      now: NOW,
      expiresAt: new Date(NOW.getTime() - 1000),
    })
    await uow.repos.sessions.create({
      id: 'idle',
      userId: USER_1,
      tokenHash: 'h-idle',
      now: NOW,
      expiresAt: new Date(NOW.getTime() + 100_000),
    })
    await uow.repos.sessions.touch('idle', new Date(NOW.getTime() - 500))
    await uow.repos.sessions.create({
      id: 'active',
      userId: USER_1,
      tokenHash: 'h-active',
      now: NOW,
      expiresAt: new Date(NOW.getTime() + 100_000),
    })
    await uow.repos.locks.acquire({
      documentId: DOC_1,
      userId: USER_1,
      sessionId: 'expired',
      now: NOW,
    })

    const removed = await uow.repos.sessions.deleteExpired({
      now: NOW,
      idleCutoff: new Date(NOW.getTime() - 100),
    })

    expect(removed).toBe(2)
    expect(await uow.repos.sessions.findById('expired')).toBeNull()
    expect(await uow.repos.sessions.findById('idle')).toBeNull()
    expect(await uow.repos.sessions.findById('active')).not.toBeNull()
    expect(await uow.repos.locks.find(DOC_1)).toBeNull()
  })
})

describe('createInMemoryUnitOfWork: magic links', () => {
  it('creates, finds, and consumes exactly once', async () => {
    const uow = createInMemoryUnitOfWork()
    const expiresAt = new Date(NOW.getTime() + 1000)
    await uow.repos.magicLinks.create({
      id: 'link-1',
      userId: USER_1,
      tokenHash: 'hash-1',
      purpose: 'sign-in',
      now: NOW,
      expiresAt,
    })

    expect(await uow.repos.magicLinks.findByTokenHash('hash-1')).not.toBeNull()
    expect(await uow.repos.magicLinks.findByTokenHash('nope')).toBeNull()

    expect(await uow.repos.magicLinks.consume('link-1', NOW)).toBe(true)
    expect(await uow.repos.magicLinks.consume('link-1', NOW)).toBe(false)
    expect(await uow.repos.magicLinks.consume('nope', NOW)).toBe(false)
  })

  it('supersedes only the unconsumed links of one user and purpose', async () => {
    const uow = createInMemoryUnitOfWork()
    const expiresAt = new Date(NOW.getTime() + 1000)
    const link = (id: string, owner: typeof USER_1, purpose: 'sign-in' | 'password-reset') =>
      uow.repos.magicLinks.create({
        id,
        userId: owner,
        tokenHash: `hash-${id}`,
        purpose,
        now: NOW,
        expiresAt,
      })

    await link('mine-signin', USER_1, 'sign-in')
    await link('mine-reset', USER_1, 'password-reset')
    await link('theirs-signin', USER_2, 'sign-in')
    await uow.repos.magicLinks.consume('mine-signin', NOW)
    await link('mine-signin-2', USER_1, 'sign-in')

    expect(await uow.repos.magicLinks.supersede(USER_1, 'sign-in', NOW)).toBe(1)

    expect((await uow.repos.magicLinks.findByTokenHash('hash-mine-signin-2'))?.consumedAt).toEqual(
      NOW,
    )
    expect((await uow.repos.magicLinks.findByTokenHash('hash-mine-reset'))?.consumedAt).toBeNull()
    expect(
      (await uow.repos.magicLinks.findByTokenHash('hash-theirs-signin'))?.consumedAt,
    ).toBeNull()
  })

  it('sweeps consumed and expired links, keeping the ones still pending', async () => {
    const uow = createInMemoryUnitOfWork()
    const expiresAt = new Date(NOW.getTime() + 100_000)
    await uow.repos.magicLinks.create({
      id: 'consumed',
      userId: USER_1,
      tokenHash: 'h-consumed',
      purpose: 'sign-in',
      now: NOW,
      expiresAt,
    })
    await uow.repos.magicLinks.consume('consumed', NOW)
    await uow.repos.magicLinks.create({
      id: 'expired',
      userId: USER_1,
      tokenHash: 'h-expired',
      purpose: 'sign-in',
      now: NOW,
      expiresAt: new Date(NOW.getTime() - 1000),
    })
    await uow.repos.magicLinks.create({
      id: 'pending',
      userId: USER_1,
      tokenHash: 'h-pending',
      purpose: 'sign-in',
      now: NOW,
      expiresAt,
    })

    const removed = await uow.repos.magicLinks.deleteSpent(NOW)

    expect(removed).toBe(2)
    expect(await uow.repos.magicLinks.findByTokenHash('h-consumed')).toBeNull()
    expect(await uow.repos.magicLinks.findByTokenHash('h-expired')).toBeNull()
    expect(await uow.repos.magicLinks.findByTokenHash('h-pending')).not.toBeNull()
  })
})

describe('createInMemoryUnitOfWork: units', () => {
  it('creates, finds, lists children, renames, and deletes', async () => {
    const uow = createInMemoryUnitOfWork()
    await uow.repos.units.create({
      id: 'root',
      parentId: null,
      name: 'Root',
      slug: 'root',
      label: 'company',
      now: NOW,
    })
    await uow.repos.units.create({
      id: 'child',
      parentId: 'root',
      name: 'Child',
      slug: 'child',
      label: 'team',
      now: NOW,
    })

    expect(await uow.repos.units.findById('root')).not.toBeNull()
    expect(await uow.repos.units.findById('nope')).toBeNull()
    expect((await uow.repos.units.listChildren(null)).map((u) => u.id)).toEqual(['root'])
    expect((await uow.repos.units.listChildren('root')).map((u) => u.id)).toEqual(['child'])
    expect((await uow.repos.units.listAncestors('child')).map((u) => u.id)).toEqual([
      'child',
      'root',
    ])
    expect(await uow.repos.units.listAncestors('nope')).toEqual([])

    const renamed = await uow.repos.units.rename('root', 'Renamed')
    expect(renamed.name).toBe('Renamed')
    await expect(uow.repos.units.rename('nope', 'x')).rejects.toThrow('rename: unit nope not found')

    await uow.repos.units.delete('child')
    expect(await uow.repos.units.findById('child')).toBeNull()
  })
})

describe('createInMemoryUnitOfWork: workspaces', () => {
  it('creates, finds by id and slug, lists by unit, renames, and deletes', async () => {
    const uow = createInMemoryUnitOfWork()
    await uow.repos.workspaces.create({
      id: WORKSPACE_1,
      unitId: 'unit-1',
      name: 'WS',
      slug: 'ws',
      now: NOW,
    })

    expect(await uow.repos.workspaces.findById(WORKSPACE_1)).not.toBeNull()
    expect(await uow.repos.workspaces.findById(NOPE_WORKSPACE)).toBeNull()
    expect(await uow.repos.workspaces.findBySlug('ws')).not.toBeNull()
    expect(await uow.repos.workspaces.findBySlug('nope')).toBeNull()
    expect((await uow.repos.workspaces.listByUnit('unit-1')).map((w) => w.id)).toEqual([
      WORKSPACE_1,
    ])

    const renamed = await uow.repos.workspaces.rename(WORKSPACE_1, 'Renamed')
    expect(renamed.name).toBe('Renamed')
    expect(renamed.slug).toBe('ws')
    const moved = await uow.repos.workspaces.rename(WORKSPACE_1, 'Renamed', 'renamed')
    expect(moved.slug).toBe('renamed')
    await expect(uow.repos.workspaces.rename(NOPE_WORKSPACE, 'x')).rejects.toThrow(
      `rename: workspace ${NOPE_WORKSPACE} not found`,
    )

    await uow.repos.workspaces.delete(WORKSPACE_1)
    expect(await uow.repos.workspaces.findById(WORKSPACE_1)).toBeNull()
  })
})

describe('createInMemoryUnitOfWork: documents', () => {
  const input = {
    id: DOC_1,
    shortId: aShortId(),
    workspaceId: WORKSPACE_1,
    collectionId: null,
    parentId: null,
    slug: 'doc',
    path: '/doc',
    title: 'Doc',
    status: 'draft' as const,
    templateId: null,
    templateVersion: null,
    now: NOW,
  }

  it('creates, finds by id and path, lists by workspace, updates, and deletes', async () => {
    const uow = createInMemoryUnitOfWork()
    await uow.repos.documents.create(input)

    expect(await uow.repos.documents.findById(DOC_1)).not.toBeNull()
    expect(await uow.repos.documents.findById(NOPE_DOC)).toBeNull()
    expect(await uow.repos.documents.findByPath(WORKSPACE_1, '/doc')).not.toBeNull()
    expect(await uow.repos.documents.findByPath(WORKSPACE_1, '/nope')).toBeNull()
    expect((await uow.repos.documents.listByWorkspace(WORKSPACE_1)).map((d) => d.id)).toEqual([
      DOC_1,
    ])

    const updated = await uow.repos.documents.update(DOC_1, { title: 'New' }, NOW)
    expect(updated.title).toBe('New')
    await expect(uow.repos.documents.update(NOPE_DOC, {}, NOW)).rejects.toThrow(
      `update: document ${NOPE_DOC} not found`,
    )

    await uow.repos.documents.delete(DOC_1)
    expect(await uow.repos.documents.findById(DOC_1)).toBeNull()
  })

  it('finds a document by its short key, one at a time and in bulk', async () => {
    const uow = createInMemoryUnitOfWork()
    await uow.repos.documents.create(input)
    await uow.repos.documents.create({
      ...input,
      id: NO_LOCK_DOC,
      shortId: aShortId(2),
      path: '/other',
    })

    expect(await uow.repos.documents.findByShortId(input.shortId)).toMatchObject({ id: DOC_1 })
    expect(await uow.repos.documents.findByShortId(aShortId(99))).toBeNull()
    expect(
      (await uow.repos.documents.listByShortIds([input.shortId, aShortId(2), aShortId(99)])).map(
        (row) => row.id,
      ),
    ).toEqual([DOC_1, NO_LOCK_DOC])
  })

  it('refuses a creation whose path is taken, and one whose key is taken', async () => {
    const uow = createInMemoryUnitOfWork()
    expect(await uow.repos.documents.createIfAvailable(input)).toMatchObject({ kind: 'created' })
    expect(await uow.repos.documents.createIfAvailable({ ...input, id: NO_LOCK_DOC })).toEqual({
      kind: 'path-taken',
    })
    expect(
      await uow.repos.documents.createIfAvailable({
        ...input,
        id: NO_LOCK_DOC,
        path: '/other',
      }),
    ).toEqual({ kind: 'short-id-taken' })
  })
})

describe('createInMemoryUnitOfWork: workspace slug history', () => {
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000

  it('answers with a retired slug until its cutoff, and with the newest claim on it', async () => {
    const uow = createInMemoryUnitOfWork()
    await uow.repos.workspaceSlugHistory.record({
      workspaceId: WORKSPACE_1,
      slug: 'eng',
      now: NOW,
    })

    expect(await uow.repos.workspaceSlugHistory.findBySlug('eng', NOW)).toMatchObject({
      workspaceId: WORKSPACE_1,
      slug: 'eng',
    })
    expect(
      await uow.repos.workspaceSlugHistory.findBySlug('eng', new Date(NOW.getTime() + YEAR_MS)),
    ).toBeNull()
    expect(await uow.repos.workspaceSlugHistory.findBySlug('nope', NOW)).toBeNull()

    const later = new Date(NOW.getTime() + 1000)
    await uow.repos.workspaceSlugHistory.record({
      workspaceId: NOPE_WORKSPACE,
      slug: 'eng',
      now: later,
    })
    expect(await uow.repos.workspaceSlugHistory.findBySlug('eng', NOW)).toMatchObject({
      workspaceId: NOPE_WORKSPACE,
      retiredAt: later,
    })
  })
})

describe('createInMemoryUnitOfWork: drafts and locks', () => {
  it('writes a draft once a valid lock is held, and rejects every other case', async () => {
    const uow = createInMemoryUnitOfWork()
    const docId = DOC_1

    const rejectedNoLock = await uow.repos.drafts.write({
      documentId: docId,
      sessionId: 's1',
      expectedVersion: 0,
      ast: {},
      now: NOW,
    })
    expect(rejectedNoLock).toEqual({ ok: false, reason: 'lock_lost', holder: null })

    const acquired = await uow.repos.locks.acquire({
      documentId: docId,
      userId: USER_1,
      sessionId: 's1',
      now: NOW,
    })
    if (!acquired.ok) throw new Error('expected the first acquire to succeed')

    const rivalDeniedWhileActive = await uow.repos.locks.acquire({
      documentId: docId,
      userId: USER_2,
      sessionId: 's2',
      now: NOW,
    })
    expect(rivalDeniedWhileActive).toEqual({ ok: false, reason: 'held', holder: acquired.lock })

    // Re-acquiring with the same session is allowed (idempotent re-acquire / first heartbeat via acquire).
    const reacquired = await uow.repos.locks.acquire({
      documentId: docId,
      userId: USER_1,
      sessionId: 's1',
      now: NOW,
    })
    expect(reacquired.ok).toBe(true)

    const noDraftYet = await uow.repos.drafts.write({
      documentId: docId,
      sessionId: 's1',
      expectedVersion: 0,
      ast: {},
      now: NOW,
    })
    expect(noDraftYet).toEqual({ ok: false, reason: 'not_found' })

    await uow.repos.drafts.init({
      documentId: docId,
      baseRevision: null,
      ast: { text: '' },
      now: NOW,
    })
    expect(await uow.repos.drafts.find(docId)).not.toBeNull()
    expect(await uow.repos.drafts.find(NOPE_DOC)).toBeNull()

    const stale = await uow.repos.drafts.write({
      documentId: docId,
      sessionId: 's1',
      expectedVersion: 1,
      ast: {},
      now: NOW,
    })
    expect(stale).toEqual({ ok: false, reason: 'stale_version', currentVersion: 0 })

    const written = await uow.repos.drafts.write({
      documentId: docId,
      sessionId: 's1',
      expectedVersion: 0,
      ast: { text: 'hi' },
      now: NOW,
    })
    expect(written).toEqual({
      ok: true,
      draft: {
        documentId: docId,
        draftVersion: 1,
        baseRevision: null,
        ast: { text: 'hi' },
        updatedAt: NOW,
      },
    })

    // Heartbeat: success, released, taken over, and expired.
    const heartbeatOk = await uow.repos.locks.heartbeat({
      documentId: docId,
      sessionId: 's1',
      now: NOW,
    })
    expect(heartbeatOk.ok).toBe(true)

    const heartbeatReleased = await uow.repos.locks.heartbeat({
      documentId: NO_LOCK_DOC,
      sessionId: 's1',
      now: NOW,
    })
    expect(heartbeatReleased).toEqual({ ok: false, reason: 'released' })

    const takenOver = await uow.repos.locks.adminTakeover({
      documentId: docId,
      userId: ADMIN_USER,
      sessionId: 'admin-session',
      now: NOW,
    })
    expect(takenOver.ok).toBe(true)

    const heartbeatTakenOver = await uow.repos.locks.heartbeat({
      documentId: docId,
      sessionId: 's1',
      now: NOW,
    })
    expect(heartbeatTakenOver).toEqual({ ok: false, reason: 'taken_over', holder: takenOver.lock })

    const past = new Date(NOW.getTime() + 61_000)
    const heartbeatExpired = await uow.repos.locks.heartbeat({
      documentId: docId,
      sessionId: 'admin-session',
      now: past,
    })
    expect(heartbeatExpired).toMatchObject({ ok: false, reason: 'expired' })

    // Release is unconditional and idempotent (ADR-021): releasing a lock
    // somebody else holds succeeds and deletes nothing.
    const releaseOther = await uow.repos.locks.release({ documentId: docId, sessionId: 's1' })
    expect(releaseOther).toEqual({ ok: true })
    expect(await uow.repos.locks.find(docId)).not.toBeNull()
    const releaseOk = await uow.repos.locks.release({
      documentId: docId,
      sessionId: 'admin-session',
    })
    expect(releaseOk).toEqual({ ok: true })

    expect(await uow.repos.locks.find(docId)).toBeNull()

    // A stale-lock write is rejected as lock_lost even though a lock once existed.
    const staleLockWrite = await uow.repos.drafts.write({
      documentId: docId,
      sessionId: 's1',
      expectedVersion: 1,
      ast: {},
      now: NOW,
    })
    expect(staleLockWrite).toMatchObject({ ok: false, reason: 'lock_lost' })
  })
})

describe('createInMemoryUnitOfWork: grants', () => {
  it('creates, deletes, and lists by scope and by principal', async () => {
    const uow = createInMemoryUnitOfWork()
    const grant = await uow.repos.grants.create({
      id: 'grant-1',
      principalKind: 'user',
      principalId: 'user-1',
      scopeKind: 'workspace',
      scopeId: 'ws-1',
      role: 'admin',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })
    expect(await uow.repos.grants.listForScope('workspace', 'ws-1')).toEqual([grant])
    expect(await uow.repos.grants.listForPrincipal('user', 'user-1')).toEqual([grant])

    await uow.repos.grants.delete('grant-1')
    expect(await uow.repos.grants.listForScope('workspace', 'ws-1')).toEqual([])
  })
})

describe('createInMemoryUnitOfWork: outbox, audit, and run', () => {
  it('records outbox writes and accepts audit writes', async () => {
    const uow = createInMemoryUnitOfWork()
    await expect(
      uow.repos.outbox.write({ id: 'event-1', type: 'DocumentCreated', payload: {}, now: NOW }),
    ).resolves.toBeUndefined()
    expect(uow.events.map((event) => event.type)).toEqual(['DocumentCreated'])
    await expect(
      uow.repos.audit.write({
        id: 'audit-1',
        type: 'GrantChanged',
        actorUserId: null,
        targetType: 'workspace',
        targetId: 'ws-1',
        metadata: {},
        now: NOW,
      }),
    ).resolves.toBeUndefined()
  })

  it('runs a callback against the same repository bundle', async () => {
    const uow = createInMemoryUnitOfWork()
    const user = await uow.run((repos) =>
      repos.users.create({ id: USER_1, email: 'a@example.com', displayName: 'A', now: NOW }),
    )
    expect(await uow.repos.users.findById(user.id)).toEqual(user)
  })
})

describe('createInMemoryUnitOfWork: groups', () => {
  it('expands a membership to the groups it nests inside, once each', async () => {
    const uow = createInMemoryUnitOfWork()
    await uow.repos.groups.create({
      id: 'engineering',
      unitId: 'unit-1',
      parentGroupId: null,
      name: 'Engineering',
      now: NOW,
    })
    await uow.repos.groups.create({
      id: 'platform',
      unitId: 'unit-1',
      parentGroupId: 'engineering',
      name: 'Platform',
      now: NOW,
    })
    expect(await uow.repos.groups.findById('platform')).not.toBeNull()
    expect(await uow.repos.groups.findById('nope')).toBeNull()

    await uow.repos.groups.addMember({ groupId: 'platform', userId: USER_1, now: NOW })
    await uow.repos.groups.addMember({ groupId: 'engineering', userId: USER_1, now: NOW })
    await uow.repos.groups.addMember({ groupId: 'ghost', userId: USER_1, now: NOW })
    expect((await uow.repos.groups.listForUser(USER_1)).map((group) => group.id)).toEqual([
      'platform',
      'engineering',
    ])

    await uow.repos.groups.removeMember({ groupId: 'platform', userId: USER_1 })
    await uow.repos.groups.removeMember({ groupId: 'platform', userId: USER_2 })
    expect((await uow.repos.groups.listForUser(USER_1)).map((group) => group.id)).toEqual([
      'engineering',
    ])
    expect(await uow.repos.groups.listForUser(USER_2)).toEqual([])
  })
})

describe('createInMemoryUnitOfWork: collections', () => {
  it('creates, finds by id and slug, and lists by workspace', async () => {
    const uow = createInMemoryUnitOfWork()
    const collection = await uow.repos.collections.create({
      id: 'collection-1',
      workspaceId: WORKSPACE_1,
      name: 'Architecture',
      slug: 'architecture',
      now: NOW,
    })
    expect(await uow.repos.collections.findById('collection-1')).toEqual(collection)
    expect(await uow.repos.collections.findById('nope')).toBeNull()
    expect(await uow.repos.collections.findBySlug(WORKSPACE_1, 'architecture')).toEqual(collection)
    expect(await uow.repos.collections.findBySlug(WORKSPACE_1, 'nope')).toBeNull()
    expect(await uow.repos.collections.listByWorkspace(WORKSPACE_1)).toEqual([collection])
    expect(await uow.repos.collections.listByWorkspace(NOPE_WORKSPACE)).toEqual([])
  })
})

describe('createInMemoryUnitOfWork: documents by id and by ancestry', () => {
  it('lists the ids it holds and walks parents to the root', async () => {
    const uow = createInMemoryUnitOfWork()
    const base = {
      workspaceId: WORKSPACE_1,
      collectionId: 'collection-1',
      shortId: aShortId(),
      status: 'draft',
      templateId: null,
      templateVersion: null,
      now: NOW,
    } as const
    await uow.repos.documents.create({
      ...base,
      id: DOC_1,
      parentId: null,
      slug: 'parent',
      path: 'c/parent.md',
      title: 'Parent',
    })
    await uow.repos.documents.create({
      ...base,
      id: NO_LOCK_DOC,
      parentId: DOC_1,
      slug: 'child',
      path: 'c/parent/child.md',
      title: 'Child',
    })

    expect((await uow.repos.documents.listByIds([DOC_1, NOPE_DOC])).map((row) => row.id)).toEqual([
      DOC_1,
    ])
    expect((await uow.repos.documents.listAncestors(NO_LOCK_DOC)).map((row) => row.id)).toEqual([
      NO_LOCK_DOC,
      DOC_1,
    ])
    expect(await uow.repos.documents.listAncestors(NOPE_DOC)).toEqual([])
  })
})

describe('createInMemoryUnitOfWork: drafts, grants, revisions, renders, and links', () => {
  it('rebases a draft and reports one that does not exist', async () => {
    const uow = createInMemoryUnitOfWork()
    await uow.repos.drafts.init({ documentId: DOC_1, baseRevision: null, ast: {}, now: NOW })
    const rebased = await uow.repos.drafts.rebase({
      documentId: DOC_1,
      baseRevision: REVISION,
      now: NOW,
    })
    expect(rebased?.baseRevision).toBe(REVISION)
    expect(
      await uow.repos.drafts.rebase({ documentId: NOPE_DOC, baseRevision: null, now: NOW }),
    ).toBeNull()
  })

  it('lists grants for a set of scopes in one call', async () => {
    const uow = createInMemoryUnitOfWork()
    await uow.repos.grants.create({
      id: 'grant-1',
      principalKind: 'user',
      principalId: USER_1,
      scopeKind: 'workspace',
      scopeId: WORKSPACE_1,
      role: 'editor',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })
    await uow.repos.grants.create({
      id: 'grant-2',
      principalKind: 'public',
      principalId: null,
      scopeKind: 'instance',
      scopeId: null,
      role: 'viewer',
      effect: 'allow',
      createdBy: null,
      now: NOW,
    })
    const found = await uow.repos.grants.listForScopes([
      { kind: 'workspace', id: WORKSPACE_1 },
      { kind: 'instance', id: null },
      { kind: 'document', id: DOC_1 },
    ])
    expect(found.map((grant) => grant.id).toSorted()).toEqual(['grant-1', 'grant-2'])
  })

  it('pages revisions newest first from a cursor', async () => {
    const uow = createInMemoryUnitOfWork()
    for (const [index, revision] of [REVISION, OTHER_REVISION].entries()) {
      await uow.repos.revisions.append({
        id: `revision-${index}`,
        documentId: DOC_1,
        workspaceId: WORKSPACE_1,
        revision,
        authorName: 'A',
        authorEmail: 'a@example.com',
        timestamp: NOW,
        summary: 'Summary',
        changeNote: null,
        now: NOW,
      })
    }
    expect((await uow.repos.revisions.latestForDocument(DOC_1))?.id).toBe('revision-1')
    expect(await uow.repos.revisions.latestForDocument(NOPE_DOC)).toBeNull()
    expect(
      (await uow.repos.revisions.listForDocument(DOC_1, { limit: 10 })).map((row) => row.id),
    ).toEqual(['revision-1', 'revision-0'])
    expect(
      (await uow.repos.revisions.listForDocument(DOC_1, { limit: 10, cursor: 'revision-1' })).map(
        (row) => row.id,
      ),
    ).toEqual(['revision-0'])
  })

  it('saves and reads render-cache entries, stamping each read', async () => {
    const uow = createInMemoryUnitOfWork()
    await uow.repos.renderCache.save({
      key: 'hash:1',
      documentId: DOC_1,
      contentHash: 'hash',
      renderVersion: 1,
      content: {
        version: 1,
        html: '<p>Hi</p>',
        outline: [],
        text: { title: undefined, headings: [], body: 'Hi' },
        links: [],
        slots: [],
        incompleteRequiredSections: [],
      },
      now: NOW,
    })
    const later = new Date(NOW.getTime() + 1000)
    expect(await uow.repos.renderCache.find('hash:1', later)).toMatchObject({ lastReadAt: later })
    expect(await uow.repos.renderCache.find('missing:1', later)).toBeNull()
  })

  it('replaces the links of a document and finds what points at one', async () => {
    const uow = createInMemoryUnitOfWork()
    await uow.repos.documentLinks.replaceForDocument({
      documentId: DOC_1,
      links: [
        {
          targetDocumentId: NO_LOCK_DOC,
          url: `/d/${NO_LOCK_DOC}`,
          text: 'Child',
          kind: 'document',
        },
      ],
      idFor: (index) => `link-${index}`,
    })
    expect(await uow.repos.documentLinks.listForDocument(DOC_1)).toEqual([
      {
        id: 'link-0',
        sourceDocumentId: DOC_1,
        targetDocumentId: NO_LOCK_DOC,
        url: `/d/${NO_LOCK_DOC}`,
        text: 'Child',
        kind: 'document',
      },
    ])
    expect(await uow.repos.documentLinks.listForDocument(NOPE_DOC)).toEqual([])
    expect(await uow.repos.documentLinks.listSourcesTargeting(NO_LOCK_DOC)).toEqual([DOC_1])
    expect(await uow.repos.documentLinks.listSourcesTargeting(NOPE_DOC)).toEqual([])
  })
})

/**
 * Two behaviours the fake has to share with the database or a use-case test
 * would disagree with an integration test.
 */
describe('agreeing with the schema', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('releases a session’s locks when the session goes, as the foreign key does', async () => {
    const uow = createInMemoryUnitOfWork()
    const document = documentId('00000000-0000-4000-8000-000000000201')
    await uow.repos.sessions.create({
      id: 'session-1',
      userId: userId('00000000-0000-4000-8000-000000000001'),
      tokenHash: 'hash-1',
      now,
      expiresAt: new Date(now.getTime() + 60_000),
    })
    await uow.repos.locks.acquire({
      documentId: document,
      userId: userId('00000000-0000-4000-8000-000000000001'),
      sessionId: 'session-1',
      now,
    })

    // `document_locks.holder_session_id` cascades on delete (review finding
    // L2), so a signed-out session never leaves a lock nobody can heartbeat.
    await uow.repos.sessions.delete('session-1')
    expect(await uow.repos.locks.find(document)).toBeNull()
  })

  it('throws when renaming a collection that is not there, as the adapter does', async () => {
    const uow = createInMemoryUnitOfWork()
    await expect(uow.repos.collections.rename('nope', 'Anything')).rejects.toThrow(/not found/)
  })
})

describe('agreeing with the schema, continued', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('leaves a lock held by a different session alone', async () => {
    const uow = createInMemoryUnitOfWork()
    const mine = documentId('00000000-0000-4000-8000-000000000211')
    const theirs = documentId('00000000-0000-4000-8000-000000000212')
    for (const id of ['session-1', 'session-2']) {
      await uow.repos.sessions.create({
        id,
        userId: USER_1,
        tokenHash: `hash-${id}`,
        now,
        expiresAt: new Date(now.getTime() + 60_000),
      })
    }
    await uow.repos.locks.acquire({ documentId: mine, userId: USER_1, sessionId: 'session-1', now })
    await uow.repos.locks.acquire({
      documentId: theirs,
      userId: USER_1,
      sessionId: 'session-2',
      now,
    })

    await uow.repos.sessions.delete('session-1')
    expect(await uow.repos.locks.find(mine)).toBeNull()
    expect(await uow.repos.locks.find(theirs)).not.toBeNull()
  })

  it('keeps two collections of the same name in a stable order', async () => {
    // The database holds the *slug* unique, not the name, so equal names are
    // possible and the comparator has to say "equal" rather than guess.
    const uow = createInMemoryUnitOfWork()
    for (const slug of ['first', 'second']) {
      await uow.repos.collections.create({
        id: slug,
        workspaceId: WORKSPACE_1,
        name: 'Same name',
        slug,
        now,
      })
    }
    expect(
      (await uow.repos.collections.listByWorkspace(WORKSPACE_1)).map((row) => row.slug),
    ).toEqual(['first', 'second'])
  })
})
