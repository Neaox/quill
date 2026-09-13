import { and, eq, isNotNull, isNull, lte, or } from 'drizzle-orm'

import type {
  MagicLinkId,
  MagicLinkPurpose,
  MagicLinkRepository,
  MagicLinkTokenRow,
} from '@quill/application'
import type { UserId } from '@quill/domain'

import { magicLinkTokens } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

function toMagicLinkRow(row: typeof magicLinkTokens.$inferSelect): MagicLinkTokenRow {
  return {
    id: row.id as MagicLinkId,
    userId: row.userId as UserId,
    tokenHash: row.tokenHash,
    purpose: row.purpose as MagicLinkPurpose,
    bindingHash: row.bindingHash,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  }
}

export function createMagicLinkRepository(db: DrizzleClient): MagicLinkRepository {
  return {
    async create({
      id,
      userId,
      tokenHash,
      purpose,
      bindingHash = null,
      now,
      expiresAt,
    }): Promise<MagicLinkTokenRow> {
      const rows = await db
        .insert(magicLinkTokens)
        .values({ id, userId, tokenHash, purpose, bindingHash, expiresAt, createdAt: now })
        .returning()
      return toMagicLinkRow(
        requireRow(rows[0], 'create: expected the inserted magic link row back'),
      )
    },

    async findByTokenHash(tokenHash: string): Promise<MagicLinkTokenRow | null> {
      const rows = await db
        .select()
        .from(magicLinkTokens)
        .where(eq(magicLinkTokens.tokenHash, tokenHash))
      const row = rows[0]
      return row === undefined ? null : toMagicLinkRow(row)
    },

    /**
     * One `UPDATE ... WHERE consumed_at IS NULL` decides the race: two
     * concurrent requests both find the row, only one updates it.
     */
    async consume(id: MagicLinkId, now: Date): Promise<boolean> {
      const rows = await db
        .update(magicLinkTokens)
        .set({ consumedAt: now })
        .where(and(eq(magicLinkTokens.id, id), isNull(magicLinkTokens.consumedAt)))
        .returning()
      return rows.length === 1
    },

    async supersede(userId: UserId, purpose: MagicLinkPurpose, now: Date): Promise<number> {
      const rows = await db
        .update(magicLinkTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(magicLinkTokens.userId, userId),
            eq(magicLinkTokens.purpose, purpose),
            isNull(magicLinkTokens.consumedAt),
          ),
        )
        .returning({ id: magicLinkTokens.id })
      return rows.length
    },

    async deleteSpent(now: Date): Promise<number> {
      const rows = await db
        .delete(magicLinkTokens)
        .where(or(isNotNull(magicLinkTokens.consumedAt), lte(magicLinkTokens.expiresAt, now)))
        .returning({ id: magicLinkTokens.id })
      return rows.length
    },
  }
}
