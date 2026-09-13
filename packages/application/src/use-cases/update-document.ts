import type { DocumentId, DocumentStatus, UserId } from '@quill/domain'

import type { DocumentFormat } from '../ports/document-format.ts'
import type {
  CollectionId,
  DocumentLockRow,
  DocumentRow,
  RepositoryBundle,
  SessionId,
  UnitOfWork,
  UpdateDocumentPatch,
} from '../ports/persistence.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { DOCUMENT_RENAMED, EVENT_PAYLOAD_VERSION } from './events.ts'
import type { DocumentRenamedPayload } from './events.ts'
import { heldByAnother, readDraftContent } from './publish-document.ts'

/**
 * Moving and renaming a document, with its destination checked.
 *
 * `PATCH /api/documents/:id` used to hand the patch straight to the
 * repository (review finding H5). `collection_id` and `parent_id` are the
 * document's place in the permission tree (ADR-012) and in the navigation
 * tree, and `parent_id` had no foreign key, so a single request could write a
 * parent that did not exist — after which every scope-chain walk for that
 * document failed with a 500, *including the PATCH that would have undone
 * it*. One typo and the document was unreachable for good.
 *
 * Three rules make the destination real, and they are here rather than in the
 * route because they are business rules about the tree, not about HTTP:
 *
 * - a collection must exist and belong to this document's workspace;
 * - a parent must exist and sit in the destination collection, so a document
 *   and its parent are always governed by the same chain;
 * - a document may not become its own ancestor, which would make the chain a
 *   cycle and hang or fail every resolution through it.
 *
 * Whether the *caller* may put a document there is the route's question, and
 * it asks the authorizer for `manage` at the destination as well as at the
 * source (`routes/documents.ts`).
 *
 * A **rename** is the fourth rule, and it is about content rather than about
 * the tree. A document's title lives in the document — its front matter
 * `title`, and its first heading when that is what names it (ADR-005) — and
 * `documents.title` is an index of that, rebuildable from the content
 * (ADR-034). A rename that set only the column was undone by the next
 * publish, which re-derives the title from the draft and wrote the old name
 * back over it. So the rename edits the draft as well as the row, which makes
 * it a write to the document: it bumps the draft version, and it is refused
 * with `lock-lost` while another live session holds the document, exactly as
 * a draft write and a publish are (ADR-021). The revision that carries the
 * new name arrives with the next publish (ADR-015).
 */

export const DOCUMENT_AUDIT_EVENTS = {
  deleted: 'document.deleted',
} as const

export interface UpdateDocumentDependencies {
  readonly uow: UnitOfWork
  /** A rename is written into the draft, which is the Markdown layer's job. */
  readonly format: DocumentFormat
  readonly clock: Clock
  readonly ids: IdGenerator
}

/**
 * The fields a PATCH may set. `parentId: null` is meaningful — it lifts a
 * document to the root of its collection — so it is distinct from omitting
 * the field, which leaves the parent alone.
 */
export interface UpdateDocumentPatchInput {
  readonly title?: string
  readonly slug?: string
  readonly path?: string
  readonly status?: DocumentStatus
  readonly collectionId?: CollectionId
  readonly parentId?: DocumentId | null
}

export interface UpdateDocumentCommand {
  readonly documentId: DocumentId
  readonly patch: UpdateDocumentPatchInput
  /** The session asking: a rename is a write, and a write re-validates the lock (ADR-021). */
  readonly sessionId: SessionId
}

export type UpdateDocumentResult =
  | { readonly kind: 'updated'; readonly document: DocumentRow }
  | { readonly kind: 'not-found' }
  /** The destination collection does not exist, or belongs to another workspace. */
  | { readonly kind: 'collection-not-found' }
  /** The parent does not exist, or belongs to another workspace. */
  | { readonly kind: 'parent-not-found' }
  /** The parent is in a different collection from the one the document would land in. */
  | { readonly kind: 'parent-outside-collection' }
  /** The document is the parent, or one of its ancestors. */
  | { readonly kind: 'cycle' }
  /** Somebody else is editing this document, so this rename is not the write that counts. */
  | { readonly kind: 'lock-lost'; readonly holder: DocumentLockRow }

export async function updateDocument(
  deps: UpdateDocumentDependencies,
  command: UpdateDocumentCommand,
): Promise<UpdateDocumentResult> {
  const { repos } = deps.uow
  const document = await repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found' }

  const { patch } = command
  const destinationCollection = patch.collectionId ?? document.collectionId

  if (patch.collectionId !== undefined) {
    const collection = await repos.collections.findById(patch.collectionId)
    // A collection in another workspace is reported as missing rather than as
    // forbidden: the caller must not learn that an id they cannot reach is
    // one that exists.
    if (collection === null || collection.workspaceId !== document.workspaceId) {
      return { kind: 'collection-not-found' }
    }
  }

  if (patch.parentId !== undefined && patch.parentId !== null) {
    const invalid = await checkParent(deps, {
      document,
      parentId: patch.parentId,
      destinationCollection,
    })
    if (invalid !== null) return invalid
  }

  // The draft, the row, and the event are one transaction: a rename that
  // reached the draft and not the row would leave the index disagreeing with
  // the content it indexes, and a takeover cannot slip between the lock check
  // and the write.
  const now = deps.clock.now()
  return await deps.uow.run(async (tx) => {
    if (patch.title !== undefined) {
      const refused = await applyRename(deps, tx, {
        document,
        title: patch.title,
        sessionId: command.sessionId,
        now,
      })
      if (refused !== null) return refused
    }
    return {
      kind: 'updated',
      document: await tx.documents.update(command.documentId, toPatch(patch), now),
    }
  })
}

interface ApplyRenameInput {
  readonly document: DocumentRow
  readonly title: string
  readonly sessionId: SessionId
  readonly now: Date
}

/**
 * The new title, written where the title actually lives.
 *
 * The refusal when another session holds the document; null when the draft
 * carries the new name, or when there is no draft to carry it. A document
 * with no readable draft — one seeded or imported without one, or one written
 * by a newer release (ADR-033) — still gets its row renamed: the column is an
 * index, and an index this release cannot rebuild is not a reason to refuse
 * the rename.
 */
async function applyRename(
  deps: UpdateDocumentDependencies,
  tx: RepositoryBundle,
  input: ApplyRenameInput,
): Promise<UpdateDocumentResult | null> {
  const holder = await heldByAnother(tx, input.document.id, input.sessionId, input.now)
  if (holder !== null) return { kind: 'lock-lost', holder }

  const draft = await tx.drafts.find(input.document.id)
  const content = draft === null ? null : readDraftContent(draft.ast)
  if (draft !== null && content !== null) {
    // The base does not move; the content does, which bumps the draft version
    // so an editor that was open when the rename landed is told its next
    // write is stale and re-reads (ADR-021).
    await tx.drafts.rebase({
      documentId: input.document.id,
      baseRevision: draft.baseRevision,
      ast: deps.format.retitle({ content, title: input.title }),
      now: input.now,
    })
  }

  // The event says the document is known by a new name from now on, which is
  // true the moment the row changes. A publish emits its own only when the
  // publish is what changed the title — an author editing the first heading —
  // so a rename is announced exactly once (`recordPublish`).
  if (input.title !== input.document.title) {
    const payload: DocumentRenamedPayload = {
      version: EVENT_PAYLOAD_VERSION,
      documentId: input.document.id,
      workspaceId: input.document.workspaceId,
      from: input.document.title,
      to: input.title,
    }
    await tx.outbox.write({
      id: deps.ids.uuid(),
      type: DOCUMENT_RENAMED,
      payload,
      now: input.now,
    })
  }
  return null
}

/** Null when the parent is a legitimate destination; the refusal otherwise. */
async function checkParent(
  deps: UpdateDocumentDependencies,
  input: {
    readonly document: DocumentRow
    readonly parentId: DocumentId
    readonly destinationCollection: CollectionId | null
  },
): Promise<UpdateDocumentResult | null> {
  const { repos } = deps.uow
  if (input.parentId === input.document.id) return { kind: 'cycle' }

  const parent = await repos.documents.findById(input.parentId)
  if (parent === null || parent.workspaceId !== input.document.workspaceId) {
    return { kind: 'parent-not-found' }
  }
  if (parent.collectionId !== input.destinationCollection) {
    return { kind: 'parent-outside-collection' }
  }

  // `listAncestors` answers the parent and everything above it in one query,
  // so the cycle check is a lookup rather than a walk.
  const ancestors = await repos.documents.listAncestors(parent.id)
  if (ancestors.some((ancestor) => ancestor.id === input.document.id)) {
    return { kind: 'cycle' }
  }
  return null
}

export interface DeleteDocumentCommand {
  readonly documentId: DocumentId
  readonly deletedBy: UserId
}

export type DeleteDocumentResult = { readonly kind: 'deleted' } | { readonly kind: 'not-found' }

/**
 * Deleting a document, with a row to say who did it.
 *
 * `documents.parent_id` sets its children's parent to null rather than
 * deleting them (see the schema), so a delete lifts a subtree to the root of
 * its collection instead of taking it away silently — and the audit row
 * records how many were moved, because "where did my pages go" is a question
 * the log has to be able to answer.
 */
export async function deleteDocument(
  deps: UpdateDocumentDependencies,
  command: DeleteDocumentCommand,
): Promise<DeleteDocumentResult> {
  const { repos } = deps.uow
  const document = await repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found' }

  const siblings = await repos.documents.listByWorkspace(document.workspaceId)
  const orphaned = siblings.filter((row) => row.parentId === command.documentId).length

  await repos.documents.delete(command.documentId)
  await repos.audit.write({
    id: deps.ids.uuid(),
    type: DOCUMENT_AUDIT_EVENTS.deleted,
    actorUserId: command.deletedBy,
    targetType: 'document',
    targetId: document.id,
    metadata: {
      workspaceId: document.workspaceId,
      collectionId: document.collectionId,
      title: document.title,
      path: document.path,
      childrenLifted: orphaned,
    },
    now: deps.clock.now(),
  })
  return { kind: 'deleted' }
}

/** Only the fields the caller actually sent, so an omitted field is left alone. */
function toPatch(patch: UpdateDocumentPatchInput): UpdateDocumentPatch {
  return {
    ...(patch.title === undefined ? {} : { title: patch.title }),
    ...(patch.slug === undefined ? {} : { slug: patch.slug }),
    ...(patch.path === undefined ? {} : { path: patch.path }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
    ...(patch.collectionId === undefined ? {} : { collectionId: patch.collectionId }),
    ...(patch.parentId === undefined ? {} : { parentId: patch.parentId }),
  }
}
