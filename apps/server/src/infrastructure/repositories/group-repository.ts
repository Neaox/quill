import { and, eq, sql } from 'drizzle-orm'

import type { GroupId, GroupRepository, GroupRow, UnitId } from '@quill/application'
import type { UserId } from '@quill/domain'

import { groupMembers, groups } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

interface GroupRecord extends Record<string, unknown> {
  id: string
  unit_id: string
  parent_id: string | null
  name: string
  created_at: Date
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

function fromRecord(record: GroupRecord): GroupRow {
  return {
    id: record.id as GroupId,
    unitId: record.unit_id as UnitId,
    parentGroupId: record.parent_id as GroupId | null,
    name: record.name,
    createdAt: record.created_at,
  }
}

export function createGroupRepository(db: DrizzleClient): GroupRepository {
  return {
    async create(input): Promise<GroupRow> {
      const rows = await db
        .insert(groups)
        .values({
          id: input.id,
          unitId: input.unitId,
          parentId: input.parentGroupId,
          name: input.name,
          createdAt: input.now,
        })
        .returning()
      return toGroupRow(requireRow(rows[0], 'create: expected the inserted group row back'))
    },

    async findById(id: GroupId): Promise<GroupRow | null> {
      const rows = await db.select().from(groups).where(eq(groups.id, id))
      const row = rows[0]
      return row === undefined ? null : toGroupRow(row)
    },

    async addMember({ groupId, userId, now }): Promise<void> {
      await db
        .insert(groupMembers)
        .values({ groupId, userId, addedAt: now })
        .onConflictDoNothing({ target: [groupMembers.groupId, groupMembers.userId] })
    },

    async removeMember({ groupId, userId }): Promise<void> {
      await db
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    },

    /**
     * One recursive walk up the group tree, not one query per level: a grant
     * to a parent group reaches every group nested inside it (ADR-012), and a
     * request resolves that on every permission check.
     */
    async listForUser(userId: UserId): Promise<readonly GroupRow[]> {
      const { rows } = await db.execute<GroupRecord>(sql`
        WITH RECURSIVE held AS (
          SELECT g.id, g.unit_id, g.parent_id, g.name, g.created_at
          FROM groups g
          JOIN group_members m ON m.group_id = g.id
          WHERE m.user_id = ${userId}
          UNION
          SELECT parent.id, parent.unit_id, parent.parent_id, parent.name, parent.created_at
          FROM groups parent
          JOIN held ON held.parent_id = parent.id
        )
        SELECT * FROM held
      `)
      return rows.map(fromRecord)
    },
  }
}
