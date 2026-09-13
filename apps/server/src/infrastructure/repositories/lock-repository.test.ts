import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { LOCK_HEARTBEAT_MS, LOCK_TTL_MS } from '@quill/application'

import { createLockRepository } from './lock-repository.ts'

/**
 * Ported from the R5 spike (`spikes/r5-draft-locking/src/lock.test.ts` and
 * `race.test.ts`), against the real `document_locks` table instead of the
 * spike's `spike_r5` schema. Scenario letters match
 * `docs/research/r05-draft-locking.md`.
 */
const at = (msFromEpoch: number): Date => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0) + msFromEpoch)

const DOC = documentId('00000000-0000-4000-8000-000000000001')
const ALICE = userId('00000000-0000-4000-8000-0000000000a1')
const BOB = userId('00000000-0000-4000-8000-0000000000b2')

let database: TestDatabase
let locks: ReturnType<typeof createLockRepository>

beforeAll(async () => {
  database = await createTestDatabase()
  locks = createLockRepository(database.pool)
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM document_locks')
  await database.pool.query(
    "INSERT INTO documents (id, short_id, workspace_id, collection_id, parent_id, slug, path, title, status, template_id, template_version, created_at, updated_at) SELECT $1, '0000000001', w.id, NULL, NULL, 'doc', '/doc', 'Doc', 'draft', NULL, NULL, now(), now() FROM workspaces w LIMIT 1 ON CONFLICT (id) DO NOTHING",
    [DOC],
  )
})

async function seedWorkspaceAndUsers(): Promise<void> {
  await database.pool.query(
    "INSERT INTO organisational_units (id, parent_id, name, created_at) VALUES ('unit-1', NULL, 'Unit', now()) ON CONFLICT (id) DO NOTHING",
  )
  await database.pool.query(
    "INSERT INTO workspaces (id, unit_id, name, slug, created_at) VALUES ('workspace-1', 'unit-1', 'Workspace', 'workspace', now()) ON CONFLICT (id) DO NOTHING",
  )
  for (const id of [ALICE, BOB]) {
    await database.pool.query(
      'INSERT INTO users (id, email, display_name, created_at) VALUES ($1, $2, $2, now()) ON CONFLICT (id) DO NOTHING',
      [id, `${id}@example.com`],
    )
  }
}

/**
 * `document_locks.holder_session_id` references `sessions.id` with
 * `ON DELETE CASCADE` (review finding L2), so a lock has to name a session
 * that exists — which is also what makes revoking a session release its
 * locks. The tests name their sessions by hand, so the rows go in by hand.
 */
async function seedSession(id: string, owner: string = ALICE): Promise<void> {
  await database.pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $1, now(), now(), now() + interval '1 day')
     ON CONFLICT (id) DO NOTHING`,
    [id, owner],
  )
}

beforeAll(async () => {
  await seedWorkspaceAndUsers()
  await seedSession('alice-tab-1', ALICE)
  await seedSession('bob-tab-1', BOB)
  await seedSession('someone-else', BOB)
}, 30_000)

describe('expiry', () => {
  // (b) Expiry after 60s without heartbeat allows a new holder.
  it('lets a new holder acquire once the previous lock has expired', async () => {
    const t0 = at(0)
    const first = await locks.acquire({
      documentId: DOC,
      userId: ALICE,
      sessionId: 'alice-tab-1',
      now: t0,
    })
    expect(first.ok).toBe(true)

    const justBeforeExpiry = new Date(t0.getTime() + LOCK_TTL_MS - 1)
    const tooEarly = await locks.acquire({
      documentId: DOC,
      userId: BOB,
      sessionId: 'bob-tab-1',
      now: justBeforeExpiry,
    })
    expect(tooEarly.ok).toBe(false)

    const afterExpiry = new Date(t0.getTime() + LOCK_TTL_MS + 1)
    const second = await locks.acquire({
      documentId: DOC,
      userId: BOB,
      sessionId: 'bob-tab-1',
      now: afterExpiry,
    })
    expect(second).toMatchObject({ ok: true, lock: { holderUserId: BOB } })
  })

  // The expiry boundary is a strict `<` — an exact-millisecond tie is not expired (ADR-021).
  it('does not treat an exact-millisecond tie as expired', async () => {
    const t0 = at(0)
    await locks.acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: t0 })
    const exactExpiry = new Date(t0.getTime() + LOCK_TTL_MS)
    const result = await locks.acquire({
      documentId: DOC,
      userId: BOB,
      sessionId: 'bob-tab-1',
      now: exactExpiry,
    })
    expect(result.ok).toBe(false)
  })
})

describe('heartbeat', () => {
  // (c) Heartbeat every 15s keeps the lock held past the 60s TTL.
  it('keeps the lock alive across many heartbeat-interval ticks', async () => {
    const t0 = at(0)
    expect(
      (await locks.acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: t0 }))
        .ok,
    ).toBe(true)

    for (let tick = 1; tick <= 20; tick += 1) {
      const now = new Date(t0.getTime() + tick * LOCK_HEARTBEAT_MS)
      const result = await locks.heartbeat({ documentId: DOC, sessionId: 'alice-tab-1', now })
      expect(result.ok, `heartbeat tick ${tick} should succeed`).toBe(true)
    }

    const shortlyAfter = new Date(t0.getTime() + 20 * LOCK_HEARTBEAT_MS + 1000)
    const rival = await locks.acquire({
      documentId: DOC,
      userId: BOB,
      sessionId: 'bob-tab-1',
      now: shortlyAfter,
    })
    expect(rival.ok).toBe(false)
  })

  // (g) A client that stops heartbeating past expiry, then resumes, must be told it lost the lock.
  it('reports loss to a client that resumes heartbeating after expiry', async () => {
    const t0 = at(0)
    await locks.acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: t0 })

    const resumedAfterPartition = new Date(t0.getTime() + LOCK_TTL_MS + 5_000)
    const result = await locks.heartbeat({
      documentId: DOC,
      sessionId: 'alice-tab-1',
      now: resumedAfterPartition,
    })
    expect(result).toMatchObject({ ok: false, reason: 'expired' })

    const tookOverAt = new Date(t0.getTime() + LOCK_TTL_MS + 6_000)
    await locks.acquire({ documentId: DOC, userId: BOB, sessionId: 'bob-tab-1', now: tookOverAt })

    const laterHeartbeat = await locks.heartbeat({
      documentId: DOC,
      sessionId: 'alice-tab-1',
      now: new Date(tookOverAt.getTime() + 1000),
    })
    expect(laterHeartbeat).toMatchObject({ ok: false, reason: 'taken_over' })
  })

  it('reports "released" once the lock row is gone', async () => {
    const t0 = at(0)
    await locks.acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: t0 })
    await locks.release({ documentId: DOC, sessionId: 'alice-tab-1' })
    const result = await locks.heartbeat({ documentId: DOC, sessionId: 'alice-tab-1', now: t0 })
    expect(result).toEqual({ ok: false, reason: 'released' })
  })
})

describe('release', () => {
  // (f) Release frees the lock immediately — no need to wait for expiry.
  it('lets another client acquire immediately after release, with no elapsed time', async () => {
    const t0 = at(0)
    await locks.acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: t0 })
    expect((await locks.release({ documentId: DOC, sessionId: 'alice-tab-1' })).ok).toBe(true)
    const immediate = await locks.acquire({
      documentId: DOC,
      userId: BOB,
      sessionId: 'bob-tab-1',
      now: t0,
    })
    expect(immediate.ok).toBe(true)
  })

  it('succeeds whoever asks, and takes no other session lock away', async () => {
    const t0 = at(0)
    await locks.acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: t0 })

    // Release is unconditional: it is the beacon target on navigation and a
    // beacon cannot read a response (ADR-021). What it must not do is release
    // a lock this session does not hold.
    expect(await locks.release({ documentId: DOC, sessionId: 'someone-else' })).toEqual({
      ok: true,
    })
    expect((await locks.find(DOC))?.holderSessionId).toBe('alice-tab-1')

    expect(await locks.release({ documentId: DOC, sessionId: 'alice-tab-1' })).toEqual({ ok: true })
    expect(await locks.find(DOC)).toBeNull()
  })
})

describe('admin takeover', () => {
  it('unconditionally seizes an active lock', async () => {
    const t0 = at(0)
    await locks.acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: t0 })
    const takeover = await locks.adminTakeover({
      documentId: DOC,
      userId: BOB,
      sessionId: 'bob-tab-1',
      now: t0,
    })
    expect(takeover.ok).toBe(true)
    expect(takeover.lock.holderUserId).toBe(BOB)
  })
})

describe('find', () => {
  it('returns null when no lock exists', async () => {
    expect(await locks.find(DOC)).toBeNull()
  })

  it('returns the current lock', async () => {
    const t0 = at(0)
    await locks.acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: t0 })
    expect((await locks.find(DOC))?.holderUserId).toBe(ALICE)
  })
})

describe('concurrent acquire race', () => {
  // (a) N-way concurrent acquire against the same document always has exactly one winner —
  // the property the ADR-021 INSERT ... ON CONFLICT DO UPDATE ... WHERE is meant to guarantee.
  const ITERATIONS = 20
  const CONCURRENCY = 20

  it(`has exactly one winner in ${ITERATIONS} iterations of ${CONCURRENCY}-way concurrent acquires`, async () => {
    const now = at(0)
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const raceDocId = documentId(
        `00000000-0000-4000-9000-${(iteration + 1).toString(16).padStart(12, '0')}`,
      )
      await database.pool.query(
        "INSERT INTO documents (id, short_id, workspace_id, collection_id, parent_id, slug, path, title, status, template_id, template_version, created_at, updated_at) VALUES ($1, substr(md5(random()::text), 1, 10), 'workspace-1', NULL, NULL, $2, $2, 'Doc', 'draft', NULL, NULL, now(), now())",
        [raceDocId, `race-${iteration}`],
      )
      await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) => seedSession(`session-${iteration}-${i}`)),
      )
      const attempts = Array.from({ length: CONCURRENCY }, (_, i) =>
        locks.acquire({
          documentId: raceDocId,
          userId: ALICE,
          sessionId: `session-${iteration}-${i}`,
          now,
        }),
      )
      const results = await Promise.all(attempts)
      const winners = results.filter((r) => r.ok)
      expect(winners, `iteration ${iteration} winners`).toHaveLength(1)

      const losers = results.filter((r) => !r.ok)
      expect(losers).toHaveLength(CONCURRENCY - 1)
      for (const loser of losers) {
        expect(loser).toMatchObject({ ok: false, reason: 'held' })
      }
    }
  }, 60_000)
})

/**
 * Review finding L8. The conditional upsert matching nothing usually means
 * somebody holds the lock — but it can also mean a concurrent release deleted
 * the row between the upsert and the read, and answering 500 for a document
 * that is, at that instant, free is the wrong answer.
 */
/** A pool whose upsert never matches and whose holder read never finds a row. */
function alwaysRacing(): { query: () => Promise<{ rowCount: number; rows: [] }> } {
  return {
    async query(): Promise<{ rowCount: number; rows: [] }> {
      return { rowCount: 0, rows: [] }
    },
  }
}

describe('acquire racing a release', () => {
  it('retries, and fails loudly only when every attempt raced', async () => {
    const racing = createLockRepository(
      alwaysRacing() as unknown as Parameters<typeof createLockRepository>[0],
    )
    await expect(
      racing.acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: at(0) }),
    ).rejects.toThrow(/released under every one of 3 attempts/)
  })

  it('wins on the retry when the document really was free', async () => {
    let attempts = 0
    const lock = {
      document_id: DOC,
      holder_user_id: ALICE,
      holder_session_id: 'alice-tab-1',
      acquired_at: at(0),
      last_heartbeat_at: at(0),
      expires_at: at(60_000),
    }
    const flaky = {
      async query(text: string): Promise<{ rowCount: number; rows: unknown[] }> {
        if (text.includes('INSERT INTO document_locks')) {
          attempts += 1
          return attempts === 1 ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [lock] }
        }
        return { rowCount: 0, rows: [] }
      },
    }

    const result = await createLockRepository(
      flaky as unknown as Parameters<typeof createLockRepository>[0],
    ).acquire({ documentId: DOC, userId: ALICE, sessionId: 'alice-tab-1', now: at(0) })
    expect(result.ok).toBe(true)
    expect(attempts).toBe(2)
  })
})
