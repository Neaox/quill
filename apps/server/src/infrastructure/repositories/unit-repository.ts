import { eq, isNull, sql } from 'drizzle-orm'

import type { UnitId, UnitRepository, UnitRow } from '@quill/application'

import { organisationalUnits } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

interface UnitRecord extends Record<string, unknown> {
  id: string
  parent_id: string | null
  name: string
  slug: string
  label: string
  created_at: Date
}

function toUnitRow(row: typeof organisationalUnits.$inferSelect): UnitRow {
  return {
    id: row.id as UnitId,
    parentId: row.parentId as UnitId | null,
    name: row.name,
    slug: row.slug,
    label: row.label,
    createdAt: row.createdAt,
  }
}

function fromRecord(record: UnitRecord): UnitRow {
  return {
    id: record.id as UnitId,
    parentId: record.parent_id as UnitId | null,
    name: record.name,
    slug: record.slug,
    label: record.label,
    createdAt: record.created_at,
  }
}

export function createUnitRepository(db: DrizzleClient): UnitRepository {
  return {
    async create({ id, parentId, name, slug, label, now }): Promise<UnitRow> {
      const rows = await db
        .insert(organisationalUnits)
        .values({ id, parentId, name, slug, label, createdAt: now })
        .returning()
      return toUnitRow(requireRow(rows[0], 'create: expected the inserted unit row back'))
    },

    async findById(id: UnitId): Promise<UnitRow | null> {
      const rows = await db.select().from(organisationalUnits).where(eq(organisationalUnits.id, id))
      const row = rows[0]
      return row === undefined ? null : toUnitRow(row)
    },

    async listChildren(parentId: UnitId | null): Promise<readonly UnitRow[]> {
      const condition =
        parentId === null
          ? isNull(organisationalUnits.parentId)
          : eq(organisationalUnits.parentId, parentId)
      const rows = await db.select().from(organisationalUnits).where(condition)
      return rows.map(toUnitRow)
    },

    /**
     * One recursive walk to the root, not one query per level: every
     * permission check reads the whole chain of units above a workspace.
     */
    async listAncestors(id: UnitId): Promise<readonly UnitRow[]> {
      const { rows } = await db.execute<UnitRecord & { depth: number }>(sql`
        WITH RECURSIVE chain AS (
          SELECT u.id, u.parent_id, u.name, u.slug, u.label, u.created_at, 0 AS depth
          FROM organisational_units u
          WHERE u.id = ${id}
          UNION ALL
          SELECT parent.id, parent.parent_id, parent.name, parent.slug, parent.label,
                 parent.created_at, chain.depth + 1
          FROM organisational_units parent
          JOIN chain ON chain.parent_id = parent.id
          WHERE chain.depth < 64
        )
        SELECT * FROM chain ORDER BY depth
      `)
      return rows.map(fromRecord)
    },

    async rename(id: UnitId, name: string): Promise<UnitRow> {
      const rows = await db
        .update(organisationalUnits)
        .set({ name })
        .where(eq(organisationalUnits.id, id))
        .returning()
      return toUnitRow(requireRow(rows[0], 'rename: unit not found'))
    },

    async delete(id: UnitId): Promise<void> {
      await db.delete(organisationalUnits).where(eq(organisationalUnits.id, id))
    },
  }
}
