import { and, asc, desc, eq, getTableColumns, inArray, isNull, ne, or, sql } from 'drizzle-orm'

import type {
  GroupId,
  GroupRow,
  ReviewAssignmentRow,
  ReviewRepository,
  ReviewRequestRow,
  UnitId,
  UserRow,
} from '@quill/application'
import type { AssignmentState, DocumentId, ReviewerKind, ReviewStatus, UserId } from '@quill/domain'

import { groups, reviewAssignments, reviewRequests, users } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

function toRequestRow(row: typeof reviewRequests.$inferSelect): ReviewRequestRow {
  return {
    id: row.id,
    documentId: row.documentId as DocumentId,
    requestedBy: row.requestedBy as UserId,
    draftVersion: row.draftVersion,
    message: row.message,
    status: row.status as ReviewStatus,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
  }
}

function toAssignmentRow(row: typeof reviewAssignments.$inferSelect): ReviewAssignmentRow {
  return {
    id: row.id,
    requestId: row.requestId,
    principalKind: row.principalKind as ReviewerKind,
    principalId: row.principalId,
    state: row.state as AssignmentState,
    decidedBy: row.decidedBy as UserId | null,
    comment: row.comment,
    decidedAt: row.decidedAt,
  }
}

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

function toGroupRow(row: typeof groups.$inferSelect): GroupRow {
  return {
    id: row.id as GroupId,
    unitId: row.unitId as UnitId,
    parentGroupId: row.parentId as GroupId | null,
    name: row.name,
    createdAt: row.createdAt,
  }
}

const CLOSED_STATUSES: ReadonlySet<ReviewStatus> = new Set(['withdrawn', 'superseded', 'published'])

/** `%`, `_` and the escape character are literal in what somebody types into a search box. */
const containsPattern = (query: string): string =>
  `%${query.toLowerCase().replace(/[\\%_]/g, String.raw`\$&`)}%`

/**
 * Review requests and their assignments (ADR-052).
 *
 * "Active" is `closed_at IS NULL`, which the partial unique index also uses to
 * keep one active request per document. The directory searches (people and
 * groups by name) live here rather than on the user and group repositories
 * because the review picker is their only reader and they are bounded by it.
 */
export function createReviewRepository(db: DrizzleClient): ReviewRepository {
  return {
    async create(input) {
      const rows = await db
        .insert(reviewRequests)
        .values({
          id: input.id,
          documentId: input.documentId,
          requestedBy: input.requestedBy,
          draftVersion: input.draftVersion,
          message: input.message,
          status: 'open',
          createdAt: input.now,
        })
        .returning()
      if (input.reviewers.length > 0) {
        await db.insert(reviewAssignments).values(
          input.reviewers.map((reviewer, position) => ({
            id: reviewer.id,
            requestId: input.id,
            position,
            principalKind: reviewer.kind,
            principalId: reviewer.principalId,
            state: 'pending',
          })),
        )
      }
      return toRequestRow(requireRow(rows[0], 'create: expected the inserted request row back'))
    },

    async findById(id) {
      const rows = await db.select().from(reviewRequests).where(eq(reviewRequests.id, id))
      const row = rows[0]
      return row === undefined ? null : toRequestRow(row)
    },

    async findActiveForDocument(documentId) {
      const rows = await db
        .select()
        .from(reviewRequests)
        .where(and(eq(reviewRequests.documentId, documentId), isNull(reviewRequests.closedAt)))
      const row = rows[0]
      return row === undefined ? null : toRequestRow(row)
    },

    async findLatestForDocument(documentId) {
      const rows = await db
        .select()
        .from(reviewRequests)
        .where(eq(reviewRequests.documentId, documentId))
        .orderBy(
          sql`(${reviewRequests.closedAt} IS NULL) DESC`,
          desc(reviewRequests.createdAt),
          desc(reviewRequests.id),
        )
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toRequestRow(row)
    },

    async setStatus(id, status, now) {
      const rows = await db
        .update(reviewRequests)
        .set({ status, closedAt: CLOSED_STATUSES.has(status) ? now : null })
        .where(eq(reviewRequests.id, id))
        .returning()
      const row = rows[0]
      return row === undefined ? null : toRequestRow(row)
    },

    async listAssignments(requestIds) {
      if (requestIds.length === 0) return []
      const rows = await db
        .select()
        .from(reviewAssignments)
        .where(inArray(reviewAssignments.requestId, [...requestIds]))
        .orderBy(asc(reviewAssignments.requestId), asc(reviewAssignments.position))
      return rows.map(toAssignmentRow)
    },

    async recordDecision({ assignmentIds, state, decidedBy, comment, now }) {
      if (assignmentIds.length === 0) return
      await db
        .update(reviewAssignments)
        .set({ state, decidedBy, comment, decidedAt: now })
        .where(inArray(reviewAssignments.id, [...assignmentIds]))
    },

    async listAwaiting({ userId, groupIds, limit }) {
      const named =
        groupIds.length === 0
          ? and(
              eq(reviewAssignments.principalKind, 'user'),
              eq(reviewAssignments.principalId, userId),
            )
          : or(
              and(
                eq(reviewAssignments.principalKind, 'user'),
                eq(reviewAssignments.principalId, userId),
              ),
              and(
                eq(reviewAssignments.principalKind, 'group'),
                inArray(reviewAssignments.principalId, [...groupIds]),
              ),
            )
      const rows = await db
        .selectDistinct(getTableColumns(reviewRequests))
        .from(reviewRequests)
        .innerJoin(reviewAssignments, eq(reviewAssignments.requestId, reviewRequests.id))
        .where(
          and(
            isNull(reviewRequests.closedAt),
            ne(reviewRequests.requestedBy, userId),
            eq(reviewAssignments.state, 'pending'),
            named,
          ),
        )
        .orderBy(desc(reviewRequests.createdAt), desc(reviewRequests.id))
        .limit(limit)
      return rows.map(toRequestRow)
    },

    async listAnswered({ userId, limit }) {
      const rows = await db
        .select()
        .from(reviewRequests)
        .where(
          and(
            eq(reviewRequests.requestedBy, userId),
            isNull(reviewRequests.closedAt),
            inArray(reviewRequests.status, ['approved', 'changes_requested']),
          ),
        )
        .orderBy(desc(reviewRequests.createdAt), desc(reviewRequests.id))
        .limit(limit)
      return rows.map(toRequestRow)
    },

    async searchPeople(query, limit) {
      const rows = await db
        .select()
        .from(users)
        .where(sql`lower(${users.displayName}) LIKE ${containsPattern(query)}`)
        .orderBy(asc(users.displayName), asc(users.id))
        .limit(limit)
      return rows.map(toUserRow)
    },

    async searchGroups(query, limit) {
      const rows = await db
        .select()
        .from(groups)
        .where(sql`lower(${groups.name}) LIKE ${containsPattern(query)}`)
        .orderBy(asc(groups.name), asc(groups.id))
        .limit(limit)
      return rows.map(toGroupRow)
    },

    /**
     * One recursive walk down each group's tree. `UNION` rather than `UNION
     * ALL`, so a parent pointer that loops stops at the pair already seen.
     */
    async countGroupMembers(groupIds) {
      if (groupIds.length === 0) return new Map()
      const { rows } = await db.execute<{ group_id: string; members: number }>(sql`
        WITH RECURSIVE tree(root, id) AS (
          SELECT g.id, g.id FROM groups g WHERE g.id IN (${sql.join(
            groupIds.map((id) => sql`${id}`),
            sql`, `,
          )})
          UNION
          SELECT tree.root, child.id FROM groups child JOIN tree ON child.parent_id = tree.id
        )
        SELECT tree.root AS group_id, count(DISTINCT m.user_id)::int AS members
        FROM tree JOIN group_members m ON m.group_id = tree.id
        GROUP BY tree.root
      `)
      return new Map(rows.map((row) => [row.group_id as GroupId, row.members]))
    },

    async listMemberIdsDeep(groupIds) {
      if (groupIds.length === 0) return []
      const { rows } = await db.execute<{ user_id: string }>(sql`
        WITH RECURSIVE tree(id) AS (
          SELECT g.id FROM groups g WHERE g.id IN (${sql.join(
            groupIds.map((id) => sql`${id}`),
            sql`, `,
          )})
          UNION
          SELECT child.id FROM groups child JOIN tree ON child.parent_id = tree.id
        )
        SELECT DISTINCT m.user_id FROM tree JOIN group_members m ON m.group_id = tree.id
      `)
      return rows.map((row) => row.user_id as UserId)
    },
  }
}
