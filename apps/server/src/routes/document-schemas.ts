import { Type } from '@sinclair/typebox'
import { DOCUMENT_STATUSES, slugify } from '@quill/domain'
import type { Static } from '@sinclair/typebox'
import type { DocumentRow, DraftRow, EnvelopeView, HistoryPageView } from '@quill/application'
import type { DocumentStatus } from '@quill/domain'

/**
 * The shapes of the M2 content API (`docs/architecture/api-contract-m2.md`).
 *
 * The schemas are the contract: Fastify validates against them, the OpenAPI
 * description is generated from them, and the web app's client is generated
 * from that. A field that is not here does not exist as far as any client is
 * concerned.
 */

export const DocumentStatusSchema = Type.Unsafe<DocumentStatus>({
  type: 'string',
  enum: [...DOCUMENT_STATUSES],
})

/** A 40-character hexadecimal revision. Never called a commit (ADR-014). */
export const RevisionSchema = Type.String({ pattern: '^[0-9a-f]{40}$' })

const Nullable = <T extends ReturnType<typeof Type.String>>(schema: T) =>
  Type.Union([schema, Type.Null()])

export const DocumentSchema = Type.Object(
  {
    id: Type.String(),
    /**
     * The short public handle in a readable URL (ADR-035): ten Crockford
     * base-32 characters, unique across the instance, fixed for the life of
     * the document. Every route that takes a document id takes this too.
     */
    shortId: Type.String(),
    workspaceId: Type.String(),
    collectionId: Nullable(Type.String()),
    parentId: Nullable(Type.String()),
    /**
     * The words in a readable URL, derived from the current title on every
     * read and never stored as identity (ADR-035), so a renamed document
     * hands out its new words immediately. The stored path segment, which a
     * PATCH may set and which may carry a `-2` where two documents share a
     * title, is the last segment of `path`.
     */
    slug: Type.String(),
    path: Type.String(),
    title: Type.String(),
    status: DocumentStatusSchema,
    templateId: Nullable(Type.String()),
    templateVersion: Type.Union([Type.Integer(), Type.Null()]),
    headRevision: Nullable(RevisionSchema),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'Document' },
)

export const FrontMatterSchema = Type.Record(Type.String(), Type.Unknown())

export const ContentSchema = Type.Object({
  revision: RevisionSchema,
  markdown: Type.String(),
  frontMatter: FrontMatterSchema,
})

export const OutlineEntrySchema = Type.Recursive(
  (Self) =>
    Type.Object({
      id: Type.String(),
      depth: Type.Integer({ minimum: 1, maximum: 6 }),
      text: Type.String(),
      children: Type.Array(Self),
    }),
  { $id: 'OutlineEntry' },
)

export const RenderedSchema = Type.Object({
  revision: RevisionSchema,
  html: Type.String(),
  outline: Type.Array(Type.Ref(OutlineEntrySchema)),
  /** Live-block slots the body carries (ADR-032); empty until a block type is registered. */
  slots: Type.Array(Type.String()),
})

export const HealthSignalSchema = Type.Object({
  kind: Type.Union([
    Type.Literal('no-owner'),
    Type.Literal('review-overdue'),
    Type.Literal('required-section-empty'),
    Type.Literal('broken-link'),
  ]),
  detail: Type.Optional(Type.String()),
})

export const EnvelopeSchema = Type.Object({
  permissions: Type.Object({
    view: Type.Boolean(),
    comment: Type.Boolean(),
    edit: Type.Boolean(),
    manage: Type.Boolean(),
  }),
  lock: Type.Union([
    Type.Object({
      holderUserId: Type.String(),
      holderName: Type.String(),
      expiresAt: Type.String({ format: 'date-time' }),
    }),
    Type.Null(),
  ]),
  lastPublished: Type.Union([
    Type.Object({
      revision: RevisionSchema,
      author: Type.String(),
      at: Type.String({ format: 'date-time' }),
    }),
    Type.Null(),
  ]),
  review: Type.Union([
    Type.Object({ dueAt: Type.String({ format: 'date-time' }), overdue: Type.Boolean() }),
    Type.Null(),
  ]),
  health: Type.Array(HealthSignalSchema),
})

/** What the publish summary states plainly and publishes anyway (ADR-029). */
export const WarningSchema = Type.Object({ code: Type.String(), detail: Type.String() })

export const PublishBodySchema = Type.Object({
  /** The revision the draft is based on; null before the workspace's first publish. */
  base: Type.Union([RevisionSchema, Type.Null()]),
  changeNote: Type.Optional(Type.String({ maxLength: 500 })),
})

export const RestoreBodySchema = Type.Object({
  revision: RevisionSchema,
  changeNote: Type.Optional(Type.String({ maxLength: 500 })),
})

export const PublishedSchema = Type.Object({
  kind: Type.Literal('published'),
  revision: RevisionSchema,
  /** Stated plainly and never a reason to refuse the publish (ADR-029). */
  warnings: Type.Array(WarningSchema),
  frontMatterIssues: Type.Array(Type.Object({ path: Type.String(), message: Type.String() })),
  incompleteRequiredSections: Type.Array(Type.String()),
})

export const MergeRequiredSchema = Type.Object({
  kind: Type.Literal('merge-required'),
  current: RevisionSchema,
  conflicts: Type.Array(
    Type.Object({
      documentId: Type.String(),
      path: Type.String(),
      ours: Type.String(),
      theirs: Type.String(),
      base: Type.String(),
      conflicted: Type.String(),
    }),
  ),
})

export const RevisionSummarySchema = Type.Object({
  revision: RevisionSchema,
  author: Type.Object({ name: Type.String(), email: Type.String() }),
  timestamp: Type.String({ format: 'date-time' }),
  summary: Type.String(),
  changeNote: Type.Optional(Type.String()),
})

export const HistorySchema = Type.Object({
  revisions: Type.Array(RevisionSummarySchema),
  nextCursor: Type.Optional(Type.String()),
})

export const HistoryQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(Type.String()),
})

export const DiffQuerySchema = Type.Object({
  /** Omitted compares against nothing, which is how a first revision reads. */
  from: Type.Optional(RevisionSchema),
  to: RevisionSchema,
})

export const DiffSchema = Type.Object({
  from: Nullable(RevisionSchema),
  to: RevisionSchema,
  unified: Type.String(),
  added: Type.Integer(),
  removed: Type.Integer(),
})

export const RenderedQuerySchema = Type.Object({ revision: Type.Optional(RevisionSchema) })

export const CreateDocumentBodySchema = Type.Object({
  collectionId: Type.String({ minLength: 1 }),
  // Omitted rather than null for a top-level document: Ajv's type coercion
  // turns a null into "" for a `string | null` body field before the null
  // branch is tried.
  parentId: Type.Optional(Type.String({ minLength: 1 })),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  templateId: Type.Optional(Type.String({ minLength: 1 })),
  answers: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

export const CreatedDocumentSchema = Type.Object({
  document: DocumentSchema,
  draft: Type.Object({
    documentId: Type.String(),
    draftVersion: Type.Integer(),
    baseRevision: Nullable(RevisionSchema),
    updatedAt: Type.String({ format: 'date-time' }),
  }),
  requiredSections: Type.Array(Type.String()),
  warnings: Type.Array(WarningSchema),
})

/** Enough to render a navigation entry and build its link without a second request (ADR-035). */
export const TreeNodeSchema = Type.Recursive(
  (Self) =>
    Type.Object({
      id: Type.String(),
      shortId: Type.String(),
      title: Type.String(),
      /** Derived from the title on read, exactly as `Document.slug` is. */
      slug: Type.String(),
      status: DocumentStatusSchema,
      children: Type.Array(Self),
    }),
  { $id: 'TreeNode' },
)

export const WorkspaceTreeSchema = Type.Object({
  collections: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      slug: Type.String(),
      documents: Type.Array(Type.Ref(TreeNodeSchema)),
    }),
  ),
})

/**
 * The two schemas that refer to themselves are registered as shared schemas
 * rather than inlined, so the OpenAPI description carries one definition each
 * under `components.schemas` and a resolvable self-reference. An inlined
 * recursive schema produces a `$ref` that no generator can follow.
 */
export const SHARED_SCHEMAS = [OutlineEntrySchema, TreeNodeSchema]

export const IdParamsSchema = Type.Object({ id: Type.String() })
export const WorkspaceIdParamsSchema = Type.Object({ workspaceId: Type.String() })

/**
 * Row to response.
 *
 * The wire shape is stated once, here, rather than by letting a row leak into
 * a reply: times are absolute strings, and a field a client should not see
 * simply never travels.
 */
export function documentResponse(row: DocumentRow): Static<typeof DocumentSchema> {
  return {
    id: row.id,
    shortId: row.shortId,
    workspaceId: row.workspaceId,
    collectionId: row.collectionId,
    parentId: row.parentId,
    slug: slugify(row.title),
    path: row.path,
    title: row.title,
    status: row.status,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    headRevision: row.headRevision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function draftResponse(row: DraftRow): Static<typeof CreatedDocumentSchema>['draft'] {
  return {
    documentId: row.documentId,
    draftVersion: row.draftVersion,
    baseRevision: row.baseRevision,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function envelopeResponse(envelope: EnvelopeView): Static<typeof EnvelopeSchema> {
  return {
    permissions: envelope.permissions,
    lock:
      envelope.lock === null
        ? null
        : {
            holderUserId: envelope.lock.holderUserId,
            holderName: envelope.lock.holderName,
            expiresAt: envelope.lock.expiresAt.toISOString(),
          },
    lastPublished:
      envelope.lastPublished === null
        ? null
        : {
            revision: envelope.lastPublished.revision,
            author: envelope.lastPublished.author,
            at: envelope.lastPublished.at.toISOString(),
          },
    review:
      envelope.review === null
        ? null
        : { dueAt: envelope.review.dueAt.toISOString(), overdue: envelope.review.overdue },
    health: envelope.health.map((signal) => ({
      kind: signal.kind,
      ...(signal.detail === undefined ? {} : { detail: signal.detail }),
    })),
  }
}

export function historyResponse(page: HistoryPageView): Static<typeof HistorySchema> {
  return {
    revisions: page.revisions.map((entry) => ({
      revision: entry.revision,
      author: entry.author,
      timestamp: entry.timestamp.toISOString(),
      summary: entry.summary,
      ...(entry.changeNote === undefined ? {} : { changeNote: entry.changeNote }),
    })),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  }
}
