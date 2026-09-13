import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { acquireLock } from './lock.ts'
import { at, ensureSchema, pool, resetTables } from './test-helpers.ts'

// (a) Two-plus clients racing to acquire the same lock: 50 iterations of 20 simultaneous
// acquire attempts against the same document, each must have exactly one winner. This is
// the property the ADR-021 `INSERT ... ON CONFLICT DO UPDATE ... WHERE` is meant to guarantee.

const ITERATIONS = 50
const CONCURRENCY = 20

beforeAll(async () => {
  await ensureSchema()
})

beforeEach(async () => {
  await resetTables()
})

afterAll(async () => {
  await pool.end()
})

describe('concurrent acquire race', () => {
  it(`has exactly one winner in ${ITERATIONS} iterations of ${CONCURRENCY}-way concurrent acquires`, async () => {
    const now = at(0)
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const documentId = `race-doc-${iteration}`
      const attempts = Array.from({ length: CONCURRENCY }, (_, i) =>
        acquireLock(pool, {
          documentId,
          userId: `user-${i}`,
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
        if (!loser.ok) {
          expect(loser.reason).toBe('held')
          expect(loser.holder.holder_session_id).toBe(
            (winners[0] as { ok: true; lock: { holder_session_id: string } }).lock
              .holder_session_id,
          )
        }
      }
    }
  }, 60_000)
})
