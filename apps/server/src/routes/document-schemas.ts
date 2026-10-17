import { Type } from '@sinclair/typebox'
import { DOCUMENT_STATUSES, slugify } from '@quill/domain'
import type { Static } from '@sinclair/typebox'
import type {
  ComparedContent,
  ComparedSource,
  DocumentRow,
  DraftRow,
  EnvelopeView,
  FactsView,
  HistoryPageView,
  LifecycleView,
  Replacement,
} from '@quill/application'
import type { DocumentStatus, PublicDocumentFacts, PublicLifecycle } from '@quill/domain'

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

/**
 * What a document states about itself, for the byline under its title
 * (`docs/design/properties.md`). Owners are labels, never addresses: a person
 * Quill knows is named, anything else is shown as written.
 */
const OwnerSchema = Type.Object({ label: Type.String(), person: Type.Boolean() })

/**
 * A deprecated document's replacement, at the address this reader follows it
 * by. Absent when there is none, or when this reader may not open it: its
 * title is then exactly what they were never shown (ADR-046).
 */
const ReplacementSchema = Type.Object({ href: Type.String(), title: Type.String() })

const InReviewSchema = Type.Object({ state: Type.Literal('in-review') })
const DeprecatedSchema = Type.Object({
  state: Type.Literal('deprecated'),
  replacement: Type.Optional(ReplacementSchema),
})

/**
 * The lifecycle an author or owner set (ADR-005 amendment): absent when none
 * is. Whether a verification has lapsed is the client's to work out from the
 * review cycle at the moment it shows it, never something stored or sent.
 */
const LifecycleSchema = Type.Union([
  InReviewSchema,
  Type.Object({
    state: Type.Literal('verified'),
    verifiedBy: Type.Optional(OwnerSchema),
    verifiedAt: Type.Optional(Type.String({ format: 'date' })),
  }),
  DeprecatedSchema,
])

/** The lifecycle an outsider is told: never who verified, and a verification only while it stands. */
const PublicLifecycleSchema = Type.Union([
  InReviewSchema,
  Type.Object({
    state: Type.Literal('verified'),
    verifiedAt: Type.Optional(Type.String({ format: 'date' })),
  }),
  DeprecatedSchema,
])

export const FactsSchema = Type.Object({
  /** A status from before the lifecycle. Kept for compatibility (ADR-033) and shown by nothing. */
  status: Type.Optional(DocumentStatusSchema),
  lifecycle: Type.Optional(LifecycleSchema),
  type: Type.Optional(Type.String()),
  owners: Type.Array(OwnerSchema),
  tags: Type.Array(Type.String()),
  reviewInterval: Type.Optional(Type.String()),
  lastReviewed: Type.Optional(Type.String({ format: 'date' })),
})

/** What an outsider is shown: no people, no internal review cadence (ADR-057). */
export const PublicFactsSchema = Type.Object({
  /** A status from before the lifecycle. Kept for compatibility (ADR-033) and shown by nothing. */
  status: Type.Optional(DocumentStatusSchema),
  lifecycle: Type.Optional(PublicLifecycleSchema),
  tags: Type.Array(Type.String()),
  lastReviewed: Type.Optional(Type.String({ format: 'date' })),
})

export const EnvelopeSchema = Type.Object({
  permissions: Type.Object({
    view: Type.Boolean(),
    comment: Type.Boolean(),
    edit: Type.Boolean(),
    publish: Type.Boolean(),
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
  facts: FactsSchema,
  /**
   * Whether the draft holds changes nothing has published, for the header's
   * publication state. Only ever true for someone who may edit.
   */
  unpublishedChanges: Type.Boolean(),
  /**
   * The draft waiting to be published, for somebody who may edit: saved since the last
   * publish, or the draft of a document never published. Null for everybody else.
   */
  draft: Type.Union([Type.Object({ savedAt: Type.String({ format: 'date-time' }) }), Type.Null()]),
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

export const CompareQuerySchema = Type.Object({
  /** Omitted compares against nothing, which is how a first revision reads. */
  from: Type.Optional(RevisionSchema),
  /** A revision, or `draft`: the document as its next publish would write it. */
  to: Type.Union([RevisionSchema, Type.Literal('draft')]),
  /** Draw each change on its own too, and say which can be put back in the draft. */
  patches: Type.Optional(Type.Boolean()),
})

/** Some changes since a revision, to be put back in the draft the caller is looking at. */
export const RevertDraftChangesBodySchema = Type.Object({
  /** The revision the changes are since; omitted for a document never published. */
  from: Type.Optional(RevisionSchema),
  /** The version of the draft the caller is looking at. */
  draftVersion: Type.Integer({ minimum: 0 }),
  /** The ids the comparison named them by. */
  changes: Type.Array(Type.String({ pattern: '^c\\d{1,6}$' }), { minItems: 1, maxItems: 500 }),
})

/** The draft as it would be with those changes put back: not saved, for the editor to apply. */
export const RevertedDraftSchema = Type.Object({
  draftVersion: Type.Integer(),
  ast: Type.Record(Type.String(), Type.Unknown()),
})

/**
 * The draft with those changes put back and saved: its new version, and what it held
 * before, which undoing the revert sends back.
 */
export const PutBackDraftSchema = Type.Object({
  draftVersion: Type.Integer(),
  previous: Type.Record(Type.String(), Type.Unknown()),
})

/** Undoing a revert: the draft as it was, replacing the version the revert made. */
export const UndoRevertBodySchema = Type.Object({
  draftVersion: Type.Integer({ minimum: 0 }),
  ast: Type.Record(Type.String(), Type.Unknown()),
})

export const UndoneRevertSchema = Type.Object({ draftVersion: Type.Integer() })

const ChangeKindSchema = Type.Union([
  Type.Literal('added'),
  Type.Literal('removed'),
  Type.Literal('changed'),
  Type.Literal('moved'),
])

const LineChangeSchema = Type.Union([
  Type.Literal('equal'),
  Type.Literal('added'),
  Type.Literal('removed'),
])

/**
 * Two versions of a document as one page (`docs/architecture/api-contract-m2.md`).
 *
 * Deliberately Git-free: no path, no revision hash, no hunk header. Each
 * change names its block by `id`, which the `html` carries as
 * `data-change-id`; each section names its heading by the id the heading
 * carries in `html`.
 */
export const ComparisonSchema = Type.Object({
  html: Type.String(),
  summary: Type.Object({
    sections: Type.Integer(),
    added: Type.Integer(),
    removed: Type.Integer(),
    changed: Type.Integer(),
    moved: Type.Integer(),
    wordsAdded: Type.Integer(),
    wordsRemoved: Type.Integer(),
  }),
  changes: Type.Array(
    Type.Object({
      id: Type.String(),
      change: ChangeKindSchema,
      block: Type.String(),
      excerpt: Type.String(),
      wordsAdded: Type.Integer(),
      wordsRemoved: Type.Integer(),
      section: Type.Optional(Type.Object({ id: Type.String(), title: Type.String() })),
      /** The change drawn on its own; only with `patches`. */
      html: Type.Optional(Type.String()),
      /** Whether it can be put back in the draft; only in a comparison with the draft. */
      revertible: Type.Optional(Type.Boolean()),
      /** Who made it, when the draft's record knows; only in a comparison with the draft. */
      author: Type.Optional(
        Type.Object({
          id: Type.String(),
          /** Absent when the account is gone. */
          name: Type.Optional(Type.String()),
          at: Type.String({ format: 'date-time' }),
        }),
      ),
    }),
  ),
  sections: Type.Array(
    Type.Object({
      id: Type.String(),
      depth: Type.Integer(),
      title: Type.String(),
      changes: Type.Integer(),
    }),
  ),
  properties: Type.Array(
    Type.Object({
      name: Type.String(),
      before: Type.Optional(Type.String()),
      after: Type.Optional(Type.String()),
    }),
  ),
})

/** The two versions' Markdown by line, each changed line's words marked. */
export const SourceComparisonSchema = Type.Object({
  lines: Type.Array(
    Type.Object({
      change: LineChangeSchema,
      before: Type.Optional(Type.Integer()),
      after: Type.Optional(Type.Integer()),
      segments: Type.Array(Type.Object({ change: LineChangeSchema, text: Type.String() })),
    }),
  ),
  wordsAdded: Type.Integer(),
  wordsRemoved: Type.Integer(),
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
      /** A page of the children, or none when the tree was cut above them (`depth`). */
      children: Type.Array(Self),
      /** How many children the document has in all; more than `children` when cut or paged. */
      childCount: Type.Optional(Type.Integer({ minimum: 0 })),
      /** Where `children` starts among them. */
      childrenOffset: Type.Optional(Type.Integer({ minimum: 0 })),
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
      /** How many documents sit at the collection's top level. */
      documentCount: Type.Optional(Type.Integer({ minimum: 0 })),
      /** Where `documents` starts among them. */
      documentsOffset: Type.Optional(Type.Integer({ minimum: 0 })),
      /** Every document in the collection the reader can see, nesting included. */
      total: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
  ),
})

/**
 * The longest a reference to a document may be: an id, a short key, or a
 * readable address of a slug (from a title of at most 200 characters) and a
 * key. Anything longer names nothing, and is refused before it is looked up.
 */
const MAX_REFERENCE_LENGTH = 256

/**
 * `GET /api/workspaces/:id/tree`'s optional cut (ADR-033: additive; without
 * `depth` the whole tree is answered, as it always has been).
 */
export const WorkspaceTreeQuerySchema = Type.Object({
  /** How many levels below each collection to include. */
  depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
  /** How many entries of any one list to include, when `depth` is given; 50 when omitted. */
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  /** A document whose ancestors, page of siblings and children come with the first response. */
  focus: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_REFERENCE_LENGTH })),
})

/** `GET /api/workspaces/:id/tree/children`: one page of a list in the tree. */
export const TreeChildrenQuerySchema = Type.Object({
  /** The document whose children are listed. Exactly one of `parent` and `collection`. */
  parent: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_REFERENCE_LENGTH })),
  /** The collection whose top level is listed. */
  collection: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_REFERENCE_LENGTH })),
  offset: Type.Integer({ minimum: 0, default: 0 }),
  limit: Type.Integer({ minimum: 1, maximum: 500, default: 50 }),
})

export const TreeChildrenSchema = Type.Object({
  /** Each with its `childCount` and none of its own children. */
  documents: Type.Array(Type.Ref(TreeNodeSchema)),
  /** How many entries the list has in all. */
  total: Type.Integer({ minimum: 0 }),
  /** Where `documents` starts among them. */
  offset: Type.Integer({ minimum: 0 }),
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

/** A lifecycle on the wire, with its replacement already resolved for the reader it is going to. */
function lifecycleResponse(
  lifecycle: LifecycleView | PublicLifecycle,
  replacement: Replacement | undefined,
): Static<typeof LifecycleSchema> {
  switch (lifecycle.state) {
    case 'in-review':
      return { state: 'in-review' }
    case 'deprecated':
      return { state: 'deprecated', ...(replacement === undefined ? {} : { replacement }) }
    case 'verified':
      return {
        state: 'verified',
        ...('verifiedBy' in lifecycle && lifecycle.verifiedBy !== undefined
          ? {
              verifiedBy: {
                label: lifecycle.verifiedBy.label,
                person: lifecycle.verifiedBy.person,
              },
            }
          : {}),
        ...(lifecycle.verifiedAt === undefined ? {} : { verifiedAt: lifecycle.verifiedAt }),
      }
  }
}

/**
 * Facts on the wire: an unstated fact is an absent key, never `undefined` or
 * `null`. `replacement` is where a deprecated document's replacement is for
 * this reader, or undefined when there is none they may open.
 */
export function factsResponse(
  facts: FactsView,
  replacement?: Replacement | undefined,
): Static<typeof FactsSchema> {
  return {
    ...(facts.status === undefined ? {} : { status: facts.status }),
    ...(facts.lifecycle === undefined
      ? {}
      : { lifecycle: lifecycleResponse(facts.lifecycle, replacement) }),
    ...(facts.type === undefined ? {} : { type: facts.type }),
    owners: facts.owners.map((owner) => ({ label: owner.label, person: owner.person })),
    tags: [...facts.tags],
    ...(facts.reviewInterval === undefined ? {} : { reviewInterval: facts.reviewInterval }),
    ...(facts.lastReviewed === undefined ? {} : { lastReviewed: facts.lastReviewed }),
  }
}

export function publicFactsResponse(
  facts: PublicDocumentFacts,
  replacement?: Replacement | undefined,
): Static<typeof PublicFactsSchema> {
  return {
    ...(facts.status === undefined ? {} : { status: facts.status }),
    ...(facts.lifecycle === undefined
      ? {}
      : { lifecycle: lifecycleResponse(facts.lifecycle, replacement) }),
    tags: [...facts.tags],
    ...(facts.lastReviewed === undefined ? {} : { lastReviewed: facts.lastReviewed }),
  }
}

export function envelopeResponse(
  envelope: EnvelopeView,
  replacement?: Replacement | undefined,
): Static<typeof EnvelopeSchema> {
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
    facts: factsResponse(envelope.facts, replacement),
    unpublishedChanges: envelope.unpublishedChanges,
    draft: envelope.draft === null ? null : { savedAt: envelope.draft.savedAt.toISOString() },
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

export function comparisonResponse(content: ComparedContent): Static<typeof ComparisonSchema> {
  return {
    html: content.html,
    summary: { ...content.summary },
    changes: content.changes.map(({ section, html, revertible, author, ...change }) => ({
      ...change,
      ...(author === undefined
        ? {}
        : {
            author: {
              id: author.userId,
              at: author.at,
              ...(author.name === undefined ? {} : { name: author.name }),
            },
          }),
      ...(section === undefined ? {} : { section: { ...section } }),
      ...(html === undefined ? {} : { html }),
      ...(revertible === undefined ? {} : { revertible }),
    })),
    sections: content.sections.map((section) => ({ ...section })),
    properties: content.properties.map(({ name, before, after }) => ({
      name,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    })),
  }
}

export function sourceComparisonResponse(
  source: ComparedSource,
): Static<typeof SourceComparisonSchema> {
  return {
    lines: source.lines.map(({ change, before, after, segments }) => ({
      change,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      segments: segments.map((segment) => ({ ...segment })),
    })),
    wordsAdded: source.wordsAdded,
    wordsRemoved: source.wordsRemoved,
  }
}
