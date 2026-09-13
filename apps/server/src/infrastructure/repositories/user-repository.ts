import { eq } from 'drizzle-orm'

import type { CreateUserInput, UserRepository, UserRow } from '@quill/application'
import type { UserId } from '@quill/domain'

import { users } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

function toUserRow(row: typeof users.$inferSelect): UserRow {
  return {
    id: row.id as UserId,
    email: row.email,
    displayName: row.displayName,
    emailVerifiedAt: row.emailVerifiedAt,
    isInstanceAdmin: row.isInstanceAdmin,
    createdAt: row.createdAt,
  }
}

export function createUserRepository(db: DrizzleClient): UserRepository {
  return {
    async create(input: CreateUserInput): Promise<UserRow> {
      const rows = await db
        .insert(users)
        .values({
          id: input.id,
          email: input.email,
          displayName: input.displayName,
          createdAt: input.now,
        })
        .returning()
      return toUserRow(requireRow(rows[0], 'create: expected the inserted user row back'))
    },

    async findById(id: UserId): Promise<UserRow | null> {
      const rows = await db.select().from(users).where(eq(users.id, id))
      const row = rows[0]
      return row === undefined ? null : toUserRow(row)
    },

    async findByEmail(email: string): Promise<UserRow | null> {
      const rows = await db.select().from(users).where(eq(users.email, email))
      const row = rows[0]
      return row === undefined ? null : toUserRow(row)
    },

    async markEmailVerified(id: UserId, now: Date): Promise<void> {
      await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, id))
    },

    async setInstanceAdmin(id: UserId, isInstanceAdmin: boolean): Promise<void> {
      await db.update(users).set({ isInstanceAdmin }).where(eq(users.id, id))
    },
  }
}
