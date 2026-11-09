import type pg from 'pg'

import type { SourceSyncLock } from '@quill/application'
import type { WorkspaceId } from '@quill/domain'

/**
 * One sync per source at a time, across every process (ADR-061), as a
 * Postgres session-level advisory lock.
 *
 * The lock is held on a connection of its own for the whole sync, and is
 * released when the work ends or, if the process dies, when Postgres closes
 * the session: a crashed sync never leaves its source locked. The sync's own
 * transactions use other connections.
 *
 * The key is the pair `(SOURCE_SYNC_LOCK_SPACE, hashtext(workspace id))`.
 * The two-key form is its own key space, apart from the single-key locks the
 * migrator takes. Two workspaces whose ids hash alike would wait on each
 * other, which costs a deferred sync and never a wrong one.
 *
 * A `scope` keys the locks of one database schema apart from another's, for
 * test suites that share a database a schema each: their workspaces share
 * ids, and would otherwise wait on each other.
 */

/** "QSNC" read as a 32-bit integer: the key space of source sync locks. */
export const SOURCE_SYNC_LOCK_SPACE = 0x51_53_4e_43

export function createPostgresSourceSyncLock(
  pool: pg.Pool,
  options: { readonly scope?: string } = {},
): SourceSyncLock {
  const keyOf = (workspaceId: WorkspaceId): string =>
    options.scope === undefined ? workspaceId : `${options.scope}:${workspaceId}`
  return {
    async withLock(workspaceId: WorkspaceId, work) {
      const key = keyOf(workspaceId)
      const client = await pool.connect()
      let broken: Error | undefined
      try {
        const { rows } = await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked',
          [SOURCE_SYNC_LOCK_SPACE, key],
        )
        if (rows[0]?.locked !== true) return { kind: 'busy' as const }
        try {
          return { kind: 'ran' as const, value: await work() }
        } finally {
          await client
            .query('SELECT pg_advisory_unlock($1, hashtext($2))', [SOURCE_SYNC_LOCK_SPACE, key])
            .catch((error: unknown) => {
              // The session is suspect: it is closed rather than returned to
              // the pool, and closing it releases the lock.
              broken = error instanceof Error ? error : new Error(String(error))
            })
        }
      } finally {
        client.release(broken)
      }
    },
  }
}
