import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createDraftRepository } from './draft-repository.ts'
import { createLockRepository } from './lock-repository.ts'

/** Ported from the R5 spike (`spikes/r5-draft-locking/src/draft.test.ts`). */
const at = (msFromEpoch: number): Date => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0) + msFromEpoch)

const DOC = documentId('00000000-0000-4000-8000-0000000000d1')
const ALICE = userId('00000000-0000-4000-8000-0000000000a1')
const CAROL = userId('00000000-0000-4000-8000-0000000000c1')

let database: TestDatabase
let drafts: ReturnType<typeof createDraftRepository>
let locks: ReturnType<typeof createLockRepository>

beforeAll(async () => {
  database = await createTestDatabase()
  drafts = createDraftRepository(database.db, database.pool)
  locks = createLockRepository(database.pool)

  await database.pool.query(
    "INSERT INTO organisational_units (id, parent_id, name, created_at) VALUES ('unit-1', NULL, 'Unit', now())",
  )
  await database.pool.query(
    "INSERT INTO workspaces (id, unit_id, name, slug, created_at) VALUES ('workspace-1', 'unit-1', 'Workspace', 'workspace', now())",
  )
  for (const id of [ALICE, CAROL]) {
    await database.pool.query(
      'INSERT INTO users (id, email, display_name, created_at) VALUES ($1, $2, $2, now())',
      [id, `${id}@example.com`],
    )
  }
  // A lock names a session, and the foreign key added for review finding L2
  // means that session has to exist — which is what releases a lock when its
  // session is revoked.
  for (const [id, owner] of [
    ['alice-tab-1', ALICE],
    ['alice-session', ALICE],
    ['carol-tab-1', CAROL],
    ['nobody', CAROL],
  ] as const) {
    await database.pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $1, now(), now(), now() + interval '1 day')`,
      [id, owner],
    )
  }
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM drafts')
  await database.pool.query('DELETE FROM document_locks')
  await database.pool.query('DELETE FROM documents')
  await database.pool.query(
    "INSERT INTO documents (id, short_id, workspace_id, collection_id, parent_id, slug, path, title, status, template_id, template_version, created_at, updated_at) VALUES ($1, '0000000001', 'workspace-1', NULL, NULL, 'doc', '/doc', 'Doc', 'draft', NULL, NULL, now(), now())",
    [DOC],
  )
})

describe('admin takeover', () => {
  it('rejects the former holder write after an admin seizes an active lock', async () => {
    const t0 = at(0)
    await locks.acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: t0 })
    await drafts.init({ documentId: DOC, baseRevision: null, ast: { text: '' }, now: t0 })

    const firstWrite = await drafts.write({
      documentId: DOC,
      sessionId: 'alice-tab-1',
      expectedVersion: 0,
      ast: { text: 'alice was here' },
      now: new Date(t0.getTime() + 1000),
    })
    expect(firstWrite.ok).toBe(true)

    const takeoverAt = new Date(t0.getTime() + 2000)
    const takeover = await locks.adminTakeover({
      documentId: DOC,
      userId: CAROL,
      sessionId: 'carol-tab-1',
      now: takeoverAt,
    })
    expect(takeover.ok).toBe(true)

    const rejectedWrite = await drafts.write({
      documentId: DOC,
      sessionId: 'alice-tab-1',
      expectedVersion: 1,
      ast: { text: 'alice, still typing' },
      now: new Date(t0.getTime() + 3000),
    })
    expect(rejectedWrite).toMatchObject({ ok: false, reason: 'lock_lost' })

    const draft = await drafts.find(DOC)
    expect(draft?.draftVersion).toBe(1)

    const carolWrite = await drafts.write({
      documentId: DOC,
      sessionId: 'carol-tab-1',
      expectedVersion: 1,
      ast: { text: 'carol takes over' },
      now: new Date(t0.getTime() + 4000),
    })
    expect(carolWrite.ok).toBe(true)
  })
})

describe('optimistic draft versions', () => {
  it('rejects the second tab writing against a version the first tab already advanced', async () => {
    const t0 = at(0)
    const sharedSession = 'alice-session'
    await locks.acquire({ documentId: DOC, userId: ALICE, sessionId: sharedSession, now: t0 })
    await drafts.init({ documentId: DOC, baseRevision: null, ast: { text: '' }, now: t0 })

    const tab1Write = await drafts.write({
      documentId: DOC,
      sessionId: sharedSession,
      expectedVersion: 0,
      ast: { text: 'from tab 1' },
      now: new Date(t0.getTime() + 1000),
    })
    expect(tab1Write.ok).toBe(true)

    const tab2Write = await drafts.write({
      documentId: DOC,
      sessionId: sharedSession,
      expectedVersion: 0,
      ast: { text: 'from tab 2' },
      now: new Date(t0.getTime() + 1500),
    })
    expect(tab2Write).toEqual({ ok: false, reason: 'stale_version', currentVersion: 1 })

    const draft = await drafts.find(DOC)
    expect(draft?.ast).toEqual({ text: 'from tab 1' })
  })

  it('rejects a write against a document with no lock at all', async () => {
    const t0 = at(0)
    await drafts.init({ documentId: DOC, baseRevision: null, ast: {}, now: t0 })
    const result = await drafts.write({
      documentId: DOC,
      sessionId: 'nobody',
      expectedVersion: 0,
      ast: { text: 'x' },
      now: t0,
    })
    expect(result).toEqual({ ok: false, reason: 'lock_lost', holder: null })
  })

  it('reports not_found when the lock is valid but no draft row exists yet', async () => {
    const t0 = at(0)
    await locks.acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: t0 })
    const result = await drafts.write({
      documentId: DOC,
      sessionId: 'alice-tab-1',
      expectedVersion: 0,
      ast: {},
      now: t0,
    })
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('find', () => {
  it('returns null when no draft exists', async () => {
    expect(await drafts.find(DOC)).toBeNull()
  })
})

describe('write error handling', () => {
  it('rolls back and rethrows when the query itself fails (e.g. an unserialisable ast)', async () => {
    const t0 = at(0)
    await locks.acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: t0 })
    await drafts.init({ documentId: DOC, baseRevision: null, ast: {}, now: t0 })

    const circular: Record<string, unknown> = {}
    circular['self'] = circular

    await expect(
      drafts.write({
        documentId: DOC,
        sessionId: 'alice-tab-1',
        expectedVersion: 0,
        ast: circular,
        now: t0,
      }),
    ).rejects.toThrow('circular structure')

    // The transaction rolled back: the draft is untouched.
    const draft = await drafts.find(DOC)
    expect(draft?.draftVersion).toBe(0)
  })
})
