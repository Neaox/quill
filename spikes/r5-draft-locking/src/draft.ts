import type pg from 'pg'
import type { DraftRow, LockRow, WriteDraftResult } from './types.ts'

interface InitDraftArgs {
  documentId: string
  baseRevision: string | null
  ast: unknown
  now: Date
}

/** Creates the initial draft row for a document (draft_version starts at 0). */
export async function initDraft(pool: pg.Pool, args: InitDraftArgs): Promise<DraftRow> {
  const result = await pool.query<DraftRow>(
    `INSERT INTO spike_r5.draft (document_id, draft_version, base_revision, ast, updated_at)
     VALUES ($1, 0, $2, $3::jsonb, $4::timestamptz)
     RETURNING *`,
    [args.documentId, args.baseRevision, JSON.stringify(args.ast), args.now],
  )
  return result.rows[0]
}

export async function getDraft(pool: pg.Pool, documentId: string): Promise<DraftRow | null> {
  const result = await pool.query<DraftRow>('SELECT * FROM spike_r5.draft WHERE document_id = $1', [
    documentId,
  ])
  return result.rows[0] ?? null
}

interface WriteDraftArgs {
  documentId: string
  sessionId: string
  expectedVersion: number
  ast: unknown
  now: Date
}

/**
 * Optimistic draft write, gated by lock ownership.
 *
 * Runs as one transaction with `SELECT ... FOR UPDATE` on the lock row so a concurrent
 * takeover cannot interleave between the ownership check and the version check. Two
 * independent rejections are possible and reported distinctly, matching the client
 * recovery contract in the write-up:
 *   - `lock_lost`: caller's session no longer holds a valid lock (expired, released, or
 *     taken over by someone else) — the client must stop and surface the recovery flow.
 *   - `stale_version`: caller holds the lock fine, but another write (e.g. the other tab
 *     of the same user) landed first — the client should re-read and retry.
 */
export async function writeDraft(pool: pg.Pool, args: WriteDraftArgs): Promise<WriteDraftResult> {
  const { documentId, sessionId, expectedVersion, ast, now } = args
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const lockResult = await client.query<LockRow>(
      'SELECT * FROM spike_r5.document_lock WHERE document_id = $1 FOR UPDATE',
      [documentId],
    )
    const lock = lockResult.rows[0] ?? null
    const holdsValidLock =
      lock !== null && lock.holder_session_id === sessionId && lock.expires_at >= now

    if (!holdsValidLock) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'lock_lost', holder: lock }
    }

    const draftResult = await client.query<DraftRow>(
      'SELECT * FROM spike_r5.draft WHERE document_id = $1 FOR UPDATE',
      [documentId],
    )
    const draft = draftResult.rows[0]
    if (draft === undefined) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'not_found' }
    }
    if (draft.draft_version !== expectedVersion) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'stale_version', currentVersion: draft.draft_version }
    }

    const updated = await client.query<DraftRow>(
      `UPDATE spike_r5.draft
       SET ast = $2::jsonb, draft_version = draft_version + 1, updated_at = $3::timestamptz
       WHERE document_id = $1
       RETURNING *`,
      [documentId, JSON.stringify(ast), now],
    )
    await client.query('COMMIT')
    return { ok: true, draft: updated.rows[0] }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
