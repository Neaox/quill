import type { DocumentId, ShortId, UserId, WorkspaceId } from '@quill/domain'

import type { ContentStore } from '../ports/content-store.ts'
import type {
  DocumentFormat,
  DraftContent,
  FormatWarning,
  TemplateSource,
} from '../ports/document-format.ts'
import type {
  CollectionId,
  CreateDocumentInput,
  DocumentRow,
  DraftRow,
  RepositoryBundle,
  UnitOfWork,
} from '../ports/persistence.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { documentPathCandidates, MAX_PATH_ATTEMPTS, namedSlug } from './document-path.ts'
import { DOCUMENT_CREATED, EVENT_PAYLOAD_VERSION } from './events.ts'
import type { DocumentCreatedPayload } from './events.ts'

/**
 * Creating a document: blank, or scaffolded from a template (ADR-029).
 *
 * A template is an ordinary published document, so instantiating one is a
 * read from the content store and a pure transformation in the Markdown
 * layer. What comes back is a draft, never a revision: publish is the only
 * write to the content store (ADR-015).
 */

/**
 * How many keys one document may draw before the platform gives up (ADR-035).
 *
 * Ten Crockford characters carry fifty bits, so a collision is a
 * once-in-thousands event even across a million documents: the bound is a
 * safety net against a generator that has stopped being random, not a cost
 * anybody pays.
 */
export const MAX_SHORT_ID_ATTEMPTS = 5

export interface CreateDocumentDependencies {
  readonly uow: UnitOfWork
  readonly contentStore: ContentStore
  readonly format: DocumentFormat
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface CreateDocumentCommand {
  readonly workspaceId: WorkspaceId
  readonly collectionId: CollectionId
  readonly parentId: DocumentId | null
  readonly title: string
  readonly templateId?: DocumentId | undefined
  readonly answers?: Readonly<Record<string, unknown>> | undefined
  readonly createdBy: UserId
}

export type CreateDocumentResult =
  | {
      readonly kind: 'created'
      readonly document: DocumentRow
      readonly draft: DraftRow
      readonly requiredSections: readonly string[]
      readonly warnings: readonly FormatWarning[]
    }
  | { readonly kind: 'collection-not-found'; readonly collectionId: CollectionId }
  | { readonly kind: 'parent-not-found'; readonly parentId: DocumentId }
  | { readonly kind: 'template-not-found'; readonly templateId: DocumentId }
  /** Every path this title could take is held by another document (see `MAX_PATH_ATTEMPTS`). */
  | { readonly kind: 'path-unavailable'; readonly title: string; readonly attempts: number }
  /**
   * Every key drawn for this document was already taken (see
   * `MAX_SHORT_ID_ATTEMPTS`). At fifty bits one collision is a
   * once-in-thousands event and five in a row is not something a healthy
   * instance produces, so this names the cause rather than retrying for ever.
   */
  | { readonly kind: 'short-id-unavailable'; readonly attempts: number }

export async function createDocument(
  deps: CreateDocumentDependencies,
  command: CreateDocumentCommand,
): Promise<CreateDocumentResult> {
  const { repos } = deps.uow

  const collection = await repos.collections.findById(command.collectionId)
  if (collection === null || collection.workspaceId !== command.workspaceId) {
    return { kind: 'collection-not-found', collectionId: command.collectionId }
  }

  const parent = await loadParent(deps, command)
  if (parent.kind === 'missing') return { kind: 'parent-not-found', parentId: parent.parentId }

  const template = await loadTemplate(deps, command)
  if (template.kind === 'missing') {
    return { kind: 'template-not-found', templateId: template.templateId }
  }

  const documentId = deps.ids.uuid() as DocumentId
  const created = deps.format.create({
    documentId,
    title: command.title,
    template: template.source,
  })

  const candidates = documentPathCandidates({
    workspaceId: command.workspaceId,
    collectionSlug: collection.slug,
    parent: parent.document,
    slug: namedSlug(command.title),
  })

  // The document row, its path, its key, its draft, and its event are one
  // transaction: the path and the key are claimed behind their unique indexes
  // rather than probed first, and the draft is written beside the row it
  // references rather than after it, so nothing here can be half-done.
  const now = deps.clock.now()
  const placed = await deps.uow.run(async (tx): Promise<Placement> => {
    for (const candidate of candidates) {
      const claimed = await claim(deps, tx, {
        id: documentId,
        workspaceId: command.workspaceId,
        collectionId: collection.id,
        parentId: parent.document?.id ?? null,
        slug: candidate.slug,
        path: candidate.path,
        title: command.title,
        status: 'draft',
        templateId: command.templateId ?? null,
        templateVersion: templateVersion(created.content),
        now,
      })
      if (claimed.kind === 'path-taken') continue
      if (claimed.kind === 'short-id-unavailable') return claimed

      const draft = await tx.drafts.init({
        documentId,
        baseRevision: null,
        ast: created.content,
        now,
      })
      const payload: DocumentCreatedPayload = {
        version: EVENT_PAYLOAD_VERSION,
        documentId,
        workspaceId: command.workspaceId,
        title: command.title,
        createdBy: command.createdBy,
      }
      await tx.outbox.write({ id: deps.ids.uuid(), type: DOCUMENT_CREATED, payload, now })
      return { kind: 'placed', document: claimed.document, draft }
    }
    return { kind: 'path-unavailable' }
  })

  if (placed.kind === 'path-unavailable') {
    return { kind: 'path-unavailable', title: command.title, attempts: MAX_PATH_ATTEMPTS }
  }
  if (placed.kind === 'short-id-unavailable') {
    return { kind: 'short-id-unavailable', attempts: MAX_SHORT_ID_ATTEMPTS }
  }

  return {
    kind: 'created',
    document: placed.document,
    draft: placed.draft,
    requiredSections: created.requiredSections,
    warnings: created.warnings,
  }
}

type Placement =
  | { readonly kind: 'placed'; readonly document: DocumentRow; readonly draft: DraftRow }
  | { readonly kind: 'path-unavailable' }
  | { readonly kind: 'short-id-unavailable' }

type Claim =
  | { readonly kind: 'created'; readonly document: DocumentRow }
  | { readonly kind: 'path-taken' }
  | { readonly kind: 'short-id-unavailable' }

/** One path candidate, claimed with a freshly drawn key, redrawing while the key is the problem. */
async function claim(
  deps: CreateDocumentDependencies,
  tx: RepositoryBundle,
  input: Omit<CreateDocumentInput, 'shortId'>,
): Promise<Claim> {
  for (let attempt = 1; attempt <= MAX_SHORT_ID_ATTEMPTS; attempt++) {
    const outcome = await tx.documents.createIfAvailable({
      ...input,
      shortId: deps.ids.shortId() as ShortId,
    })
    if (outcome.kind !== 'short-id-taken') return outcome
  }
  return { kind: 'short-id-unavailable' }
}

type ParentLookup =
  | { readonly kind: 'none'; readonly document: null }
  | { readonly kind: 'found'; readonly document: DocumentRow }
  | { readonly kind: 'missing'; readonly parentId: DocumentId }

async function loadParent(
  deps: CreateDocumentDependencies,
  command: CreateDocumentCommand,
): Promise<ParentLookup> {
  if (command.parentId === null) return { kind: 'none', document: null }
  const parent = await deps.uow.repos.documents.findById(command.parentId)
  // A parent in another collection would put the new document in two places
  // in the tree at once, which the scope chain rejects (ADR-012).
  if (parent === null || parent.collectionId !== command.collectionId) {
    return { kind: 'missing', parentId: command.parentId }
  }
  return { kind: 'found', document: parent }
}

type TemplateLookup =
  | { readonly kind: 'resolved'; readonly source: TemplateSource | undefined }
  | { readonly kind: 'missing'; readonly templateId: DocumentId }

async function loadTemplate(
  deps: CreateDocumentDependencies,
  command: CreateDocumentCommand,
): Promise<TemplateLookup> {
  if (command.templateId === undefined) return { kind: 'resolved', source: undefined }
  const source = await deps.contentStore.read(command.workspaceId, command.templateId)
  if (source === null) return { kind: 'missing', templateId: command.templateId }
  return {
    kind: 'resolved',
    source: { markdown: source.markdown, answers: command.answers ?? {} },
  }
}

/** The template version stamped on the created document, so it can be offered later improvements (ADR-029). */
function templateVersion(content: DraftContent): number | null {
  const reference = content.frontMatter['template']
  if (typeof reference !== 'object' || reference === null) return null
  const version = (reference as { version?: unknown }).version
  return typeof version === 'number' ? version : null
}
