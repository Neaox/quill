import { eq, sql } from 'drizzle-orm'
import type pg from 'pg'

import type {
  DocumentLockRow,
  DraftRepository,
  DraftRow,
  SessionId,
  WriteDraftResult,
} from '@quill/application'
import type { DocumentId, RevisionId, UserId } from '@quill/domain'

import { drafts } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

interface RawDraftRow {
  document_id: string
  draft_version: number
  base_revision: string | null
  ast: unknown
  updated_at: Date
}

interface RawLockRow {
  document_id: string
  holder_user_id: string
  holder_session_id: string
  acquired_at: Date
  last_heartbeat_at: Date
  expires_at: Date
}

function toDraftRow(row: RawDraftRow): DraftRow {
  return {
    documentId: row.document_id as DocumentId,
    draftVersion: row.draft_version,
    baseRevision: row.base_revision as RevisionId | null,
    ast: row.ast,
    updatedAt: row.updated_at,
  }
}

function toLockRow(row: RawLockRow): DocumentLockRow {
  return {
    documentId: row.document_id as DocumentId,
    holderUserId: row.holder_user_id as UserId,
    holderSessionId: row.holder_session_id as SessionId,
    acquiredAt: row.acquired_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    expiresAt: row.expires_at,
  }
}

function toDraftRowFrom(row: typeof drafts.$inferSelect): DraftRow {
  return {
    documentId: row.documentId as DocumentId,
    draftVersion: row.draftVersion,
    baseRevision: row.baseRevision as RevisionId | null,
    ast: row.ast,
    updatedAt: row.updatedAt,
  }
}

/**
 * Drizzle/`pg` implementation of `DraftRepository`, ported from the R5 spike
 * (`spikes/r5-draft-locking/src/draft.ts`).
 *
 * `init`, `find`, and `rebase` go through the Drizzle client, so inside
 * `UnitOfWork.run` they are part of that transaction: a document and the draft
 * that references it are created together or not at all. `write` is the
 * exception and holds a connection of its own, because it re-validates lock
 * ownership and the optimistic version inside one transaction with
 * `SELECT ... FOR UPDATE`, so a concurrent takeover cannot interleave between
 * the two checks — see `docs/research/r05-draft-locking.md`, "A draft write
 * must re-validate the lock, not just `draft_version`".
 */
export function createDraftRepository(db: DrizzleClient, pool: pg.Pool): DraftRepository {
  return {
    /**
     * Starts a document's draft, or replaces one that exists.
     *
     * Replacing rather than failing is what makes the operation safe to run
     * again: creating a document, importing one, and seeding an instance all
     * put content into a draft the same way, and none of them should have to
     * know whether a row is already there.
     */
    async init({ documentId, baseRevision, ast, now }): Promise<DraftRow> {
      const rows = await db
        .insert(drafts)
        .values({ documentId, draftVersion: 0, baseRevision, ast, updatedAt: now })
        .onConflictDoUpdate({
          target: drafts.documentId,
          set: {
            baseRevision,
            ast,
            draftVersion: sql`${drafts.draftVersion} + 1`,
            updatedAt: now,
          },
        })
        .returning()
      return toDraftRowFrom(requireRow(rows[0], 'init: expected the inserted draft row back'))
    },

    async find(documentId: DocumentId): Promise<DraftRow | null> {
      const rows = await db.select().from(drafts).where(eq(drafts.documentId, documentId))
      const row = rows[0]
      return row === undefined ? null : toDraftRowFrom(row)
    },

    /**
     * Moving the base alone leaves the content and the version alone; moving
     * the content as well — a restore — bumps the version, so an editor that
     * was open when it landed is told its next write is stale (ADR-021).
     */
    async rebase({ documentId, baseRevision, ast, now }): Promise<DraftRow | null> {
      const rows = await db
        .update(drafts)
        .set({
          baseRevision,
          updatedAt: now,
          ...(ast === undefined ? {} : { ast, draftVersion: sql`${drafts.draftVersion} + 1` }),
        })
        .where(eq(drafts.documentId, documentId))
        .returning()
      const row = rows[0]
      return row === undefined ? null : toDraftRowFrom(row)
    },

    async write({ documentId, sessionId, expectedVersion, ast, now }): Promise<WriteDraftResult> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')

        const lockResult = await client.query<RawLockRow>(
          'SELECT * FROM document_locks WHERE document_id = $1 FOR UPDATE',
          [documentId],
        )
        const lockRow = lockResult.rows[0]
        const holdsValidLock =
          lockRow !== undefined &&
          lockRow.holder_session_id === sessionId &&
          lockRow.expires_at >= now

        if (!holdsValidLock) {
          await client.query('ROLLBACK')
          return {
            ok: false,
            reason: 'lock_lost',
            holder: lockRow === undefined ? null : toLockRow(lockRow),
          }
        }

        const draftResult = await client.query<RawDraftRow>(
          'SELECT * FROM drafts WHERE document_id = $1 FOR UPDATE',
          [documentId],
        )
        const draftRow = draftResult.rows[0]
        if (draftRow === undefined) {
          await client.query('ROLLBACK')
          return { ok: false, reason: 'not_found' }
        }
        if (draftRow.draft_version !== expectedVersion) {
          await client.query('ROLLBACK')
          return { ok: false, reason: 'stale_version', currentVersion: draftRow.draft_version }
        }

        const updated = await client.query<RawDraftRow>(
          `UPDATE drafts
           SET ast = $2::jsonb, draft_version = draft_version + 1, updated_at = $3::timestamptz
           WHERE document_id = $1
           RETURNING *`,
          [documentId, JSON.stringify(ast), now],
        )
        await client.query('COMMIT')
        return {
          ok: true,
          draft: toDraftRow(
            requireRow(updated.rows[0], 'write: expected the updated draft row back'),
          ),
        }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
  }
}
