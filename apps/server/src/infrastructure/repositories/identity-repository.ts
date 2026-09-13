import { and, asc, eq } from 'drizzle-orm'

import type { IdentityId, IdentityRepository, IdentityRow } from '@quill/application'
import type { UserId } from '@quill/domain'

import { identities } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

function toIdentityRow(row: typeof identities.$inferSelect): IdentityRow {
  return {
    id: row.id as IdentityId,
    userId: row.userId as UserId,
    providerId: row.providerId,
    issuer: row.issuer,
    subject: row.subject,
    createdAt: row.createdAt,
    lastSignInAt: row.lastSignInAt,
  }
}

export function createIdentityRepository(db: DrizzleClient): IdentityRepository {
  return {
    async findBySubject(issuer: string, subject: string): Promise<IdentityRow | null> {
      const rows = await db
        .select()
        .from(identities)
        .where(and(eq(identities.issuer, issuer), eq(identities.subject, subject)))
      const row = rows[0]
      return row === undefined ? null : toIdentityRow(row)
    },

    async listForUser(userId: UserId): Promise<readonly IdentityRow[]> {
      const rows = await db
        .select()
        .from(identities)
        .where(eq(identities.userId, userId))
        .orderBy(asc(identities.createdAt), asc(identities.id))
      return rows.map(toIdentityRow)
    },

    /**
     * `ON CONFLICT DO NOTHING` on the unique `(issuer, subject)` index, then
     * a read: two browsers finishing a first sign-in at the same instant both
     * try to insert, and the loser must get the winner's row rather than an
     * error the sign-in has no way to recover from.
     *
     * The conflicting row is read back rather than returned by an upsert with
     * `DO UPDATE`, because an update would let a second provider's callback
     * silently move an identity to another user — which is exactly the
     * account takeover the unique index exists to prevent.
     */
    async link(input): Promise<IdentityRow> {
      const inserted = await db
        .insert(identities)
        .values({
          id: input.id,
          userId: input.userId,
          providerId: input.providerId,
          issuer: input.issuer,
          subject: input.subject,
          createdAt: input.now,
          lastSignInAt: null,
        })
        .onConflictDoNothing({ target: [identities.issuer, identities.subject] })
        .returning()

      const row = inserted[0]
      if (row !== undefined) return toIdentityRow(row)

      const existing = await db
        .select()
        .from(identities)
        .where(and(eq(identities.issuer, input.issuer), eq(identities.subject, input.subject)))
      return toIdentityRow(
        requireRow(existing[0], 'link: the conflicting identity row disappeared'),
      )
    },

    async touch(id: IdentityId, now: Date): Promise<void> {
      await db.update(identities).set({ lastSignInAt: now }).where(eq(identities.id, id))
    },
  }
}
