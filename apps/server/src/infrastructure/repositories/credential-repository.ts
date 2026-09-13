import { eq } from 'drizzle-orm'

import type { CredentialRepository, CredentialRow } from '@quill/application'
import type { UserId } from '@quill/domain'

import { passwordCredentials } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

function toCredentialRow(row: typeof passwordCredentials.$inferSelect): CredentialRow {
  return {
    userId: row.userId as UserId,
    passwordHash: row.passwordHash,
    updatedAt: row.updatedAt,
  }
}

export function createCredentialRepository(db: DrizzleClient): CredentialRepository {
  return {
    async upsert({ userId, passwordHash, now }): Promise<void> {
      await db
        .insert(passwordCredentials)
        .values({ userId, passwordHash, updatedAt: now })
        .onConflictDoUpdate({
          target: passwordCredentials.userId,
          set: { passwordHash, updatedAt: now },
        })
    },

    async findByUserId(userId: UserId): Promise<CredentialRow | null> {
      const rows = await db
        .select()
        .from(passwordCredentials)
        .where(eq(passwordCredentials.userId, userId))
      const row = rows[0]
      return row === undefined ? null : toCredentialRow(row)
    },

    async delete(userId: UserId): Promise<void> {
      await db.delete(passwordCredentials).where(eq(passwordCredentials.userId, userId))
    },
  }
}
