import type pg from 'pg'

import type {
  AcquireLockResult,
  DocumentLockRow,
  HeartbeatResult,
  LockRepository,
  ReleaseLockResult,
  SessionId,
  TakeoverResult,
} from '@quill/application'
import { LOCK_TTL_MS } from '@quill/application'
import type { DocumentId, UserId } from '@quill/domain'

import { requireRow } from '../db/rows.ts'

/**
 * How many times acquire will re-run its upsert when the row it was about to
 * report as the holder has just been deleted. Two is enough for a race that
 * needs a release to land inside a window of microseconds; the third is
 * there so the loop is obviously not a coin flip.
 */
const ACQUIRE_ATTEMPTS = 3

interface LockRow {
  document_id: string
  holder_user_id: string
  holder_session_id: string
  acquired_at: Date
  last_heartbeat_at: Date
  expires_at: Date
}

function toDocumentLockRow(row: LockRow): DocumentLockRow {
  return {
    documentId: row.document_id as DocumentId,
    holderUserId: row.holder_user_id as UserId,
    holderSessionId: row.holder_session_id as SessionId,
    acquiredAt: row.acquired_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    expiresAt: row.expires_at,
  }
}

/**
 * Drizzle/`pg` implementation of `LockRepository`, ported from the R5 spike
 * (`spikes/r5-draft-locking/src/lock.ts`) with the tables and identifier
 * types this package uses. The SQL is unchanged from the validated spike:
 * a single `INSERT ... ON CONFLICT DO UPDATE ... WHERE` for acquire, a
 * heartbeat that fails closed on independent expiry, an idempotent delete
 * for release, and an unconditional upsert for admin takeover. See
 * `docs/research/r05-draft-locking.md` for why each of these matters.
 */
export function createLockRepository(pool: pg.Pool): LockRepository {
  return {
    async acquire({ documentId, userId, sessionId, now }): Promise<AcquireLockResult> {
      const expiresAt = new Date(now.getTime() + LOCK_TTL_MS)

      // The conditional upsert can match nothing for two reasons: somebody
      // else holds a live lock, or — rarely — the row was deleted by a
      // concurrent release between the upsert and the read of the holder.
      // Treating the second as the first used to mean `requireRow` threw and
      // the caller got a 500 for a document that was, at that instant,
      // available (review finding L8). So the pair is retried: on the second
      // pass the document is free and the upsert simply wins.
      for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt += 1) {
        const result = await pool.query<LockRow>(
          `INSERT INTO document_locks
             (document_id, holder_user_id, holder_session_id, acquired_at, last_heartbeat_at, expires_at)
           VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz, $5::timestamptz)
           ON CONFLICT (document_id) DO UPDATE SET
             holder_user_id    = EXCLUDED.holder_user_id,
             holder_session_id = EXCLUDED.holder_session_id,
             acquired_at       = EXCLUDED.acquired_at,
             last_heartbeat_at = EXCLUDED.last_heartbeat_at,
             expires_at        = EXCLUDED.expires_at
           WHERE document_locks.expires_at < $4::timestamptz
              OR document_locks.holder_session_id = $3
           RETURNING *`,
          [documentId, userId, sessionId, now, expiresAt],
        )

        if (result.rowCount === 1) {
          return {
            ok: true,
            lock: toDocumentLockRow(
              requireRow(result.rows[0], 'acquire: expected the upserted row back'),
            ),
          }
        }

        const current = await pool.query<LockRow>(
          'SELECT * FROM document_locks WHERE document_id = $1',
          [documentId],
        )
        const holder = current.rows[0]
        if (holder !== undefined) {
          return { ok: false, reason: 'held', holder: toDocumentLockRow(holder) }
        }
      }

      // Every attempt raced a release. Answering "held" would be a lie and
      // there is no row to name a holder with, so this is the one outcome
      // that is genuinely a server fault.
      throw new Error(
        `acquire: the lock on ${documentId} was released under every one of ${ACQUIRE_ATTEMPTS} attempts`,
      )
    },

    async heartbeat({ documentId, sessionId, now }): Promise<HeartbeatResult> {
      const expiresAt = new Date(now.getTime() + LOCK_TTL_MS)
      const result = await pool.query<LockRow>(
        `UPDATE document_locks
         SET last_heartbeat_at = $2::timestamptz, expires_at = $3::timestamptz
         WHERE document_id = $1 AND holder_session_id = $4 AND expires_at >= $2::timestamptz
         RETURNING *`,
        [documentId, now, expiresAt, sessionId],
      )

      if (result.rowCount === 1) {
        return {
          ok: true,
          lock: toDocumentLockRow(
            requireRow(result.rows[0], 'heartbeat: expected the updated row back'),
          ),
        }
      }

      const current = await pool.query<LockRow>(
        'SELECT * FROM document_locks WHERE document_id = $1',
        [documentId],
      )
      const holderRow = current.rows[0]
      if (holderRow === undefined) {
        return { ok: false, reason: 'released' }
      }
      const holder = toDocumentLockRow(holderRow)
      if (holder.holderSessionId !== sessionId) {
        return { ok: false, reason: 'taken_over', holder }
      }
      return { ok: false, reason: 'expired', holder }
    },

    async release({ documentId, sessionId }): Promise<ReleaseLockResult> {
      // Unconditional and idempotent: releasing a lock this session does not
      // hold deletes nothing and still succeeds, because release is the
      // beacon target on navigation and a beacon cannot read a response
      // (ADR-021).
      await pool.query(
        'DELETE FROM document_locks WHERE document_id = $1 AND holder_session_id = $2',
        [documentId, sessionId],
      )
      return { ok: true }
    },

    async adminTakeover({ documentId, userId, sessionId, now }): Promise<TakeoverResult> {
      const expiresAt = new Date(now.getTime() + LOCK_TTL_MS)
      const result = await pool.query<LockRow>(
        `INSERT INTO document_locks
           (document_id, holder_user_id, holder_session_id, acquired_at, last_heartbeat_at, expires_at)
         VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (document_id) DO UPDATE SET
           holder_user_id    = EXCLUDED.holder_user_id,
           holder_session_id = EXCLUDED.holder_session_id,
           acquired_at       = EXCLUDED.acquired_at,
           last_heartbeat_at = EXCLUDED.last_heartbeat_at,
           expires_at        = EXCLUDED.expires_at
         RETURNING *`,
        [documentId, userId, sessionId, now, expiresAt],
      )
      return {
        ok: true,
        lock: toDocumentLockRow(
          requireRow(result.rows[0], 'adminTakeover: expected the upserted row back'),
        ),
      }
    },

    async find(documentId: DocumentId): Promise<DocumentLockRow | null> {
      const result = await pool.query<LockRow>(
        'SELECT * FROM document_locks WHERE document_id = $1',
        [documentId],
      )
      const row = result.rows[0]
      return row === undefined ? null : toDocumentLockRow(row)
    },
  }
}
