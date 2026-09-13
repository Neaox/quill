import { and, desc, eq, lte, ne, or, sql } from 'drizzle-orm'

import type { SessionId, SessionRepository, SessionRow } from '@quill/application'
import type { UserId } from '@quill/domain'

import { sessions } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

function toSessionRow(row: typeof sessions.$inferSelect): SessionRow {
  return {
    id: row.id as SessionId,
    userId: row.userId as UserId,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
  }
}

/**
 * Sessions keyed by an opaque row id and reached only by the hash of the
 * token in the cookie (ADR-011) — see `auth/session-token.ts`.
 */
export function createSessionRepository(db: DrizzleClient): SessionRepository {
  return {
    async create({ id, userId, tokenHash, now, expiresAt }): Promise<SessionRow> {
      const rows = await db
        .insert(sessions)
        .values({ id, userId, tokenHash, createdAt: now, lastSeenAt: now, expiresAt })
        .returning()
      return toSessionRow(requireRow(rows[0], 'create: expected the inserted session row back'))
    },

    async findById(id: SessionId): Promise<SessionRow | null> {
      const rows = await db.select().from(sessions).where(eq(sessions.id, id))
      const row = rows[0]
      return row === undefined ? null : toSessionRow(row)
    },

    async findByTokenHash(tokenHash: string): Promise<SessionRow | null> {
      const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash))
      const row = rows[0]
      return row === undefined ? null : toSessionRow(row)
    },

    async touch(id: SessionId, now: Date): Promise<void> {
      await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id))
    },

    async listForUser(userId: UserId): Promise<readonly SessionRow[]> {
      const rows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(desc(sessions.createdAt))
      return rows.map(toSessionRow)
    },

    async delete(id: SessionId): Promise<void> {
      await db.delete(sessions).where(eq(sessions.id, id))
    },

    async deleteAllForUser(userId: UserId): Promise<void> {
      await db.delete(sessions).where(eq(sessions.userId, userId))
    },

    async deleteAllForUserExcept(userId: UserId, keep: SessionId): Promise<void> {
      await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keep)))
    },

    async deleteExpired({ now, idleCutoff }): Promise<number> {
      const rows = await db
        .delete(sessions)
        .where(
          or(
            lte(sessions.expiresAt, now),
            // A row written before `last_seen_at` existed measures its idle
            // window from when it was created, exactly as `authenticate` does.
            lte(sql`coalesce(${sessions.lastSeenAt}, ${sessions.createdAt})`, idleCutoff),
          ),
        )
        .returning({ id: sessions.id })
      return rows.length
    },
  }
}
