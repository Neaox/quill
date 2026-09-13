import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { acquireLock, adminTakeover } from './lock.ts'
import { getDraft, initDraft, writeDraft } from './draft.ts'
import { at, ensureSchema, pool, resetTables } from './test-helpers.ts'

beforeAll(async () => {
  await ensureSchema()
})

beforeEach(async () => {
  await resetTables()
})

afterAll(async () => {
  await pool.end()
})

const DOC = 'doc-1'

describe('admin takeover', () => {
  // (d) Admin takeover causes the previous holder's next draft write to be rejected.
  it('rejects the former holder write after an admin seizes an active lock', async () => {
    const t0 = at(0)
    await acquireLock(pool, { documentId: DOC, userId: 'alice', sessionId: 'alice-tab-1', now: t0 })
    await initDraft(pool, { documentId: DOC, baseRevision: 'rev-0', ast: { text: '' }, now: t0 })

    const firstWrite = await writeDraft(pool, {
      documentId: DOC,
      sessionId: 'alice-tab-1',
      expectedVersion: 0,
      ast: { text: 'alice was here' },
      now: new Date(t0.getTime() + 1000),
    })
    expect(firstWrite.ok).toBe(true)

    // Admin takes over a still-active lock (well within the TTL).
    const takeoverAt = new Date(t0.getTime() + 2000)
    const takeover = await adminTakeover(pool, {
      documentId: DOC,
      userId: 'admin-carol',
      sessionId: 'carol-tab-1',
      now: takeoverAt,
    })
    expect(takeover.ok).toBe(true)

    // Alice's next write is rejected, even though she doesn't know yet that she lost the lock.
    const rejectedWrite = await writeDraft(pool, {
      documentId: DOC,
      sessionId: 'alice-tab-1',
      expectedVersion: 1,
      ast: { text: 'alice, still typing' },
      now: new Date(t0.getTime() + 3000),
    })
    expect(rejectedWrite.ok).toBe(false)
    if (!rejectedWrite.ok) {
      expect(rejectedWrite.reason).toBe('lock_lost')
    }

    // The draft was not mutated by the rejected write.
    const draft = await getDraft(pool, DOC)
    expect(draft?.draft_version).toBe(1)

    // The new holder can write normally.
    const carolWrite = await writeDraft(pool, {
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
  // (e) Two tabs of the same user (sharing one session/lock): the tab with a stale
  // draft_version is rejected, independent of lock ownership.
  it('rejects the second tab writing against a version the first tab already advanced', async () => {
    const t0 = at(0)
    const sharedSession = 'alice-session'
    await acquireLock(pool, { documentId: DOC, userId: 'alice', sessionId: sharedSession, now: t0 })
    await initDraft(pool, { documentId: DOC, baseRevision: 'rev-0', ast: { text: '' }, now: t0 })

    // Both tabs read draft_version 0 before either writes.
    const tab1Write = await writeDraft(pool, {
      documentId: DOC,
      sessionId: sharedSession,
      expectedVersion: 0,
      ast: { text: 'from tab 1' },
      now: new Date(t0.getTime() + 1000),
    })
    expect(tab1Write.ok).toBe(true)

    const tab2Write = await writeDraft(pool, {
      documentId: DOC,
      sessionId: sharedSession,
      expectedVersion: 0, // stale — tab 1 already moved the version to 1
      ast: { text: 'from tab 2' },
      now: new Date(t0.getTime() + 1500),
    })
    expect(tab2Write.ok).toBe(false)
    if (!tab2Write.ok) {
      expect(tab2Write.reason).toBe('stale_version')
      if (tab2Write.reason === 'stale_version') {
        expect(tab2Write.currentVersion).toBe(1)
      }
    }

    const draft = await getDraft(pool, DOC)
    expect(draft?.ast).toEqual({ text: 'from tab 1' })
  })

  it('rejects a write against a document with no lock at all', async () => {
    const t0 = at(0)
    await initDraft(pool, { documentId: DOC, baseRevision: 'rev-0', ast: {}, now: t0 })
    const result = await writeDraft(pool, {
      documentId: DOC,
      sessionId: 'nobody',
      expectedVersion: 0,
      ast: { text: 'x' },
      now: t0,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('lock_lost')
    }
  })
})
