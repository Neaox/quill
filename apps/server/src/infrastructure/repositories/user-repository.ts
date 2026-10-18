import { and, asc, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm'

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

    async listByIds(ids: readonly UserId[]): Promise<readonly UserRow[]> {
      if (ids.length === 0) return []
      const rows = await db
        .select()
        .from(users)
        .where(inArray(users.id, [...ids]))
      return rows.map(toUserRow)
    },

    async findByEmail(email: string): Promise<UserRow | null> {
      const rows = await db.select().from(users).where(eq(users.email, email))
      const row = rows[0]
      return row === undefined ? null : toUserRow(row)
    },

    async findVerifiedByEmails(emails: readonly string[]): Promise<readonly UserRow[]> {
      if (emails.length === 0) return []
      // `lower(email)` is the unique index (`users_email_lower_key`), so this
      // is one indexed lookup for the whole list.
      const rows = await db
        .select()
        .from(users)
        .where(
          and(
            inArray(
              sql`lower(${users.email})`,
              emails.map((email) => email.toLowerCase()),
            ),
            isNotNull(users.emailVerifiedAt),
          ),
        )
      return rows.map(toUserRow)
    },

    async searchVerified(query: string, limit: number): Promise<readonly UserRow[]> {
      // `%`, `_` and `\` are pattern characters to ILIKE; what was typed is matched literally.
      const literal = query.replaceAll(/[\\%_]/gu, (character) => `\\${character}`)
      const rows = await db
        .select()
        .from(users)
        .where(
          and(
            isNotNull(users.emailVerifiedAt),
            or(ilike(users.displayName, `%${literal}%`), ilike(users.email, `%${literal}%`)),
          ),
        )
        .orderBy(asc(users.displayName))
        .limit(limit)
      return rows.map(toUserRow)
    },

    async searchByPrefix(query: string, limit: number): Promise<readonly UserRow[]> {
      // `%`, `_` and the escape character are literal in what an admin types.
      const pattern = `${query.toLowerCase().replace(/[\\%_]/g, String.raw`\$&`)}%`
      const rows = await db
        .select()
        .from(users)
        .where(
          or(
            sql`lower(${users.displayName}) LIKE ${pattern}`,
            sql`lower(${users.email}) LIKE ${pattern}`,
          ),
        )
        .orderBy(asc(users.displayName), asc(users.email))
        .limit(limit)
      return rows.map(toUserRow)
    },

    async markEmailVerified(id: UserId, now: Date): Promise<void> {
      await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, id))
    },

    async setInstanceAdmin(id: UserId, isInstanceAdmin: boolean): Promise<void> {
      await db.update(users).set({ isInstanceAdmin }).where(eq(users.id, id))
    },
  }
}
