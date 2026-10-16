import { REQUEST_IN_FLIGHT_FOR_MS, retryAfter } from '@quill/domain'
import { and, inArray, lt, or, sql } from 'drizzle-orm'

import type { LinkPreviewRepository, LinkPreviewRow } from '@quill/application'

import { FAVICON_HASH, linkPreviews, THUMBNAIL_HASH } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'

type StoredRow = typeof linkPreviews.$inferSelect

function toState(value: string): LinkPreviewRow['state'] {
  // A state a later release invented reads as "nothing known yet": the link is fetched again.
  return value === 'ready' || value === 'failed' ? value : 'pending'
}

function toRow(row: StoredRow): LinkPreviewRow {
  return {
    scope: row.scope,
    key: row.key,
    state: toState(row.state),
    document: row.document,
    failure: row.failure,
    fetchedAt: row.fetchedAt,
    requestedAt: row.requestedAt,
    retryAfter: row.retryAfter,
  }
}

/**
 * Stored link previews (ADR-042). Every method is one statement, so a page
 * with fifty links costs one read and one claim, and two readers who miss the
 * same link at once cannot both be told to fetch it: the claim is a
 * conditional upsert, and the database decides who got there first.
 */
export function createLinkPreviewRepository(db: DrizzleClient): LinkPreviewRepository {
  return {
    async findMany(scopes, keys) {
      if (scopes.length === 0 || keys.length === 0) return []
      const rows = await db
        .select()
        .from(linkPreviews)
        .where(and(inArray(linkPreviews.scope, [...scopes]), inArray(linkPreviews.key, [...keys])))
      return rows.map(toRow)
    },

    async requestFetch({ scope, keys, now, force }) {
      // Twice the same key in one statement is an error to `ON CONFLICT`.
      const unique = [...new Set(keys)]
      if (unique.length === 0) return []
      const cutoff = new Date(now.getTime() - REQUEST_IN_FLIGHT_FOR_MS)
      const claimed = await db
        .insert(linkPreviews)
        .values(
          unique.map((key) => ({
            scope,
            key,
            state: 'pending',
            fetchedAt: now,
            requestedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [linkPreviews.scope, linkPreviews.key],
          // Only the mark moves: a stored preview stays exactly as it was.
          set: { requestedAt: now },
          setWhere: sql`(${linkPreviews.requestedAt} IS NULL OR ${linkPreviews.requestedAt} < ${cutoff})
            AND (${force}::boolean OR ${linkPreviews.retryAfter} IS NULL OR ${linkPreviews.retryAfter} <= ${now})`,
        })
        .returning({ key: linkPreviews.key })
      return claimed.map((row) => row.key)
    },

    async putReady({ scope, key, document, now }) {
      const row = {
        state: 'ready',
        document,
        failure: null,
        fetchedAt: now,
        requestedAt: null,
        retryAfter: null,
      }
      await db
        .insert(linkPreviews)
        .values({ scope, key, ...row })
        .onConflictDoUpdate({ target: [linkPreviews.scope, linkPreviews.key], set: row })
    },

    async putFailure({ scope, key, failure, now }) {
      const waitUntil = retryAfter(now)
      const wasReady = sql`${linkPreviews.state} = 'ready'`
      await db
        .insert(linkPreviews)
        .values({
          scope,
          key,
          state: 'failed',
          failure,
          fetchedAt: now,
          retryAfter: waitUntil,
        })
        .onConflictDoUpdate({
          target: [linkPreviews.scope, linkPreviews.key],
          // A good preview survives a failed refresh, and only the clock moves.
          set: {
            state: sql`CASE WHEN ${wasReady} THEN 'ready' ELSE 'failed' END`,
            document: sql`CASE WHEN ${wasReady} THEN ${linkPreviews.document} ELSE NULL END`,
            failure: sql`CASE WHEN ${wasReady} THEN NULL ELSE ${failure}::text END`,
            fetchedAt: sql`CASE WHEN ${wasReady} THEN ${linkPreviews.fetchedAt} ELSE ${now}::timestamptz END`,
            requestedAt: null,
            retryAfter: waitUntil,
          },
        })
    },

    async isImageReferenced(hash) {
      // Two indexed lookups, one per place a preview keeps a picture.
      const found = await db
        .select({ key: linkPreviews.key })
        .from(linkPreviews)
        .where(or(sql`${THUMBNAIL_HASH} = ${hash}`, sql`${FAVICON_HASH} = ${hash}`))
        .limit(1)
      return found.length > 0
    },

    async deleteFetchedBefore(before) {
      const removed = await db
        .delete(linkPreviews)
        .where(lt(linkPreviews.fetchedAt, before))
        .returning({ key: linkPreviews.key })
      return removed.length
    },
  }
}
