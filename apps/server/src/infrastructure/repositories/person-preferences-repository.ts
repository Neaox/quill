import { eq } from 'drizzle-orm'

import type { PersonPreferencesRepository, PersonPreferencesRow } from '@quill/application'
import { userId as toUserId } from '@quill/domain'

import { personPreferences } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

function toPersonPreferencesRow(row: typeof personPreferences.$inferSelect): PersonPreferencesRow {
  return { userId: toUserId(row.userId), document: row.document, updatedAt: row.updatedAt }
}

/**
 * A person's preferences document, stored as written. Reading what it means
 * is the application's versioned reader's job (ADR-033), so this neither
 * validates nor reshapes it.
 */
export function createPersonPreferencesRepository(db: DrizzleClient): PersonPreferencesRepository {
  return {
    async find(userId) {
      const rows = await db
        .select()
        .from(personPreferences)
        .where(eq(personPreferences.userId, userId))
      const row = rows[0]
      return row === undefined ? null : toPersonPreferencesRow(row)
    },

    async put({ userId, document, now }) {
      const rows = await db
        .insert(personPreferences)
        .values({ userId, document, updatedAt: now })
        .onConflictDoUpdate({
          target: personPreferences.userId,
          set: { document, updatedAt: now },
        })
        .returning()
      return toPersonPreferencesRow(
        requireRow(rows[0], 'put: expected the stored preferences row back'),
      )
    },
  }
}
