import { and, eq, inArray, sql } from 'drizzle-orm'

import type {
  CollectionId,
  CreateDocumentInput,
  CreateDocumentOutcome,
  DocumentRepository,
  DocumentRow,
  UpdateDocumentPatch,
} from '@quill/application'
import type {
  DocumentId,
  DocumentStatus,
  RevisionId,
  ShortId,
  UserId,
  WorkspaceId,
} from '@quill/domain'

import { documents } from '../db/schema.ts'
import type { DrizzleClient } from '../db/types.ts'
import { requireRow } from '../db/rows.ts'

function toDocumentRow(row: typeof documents.$inferSelect): DocumentRow {
  return {
    id: row.id as DocumentId,
    shortId: row.shortId as ShortId,
    workspaceId: row.workspaceId as WorkspaceId,
    collectionId: row.collectionId as CollectionId | null,
    parentId: row.parentId as DocumentId | null,
    slug: row.slug,
    path: row.path,
    title: row.title,
    status: row.status as DocumentStatus,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    headRevision: row.headRevision as RevisionId | null,
    createdBy: row.createdBy as UserId | null,
    updatedBy: row.updatedBy as UserId | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

interface DocumentRecord extends Record<string, unknown> {
  id: string
  short_id: string
  workspace_id: string
  collection_id: string | null
  parent_id: string | null
  slug: string
  path: string
  title: string
  status: string
  template_id: string | null
  template_version: number | null
  head_revision: string | null
  created_by: string | null
  updated_by: string | null
  /**
   * Drizzle reads a timestamp in raw SQL as the driver's text, not as the
   * `Date` its query builder returns, so a recursive query's rows arrive with
   * strings here and are read into dates below.
   */
  created_at: Date | string
  updated_at: Date | string
}

function toDate(value: Date | string): Date {
  return new Date(value)
}

function fromRecord(record: DocumentRecord): DocumentRow {
  return {
    id: record.id as DocumentId,
    shortId: record.short_id as ShortId,
    workspaceId: record.workspace_id as WorkspaceId,
    collectionId: record.collection_id,
    parentId: record.parent_id as DocumentId | null,
    slug: record.slug,
    path: record.path,
    title: record.title,
    status: record.status as DocumentStatus,
    templateId: record.template_id,
    templateVersion: record.template_version,
    headRevision: record.head_revision as RevisionId | null,
    createdBy: record.created_by as UserId | null,
    updatedBy: record.updated_by as UserId | null,
    createdAt: toDate(record.created_at),
    updatedAt: toDate(record.updated_at),
  }
}

export function createDocumentRepository(db: DrizzleClient): DocumentRepository {
  return {
    async create(input: CreateDocumentInput): Promise<DocumentRow> {
      const rows = await db
        .insert(documents)
        .values({
          id: input.id,
          shortId: input.shortId,
          workspaceId: input.workspaceId,
          collectionId: input.collectionId,
          parentId: input.parentId,
          slug: input.slug,
          path: input.path,
          title: input.title,
          status: input.status,
          templateId: input.templateId,
          templateVersion: input.templateVersion,
          createdBy: input.createdBy ?? null,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning()
      return toDocumentRow(requireRow(rows[0], 'create: expected the inserted document row back'))
    },

    /**
     * The path and the key are claimed by the insert itself: `ON CONFLICT DO
     * NOTHING` answers "somebody else has this" with no row rather than with
     * an error, so the caller can try again without reading a driver's error
     * code, and two creations racing for one path — or for one key — can never
     * both win.
     *
     * Which constraint refused it is then a single lookup, paid only on the
     * refusal: the caller acts differently on the two (ADR-035), and there is
     * no portable way to ask an untargeted `DO NOTHING` which index it hit.
     */
    async createIfAvailable(input: CreateDocumentInput): Promise<CreateDocumentOutcome> {
      const rows = await db
        .insert(documents)
        .values({
          id: input.id,
          shortId: input.shortId,
          workspaceId: input.workspaceId,
          collectionId: input.collectionId,
          parentId: input.parentId,
          slug: input.slug,
          path: input.path,
          title: input.title,
          status: input.status,
          templateId: input.templateId,
          templateVersion: input.templateVersion,
          createdBy: input.createdBy ?? null,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing()
        .returning()
      const row = rows[0]
      if (row !== undefined) return { kind: 'created', document: toDocumentRow(row) }

      const holder = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.shortId, input.shortId))
      return holder[0] === undefined ? { kind: 'path-taken' } : { kind: 'short-id-taken' }
    },

    async findById(id: DocumentId): Promise<DocumentRow | null> {
      const rows = await db.select().from(documents).where(eq(documents.id, id))
      const row = rows[0]
      return row === undefined ? null : toDocumentRow(row)
    },

    async findByShortId(shortId: ShortId): Promise<DocumentRow | null> {
      const rows = await db.select().from(documents).where(eq(documents.shortId, shortId))
      const row = rows[0]
      return row === undefined ? null : toDocumentRow(row)
    },

    async listByShortIds(shortIds: readonly ShortId[]): Promise<readonly DocumentRow[]> {
      if (shortIds.length === 0) return []
      const rows = await db
        .select()
        .from(documents)
        .where(inArray(documents.shortId, [...shortIds]))
      return rows.map(toDocumentRow)
    },

    async findByPath(workspaceId: WorkspaceId, path: string): Promise<DocumentRow | null> {
      const rows = await db
        .select()
        .from(documents)
        .where(and(eq(documents.workspaceId, workspaceId), eq(documents.path, path)))
      const row = rows[0]
      return row === undefined ? null : toDocumentRow(row)
    },

    async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly DocumentRow[]> {
      const rows = await db.select().from(documents).where(eq(documents.workspaceId, workspaceId))
      return rows.map(toDocumentRow)
    },

    async listByCollection(collectionId: CollectionId): Promise<readonly DocumentRow[]> {
      const rows = await db.select().from(documents).where(eq(documents.collectionId, collectionId))
      return rows.map(toDocumentRow)
    },

    async listByIds(ids: readonly DocumentId[]): Promise<readonly DocumentRow[]> {
      if (ids.length === 0) return []
      const rows = await db
        .select()
        .from(documents)
        .where(inArray(documents.id, [...ids]))
      return rows.map(toDocumentRow)
    },

    /** One recursive walk up the document tree; the scope chain needs all of it at once. */
    async listAncestors(id: DocumentId): Promise<readonly DocumentRow[]> {
      const { rows } = await db.execute<DocumentRecord & { depth: number }>(sql`
        WITH RECURSIVE chain AS (
          SELECT d.*, 0 AS depth FROM documents d WHERE d.id = ${id}
          UNION ALL
          SELECT parent.*, chain.depth + 1
          FROM documents parent
          JOIN chain ON chain.parent_id = parent.id
          WHERE chain.depth < 64
        )
        SELECT * FROM chain ORDER BY depth
      `)
      return rows.map(fromRecord)
    },

    /**
     * One recursive walk down the document tree, bounded by the depth and by
     * `limit`, for a child pages list (ADR-056). The cycle guard is the depth
     * itself: a parent chain is acyclic (`checkParent`), and a walk can never
     * go further than the six levels a list may ask for.
     *
     * The outer query has no `ORDER BY`, so PostgreSQL evaluates only as many
     * rows of the recursive query as the `LIMIT` fetches: a page with a
     * hundred thousand pages under it costs `limit` rows, not the subtree. The
     * walk runs a level at a time, so what it stops at is the nearest levels;
     * they are put in level order here, where ordering costs nothing.
     */
    async listDescendants(
      id: DocumentId,
      depth: number,
      limit: number,
    ): Promise<readonly DocumentRow[]> {
      const { rows } = await db.execute<DocumentRecord & { level: number }>(sql`
        WITH RECURSIVE subtree AS (
          SELECT d.*, 1 AS level FROM documents d WHERE d.parent_id = ${id}
          UNION ALL
          SELECT child.*, subtree.level + 1
          FROM documents child
          JOIN subtree ON child.parent_id = subtree.id
          WHERE subtree.level < ${depth}
        )
        SELECT * FROM subtree LIMIT ${limit}
      `)
      return rows.toSorted((left, right) => left.level - right.level).map(fromRecord)
    },

    async update(id: DocumentId, patch: UpdateDocumentPatch, now: Date): Promise<DocumentRow> {
      const rows = await db
        .update(documents)
        .set({ ...patch, updatedAt: now })
        .where(eq(documents.id, id))
        .returning()
      return toDocumentRow(requireRow(rows[0], 'update: document not found'))
    },

    async delete(id: DocumentId): Promise<void> {
      await db.delete(documents).where(eq(documents.id, id))
    },
  }
}
