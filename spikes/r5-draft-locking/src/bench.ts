/**
 * Latency benchmark: acquire / heartbeat / write, each measured under 100 concurrent
 * simulated editors working on 100 *different* documents (no lock contention — this
 * measures steady-state cost against local Postgres, not the race).
 *
 * Run with: node src/bench.ts
 */
import { createPool, setupSchema, dropSchema } from './db.ts'
import { acquireLock } from './lock.ts'
import { heartbeat } from './lock.ts'
import { initDraft, writeDraft } from './draft.ts'

const EDITORS = 100

function percentile(sortedMs: number[], p: number): number {
  const index = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1)
  return sortedMs[Math.max(0, index)]
}

function report(label: string, samplesMs: number[]): void {
  const sorted = [...samplesMs].sort((a, b) => a - b)
  const p50 = percentile(sorted, 50)
  const p95 = percentile(sorted, 95)
  const p99 = percentile(sorted, 99)
  const max = sorted[sorted.length - 1]
  console.log(
    `${label.padEnd(24)} n=${sorted.length.toString().padEnd(5)} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms max=${max.toFixed(2)}ms`,
  )
}

async function timeAll<T>(fns: Array<() => Promise<T>>): Promise<number[]> {
  const timings = await Promise.all(
    fns.map(async (fn) => {
      const start = performance.now()
      await fn()
      return performance.now() - start
    }),
  )
  return timings
}

async function main(): Promise<void> {
  const poolMax = Number(process.env.SPIKE_R5_POOL_MAX ?? 20)
  const pool = createPool(poolMax)
  console.log(`pool max connections = ${poolMax}`)
  await setupSchema(pool)

  const documentIds = Array.from({ length: EDITORS }, (_, i) => `bench-doc-${i}`)
  const sessionIds = documentIds.map((_, i) => `bench-session-${i}`)

  // Warm the pool up to `poolMax` physical connections before measuring. Opening a fresh
  // Postgres backend process is expensive (tens to hundreds of ms); a long-lived server
  // pays that cost once at startup, not on the hot path, so steady-state latency is what
  // we care about here.
  await Promise.all(Array.from({ length: poolMax }, () => pool.query('SELECT 1')))

  // --- acquire: 100 editors, each acquiring the lock on their own document ---
  const acquireTimings = await timeAll(
    documentIds.map((documentId, i) => async () => {
      const result = await acquireLock(pool, {
        documentId,
        userId: `bench-user-${i}`,
        sessionId: sessionIds[i],
        now: new Date(),
      })
      if (!result.ok) throw new Error(`acquire failed for ${documentId}`)
    }),
  )
  report('acquire (100 concurrent)', acquireTimings)

  // seed a draft row per document so writes have something to update
  await Promise.all(
    documentIds.map((documentId) =>
      initDraft(pool, { documentId, baseRevision: 'rev-0', ast: { text: '' }, now: new Date() }),
    ),
  )

  // --- heartbeat: same 100 editors, one heartbeat each ---
  const heartbeatTimings = await timeAll(
    documentIds.map((documentId, i) => async () => {
      const result = await heartbeat(pool, {
        documentId,
        sessionId: sessionIds[i],
        now: new Date(),
      })
      if (!result.ok) throw new Error(`heartbeat failed for ${documentId}`)
    }),
  )
  report('heartbeat (100 concurrent)', heartbeatTimings)

  // --- write: same 100 editors, one optimistic draft write each (version 0 -> 1) ---
  const writeTimings = await timeAll(
    documentIds.map((documentId, i) => async () => {
      const result = await writeDraft(pool, {
        documentId,
        sessionId: sessionIds[i],
        expectedVersion: 0,
        ast: { text: `hello from editor ${i}` },
        now: new Date(),
      })
      if (!result.ok) throw new Error(`write failed for ${documentId}: ${result.reason}`)
    }),
  )
  report('write (100 concurrent)', writeTimings)

  await dropSchema(pool)
  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
