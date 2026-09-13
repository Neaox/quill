import { and, eq, inArray, sql } from 'drizzle-orm'

import type {
  CollectionId,
  CreateDocumentInput,
  CreateDocumentOutcome,
  DocumentRepository,
  DocumentRow,
  UpdateDocumentPatch,
} from '@quill/application'
import type { DocumentId, DocumentStatus, RevisionId, ShortId, WorkspaceId } from '@quill/domain'

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
  created_at: Date
  updated_at: Date
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
    createdAt: record.created_at,
    updatedAt: record.updated_at,
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
