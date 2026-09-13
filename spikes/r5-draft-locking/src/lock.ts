import type pg from 'pg'
import type {
  AcquireResult,
  HeartbeatResult,
  LockRow,
  ReleaseResult,
  TakeoverResult,
} from './types.ts'

/** Lock lifetime: no heartbeat within this window and the lock is stale (ADR-021). */
export const LOCK_TTL_MS = 60_000

/** Recommended client heartbeat interval (ADR-021). */
export const HEARTBEAT_INTERVAL_MS = 15_000

interface AcquireArgs {
  documentId: string
  userId: string
  sessionId: string
  /** Injected clock — never `new Date()` inside this module. Lets tests be deterministic. */
  now: Date
}

/**
 * Single INSERT ... ON CONFLICT DO UPDATE ... WHERE, exactly as specified in ADR-021.
 * Wins if: no row exists yet, the existing row is expired, or the caller already holds it
 * (which makes this double as an idempotent re-acquire / first heartbeat).
 * `now` is bound as a plain parameter — never `now()` — so a fake clock drives the SQL directly.
 */
export async function acquireLock(pool: pg.Pool, args: AcquireArgs): Promise<AcquireResult> {
  const { documentId, userId, sessionId, now } = args
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS)

  const result = await pool.query<LockRow>(
    `INSERT INTO spike_r5.document_lock
       (document_id, holder_user_id, holder_session_id, acquired_at, last_heartbeat_at, expires_at)
     VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz, $5::timestamptz)
     ON CONFLICT (document_id) DO UPDATE SET
       holder_user_id    = EXCLUDED.holder_user_id,
       holder_session_id = EXCLUDED.holder_session_id,
       acquired_at       = EXCLUDED.acquired_at,
       last_heartbeat_at = EXCLUDED.last_heartbeat_at,
       expires_at        = EXCLUDED.expires_at
     WHERE spike_r5.document_lock.expires_at < $4::timestamptz
        OR spike_r5.document_lock.holder_session_id = $3
     RETURNING *`,
    [documentId, userId, sessionId, now, expiresAt],
  )

  if (result.rowCount === 1) {
    return { ok: true, lock: result.rows[0] }
  }

  const current = await pool.query<LockRow>(
    'SELECT * FROM spike_r5.document_lock WHERE document_id = $1',
    [documentId],
  )
  return { ok: false, reason: 'held', holder: current.rows[0] }
}

interface HeartbeatArgs {
  documentId: string
  sessionId: string
  now: Date
}

/**
 * Extends expiry for the current holder. Fails closed: if the row expired (even if nobody
 * has taken it over yet), or somebody else now holds it, or the lock is gone, the caller
 * is told explicitly rather than the heartbeat silently doing nothing.
 */
export async function heartbeat(pool: pg.Pool, args: HeartbeatArgs): Promise<HeartbeatResult> {
  const { documentId, sessionId, now } = args
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS)

  const result = await pool.query<LockRow>(
    `UPDATE spike_r5.document_lock
     SET last_heartbeat_at = $2::timestamptz, expires_at = $3::timestamptz
     WHERE document_id = $1 AND holder_session_id = $4 AND expires_at >= $2::timestamptz
     RETURNING *`,
    [documentId, now, expiresAt, sessionId],
  )

  if (result.rowCount === 1) {
    return { ok: true, lock: result.rows[0] }
  }

  const current = await pool.query<LockRow>(
    'SELECT * FROM spike_r5.document_lock WHERE document_id = $1',
    [documentId],
  )
  if (current.rowCount === 0) {
    return { ok: false, reason: 'released' }
  }
  const holder = current.rows[0]
  if (holder.holder_session_id !== sessionId) {
    return { ok: false, reason: 'taken_over', holder }
  }
  return { ok: false, reason: 'expired', holder }
}

interface ReleaseArgs {
  documentId: string
  sessionId: string
}

/** Deletes the row outright — release frees the lock immediately, nothing sweeps later. */
export async function releaseLock(pool: pg.Pool, args: ReleaseArgs): Promise<ReleaseResult> {
  const result = await pool.query(
    'DELETE FROM spike_r5.document_lock WHERE document_id = $1 AND holder_session_id = $2',
    [args.documentId, args.sessionId],
  )
  return result.rowCount === 1 ? { ok: true } : { ok: false, reason: 'not_holder' }
}

interface TakeoverArgs {
  documentId: string
  userId: string
  sessionId: string
  now: Date
}

/**
 * Unconditional upsert — no WHERE clause. Used only for admin takeover, which per ADR-021
 * may seize an *active* lock, not just an expired one. The previous holder's next
 * heartbeat/write will observe `taken_over` / `lock_lost`.
 */
export async function adminTakeover(pool: pg.Pool, args: TakeoverArgs): Promise<TakeoverResult> {
  const { documentId, userId, sessionId, now } = args
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS)

  const result = await pool.query<LockRow>(
    `INSERT INTO spike_r5.document_lock
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
  return { ok: true, lock: result.rows[0] }
}

/**
 * Editor takeover of an *expired* lock is just acquireLock — the WHERE clause in the
 * acquire query already permits overwriting an expired row. Exported under this name so
 * call sites read as ADR-021 describes them (two distinct actions, one shared mechanism).
 */
export const editorTakeoverOfExpiredLock = acquireLock
