import { and, asc, eq, gt, ne, or } from 'drizzle-orm'

import type { SecretRow, SecretSummary, SecretsRepository } from '@quill/application'

import { secrets } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

function toSecretRow(row: typeof secrets.$inferSelect): SecretRow {
  return {
    name: row.name,
    ciphertext: row.ciphertext,
    wrappedKey: row.wrappedKey,
    keyId: row.keyId,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
    rewrappedAt: row.rewrappedAt,
  }
}

/**
 * Secrets under envelope encryption (ADR-034).
 *
 * `list` selects the columns an API may see and leaves the ciphertext and the
 * wrapped key in the database — not as a courtesy to the caller but because a
 * row that is never read is a row that cannot be logged by accident.
 */
export function createSecretRepository(db: DrizzleClient): SecretsRepository {
  return {
    async find(name: string): Promise<SecretRow | null> {
      const rows = await db.select().from(secrets).where(eq(secrets.name, name))
      const row = rows[0]
      return row === undefined ? null : toSecretRow(row)
    },

    async list(): Promise<readonly SecretSummary[]> {
      const rows = await db
        .select({
          name: secrets.name,
          keyId: secrets.keyId,
          createdAt: secrets.createdAt,
          rotatedAt: secrets.rotatedAt,
          rewrappedAt: secrets.rewrappedAt,
        })
        .from(secrets)
        .orderBy(asc(secrets.name))
      return rows
    },

    /**
     * Replacing a value keeps `created_at` and stamps `rotated_at`, so "when
     * was this secret first entered" survives every replacement of it. A new
     * value is wrapped afresh, so `rewrapped_at` starts over as null.
     */
    async put({ name, ciphertext, wrappedKey, keyId, now }): Promise<SecretRow> {
      const rows = await db
        .insert(secrets)
        .values({
          name,
          ciphertext,
          wrappedKey,
          keyId,
          createdAt: now,
          rotatedAt: null,
          rewrappedAt: null,
        })
        .onConflictDoUpdate({
          target: secrets.name,
          set: { ciphertext, wrappedKey, keyId, rotatedAt: now, rewrappedAt: null },
        })
        .returning()
      return toSecretRow(requireRow(rows[0], 'put: expected the stored secret row back'))
    },

    async rewrap({ name, fromKeyId, fromWrappedKey, wrappedKey, keyId, now }): Promise<boolean> {
      const rows = await db
        .update(secrets)
        .set({ wrappedKey, keyId, rewrappedAt: now })
        .where(
          and(
            eq(secrets.name, name),
            eq(secrets.keyId, fromKeyId),
            eq(secrets.wrappedKey, fromWrappedKey),
          ),
        )
        .returning({ name: secrets.name })
      return rows.length > 0
    },

    async delete(name: string): Promise<boolean> {
      const rows = await db.delete(secrets).where(eq(secrets.name, name)).returning({
        name: secrets.name,
      })
      return rows.length > 0
    },

    async listWrappedWithOther({ keyId, limit, after }): Promise<readonly SecretRow[]> {
      // Keyset paging on the same `(created_at, name)` the order is by: a row
      // is after the cursor when its timestamp is later, or equal and its name
      // sorts after. `name` breaks the tie because it is the primary key, so
      // the order is total and no row can be skipped or seen twice.
      const beyond =
        after === undefined
          ? undefined
          : or(
              gt(secrets.createdAt, after.createdAt),
              and(eq(secrets.createdAt, after.createdAt), gt(secrets.name, after.name)),
            )
      const rows = await db
        .select()
        .from(secrets)
        .where(and(ne(secrets.keyId, keyId), beyond))
        .orderBy(asc(secrets.createdAt), asc(secrets.name))
        .limit(limit)
      return rows.map(toSecretRow)
    },
  }
}
