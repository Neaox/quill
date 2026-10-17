import type {
  DocumentId,
  ReviewDecision,
  ReviewerKind,
  ReviewStatus,
  RevisionId,
  UserId,
  WorkspaceId,
} from '@quill/domain'

import type { CollectionId, MagicLinkPurpose } from '../ports/persistence.ts'
import { createVersionedReader } from './versioned-reader.ts'

/**
 * The outbox events the publish path emits (plan §22).
 *
 * Every payload carries a version and every reader dispatches on it
 * (ADR-033): an event written by one release is read by a consumer running a
 * later one, so the shape can grow but never silently change meaning.
 */

/**
 * "Send this message." Mail is queued rather than awaited (ADR-011, no
 * account enumeration): a request whose address has an account would
 * otherwise pay for an SMTP round trip that a request whose address has none
 * does not, and the difference is measurable from anywhere.
 */
export const MAIL_REQUESTED = 'MailRequested'

export const DOCUMENT_CREATED = 'DocumentCreated'
export const DOCUMENT_PUBLISHED = 'DocumentPublished'
export const DOCUMENT_RENAMED = 'DocumentRenamed'
/**
 * A document changed collection (ADR-023). A move inside one collection is not
 * one: the public address is the collection's slug and the document's title,
 * so nesting a page under another does not move it on the web.
 */
export const DOCUMENT_MOVED = 'DocumentMoved'

/**
 * A document was nested under another parent, or lifted to the top, inside
 * its own collection (ADR-054). Nothing on the web moves — `DocumentMoved`
 * covers a change of collection — but the pages listed under both parents
 * change, which is what a child pages list shows.
 */
export const DOCUMENT_NESTED = 'DocumentNested'

/**
 * A document was deleted (ADR-054). Its children were lifted to the top of
 * its collection by the same delete, so every list that showed it, or showed
 * them under it, has changed.
 */
export const DOCUMENT_DELETED = 'DocumentDeleted'

/**
 * An attachment's bytes were replaced by a new revision under the same URL
 * (ADR-043). Every published body that shows it changes without being
 * republished, so what was derived from those bodies — the search index, the
 * public site's cached pages — is brought up to date from this.
 */
export const ATTACHMENT_REVISED = 'AttachmentRevised'

/**
 * Review requests (ADR-052). Payloads name ids and never the message or a
 * comment, which are read from the request when something needs them.
 */
export const REVIEW_REQUESTED = 'ReviewRequested'
export const REVIEW_DECIDED = 'ReviewDecided'
export const REVIEW_WITHDRAWN = 'ReviewWithdrawn'

export const EVENT_PAYLOAD_VERSION = 1

export interface DocumentCreatedPayload {
  readonly version: number
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly createdBy: UserId
}

export interface DocumentPublishedPayload {
  readonly version: number
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly revision: RevisionId
  readonly publishedBy: UserId
}

export interface DocumentRenamedPayload {
  readonly version: number
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly from: string
  readonly to: string
}

export interface DocumentMovedPayload {
  readonly version: number
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  /** Null when the document was in no collection, which is a tree the resolver refuses anyway. */
  readonly fromCollectionId: CollectionId | null
  readonly toCollectionId: CollectionId | null
}

export interface DocumentNestedPayload {
  readonly version: number
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly fromParentId: DocumentId | null
  readonly toParentId: DocumentId | null
}

export interface DocumentDeletedPayload {
  readonly version: number
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly parentId: DocumentId | null
  readonly collectionId: CollectionId | null
}

export interface AttachmentRevisedPayload {
  readonly version: number
  readonly attachmentId: string
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  /** The attachment's own version after the revision. */
  readonly attachmentVersion: number
}

export interface ReviewRequestedPayload {
  readonly version: number
  readonly requestId: string
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly requestedBy: UserId
  readonly reviewers: readonly { readonly kind: ReviewerKind; readonly id: string }[]
}

export interface ReviewDecidedPayload {
  readonly version: number
  readonly requestId: string
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly decidedBy: UserId
  readonly decision: ReviewDecision
  /** Where the request stands after this answer. */
  readonly status: ReviewStatus
}

export interface ReviewWithdrawnPayload {
  readonly version: number
  readonly requestId: string
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly withdrawnBy: UserId
  /** `superseded` when the author asked again; `withdrawn` when they took it back. */
  readonly reason: 'withdrawn' | 'superseded'
}

/**
 * A message waiting to be delivered.
 *
 * The magic-link variant carries the link, and the link carries the token —
 * the one place a live token is written to the database, and only until the
 * consumer has delivered it and redacted the row (`redactPayload` on the mail
 * consumer). ADR-011's rule that a database read yields no usable token holds
 * in steady state, and the exposure is the second or so a queued row waits.
 */
export type MailRequestedPayload =
  | {
      readonly version: number
      readonly kind: 'magic-link'
      readonly to: string
      readonly url: string
      readonly purpose: MagicLinkPurpose
    }
  | {
      readonly version: number
      readonly kind: 'account-exists'
      readonly to: string
      readonly signInUrl: string
    }

const MAGIC_LINK_PURPOSES = new Set<string>(['sign-in', 'email-verification', 'password-reset'])

function readString(payload: unknown, key: string): string | null {
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const publishedReader = createVersionedReader<DocumentPublishedPayload>({
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    const revision = readString(payload, 'revision')
    const publishedBy = readString(payload, 'publishedBy')
    if (documentId === null || workspaceId === null || revision === null || publishedBy === null) {
      return null
    }
    return {
      version: EVENT_PAYLOAD_VERSION,
      documentId: documentId as DocumentId,
      workspaceId: workspaceId as WorkspaceId,
      revision: revision as RevisionId,
      publishedBy: publishedBy as UserId,
    }
  },
})

const renamedReader = createVersionedReader<DocumentRenamedPayload>({
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    const to = readString(payload, 'to')
    if (documentId === null || workspaceId === null || to === null) return null
    return {
      version: EVENT_PAYLOAD_VERSION,
      documentId: documentId as DocumentId,
      workspaceId: workspaceId as WorkspaceId,
      from: readString(payload, 'from') ?? '',
      to,
    }
  },
})

const movedReader = createVersionedReader<DocumentMovedPayload>({
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    if (documentId === null || workspaceId === null) return null
    return {
      version: EVENT_PAYLOAD_VERSION,
      documentId: documentId as DocumentId,
      workspaceId: workspaceId as WorkspaceId,
      fromCollectionId: readString(payload, 'fromCollectionId'),
      toCollectionId: readString(payload, 'toCollectionId'),
    }
  },
})

const nestedReader = createVersionedReader<DocumentNestedPayload>({
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    if (documentId === null || workspaceId === null) return null
    return {
      version: EVENT_PAYLOAD_VERSION,
      documentId: documentId as DocumentId,
      workspaceId: workspaceId as WorkspaceId,
      fromParentId: readString(payload, 'fromParentId') as DocumentId | null,
      toParentId: readString(payload, 'toParentId') as DocumentId | null,
    }
  },
})

const deletedReader = createVersionedReader<DocumentDeletedPayload>({
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    if (documentId === null || workspaceId === null) return null
    return {
      version: EVENT_PAYLOAD_VERSION,
      documentId: documentId as DocumentId,
      workspaceId: workspaceId as WorkspaceId,
      parentId: readString(payload, 'parentId') as DocumentId | null,
      collectionId: readString(payload, 'collectionId'),
    }
  },
})

const revisedReader = createVersionedReader<AttachmentRevisedPayload>({
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const attachmentId = readString(payload, 'attachmentId')
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    const attachmentVersion = (payload as Record<string, unknown>)['attachmentVersion']
    if (attachmentId === null || documentId === null || workspaceId === null) return null
    if (typeof attachmentVersion !== 'number') return null
    return {
      version: EVENT_PAYLOAD_VERSION,
      attachmentId,
      documentId: documentId as DocumentId,
      workspaceId: workspaceId as WorkspaceId,
      attachmentVersion,
    }
  },
})

const mailReader = createVersionedReader<MailRequestedPayload>({
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const to = readString(payload, 'to')
    if (to === null) return null
    if (readString(payload, 'kind') === 'account-exists') {
      const signInUrl = readString(payload, 'signInUrl')
      return signInUrl === null
        ? null
        : { version: EVENT_PAYLOAD_VERSION, kind: 'account-exists', to, signInUrl }
    }
    const url = readString(payload, 'url')
    const purpose = readString(payload, 'purpose')
    if (url === null || purpose === null || !MAGIC_LINK_PURPOSES.has(purpose)) return null
    return {
      version: EVENT_PAYLOAD_VERSION,
      kind: 'magic-link',
      to,
      url,
      purpose: purpose as MagicLinkPurpose,
    }
  },
})

/** A `MailRequested` payload, or null when it is not one this release can read. */
export function parseMailRequested(payload: unknown): MailRequestedPayload | null {
  return mailReader.read(payload)
}

/**
 * A `DocumentPublished` payload, or null when it is not one this release can
 * read. An unreadable event is left for a release that understands it rather
 * than failing the consumer for ever.
 */
export function parseDocumentPublished(payload: unknown): DocumentPublishedPayload | null {
  return publishedReader.read(payload)
}

/** A `DocumentRenamed` payload, or null when it is not one this release can read. */
export function parseDocumentRenamed(payload: unknown): DocumentRenamedPayload | null {
  return renamedReader.read(payload)
}

/** A `DocumentMoved` payload, or null when it is not one this release can read. */
export function parseDocumentMoved(payload: unknown): DocumentMovedPayload | null {
  return movedReader.read(payload)
}

/** An `AttachmentRevised` payload, or null when it is not one this release can read. */
export function parseAttachmentRevised(payload: unknown): AttachmentRevisedPayload | null {
  return revisedReader.read(payload)
}

/** A `DocumentNested` payload, or null when it is not one this release can read. */
export function parseDocumentNested(payload: unknown): DocumentNestedPayload | null {
  return nestedReader.read(payload)
}

/** A `DocumentDeleted` payload, or null when it is not one this release can read. */
export function parseDocumentDeleted(payload: unknown): DocumentDeletedPayload | null {
  return deletedReader.read(payload)
}

const REVIEWER_KINDS = new Set<string>(['user', 'group'])

const reviewRequestedReader = createVersionedReader<ReviewRequestedPayload>({
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const requestId = readString(payload, 'requestId')
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    const requestedBy = readString(payload, 'requestedBy')
    const reviewers = (payload as Record<string, unknown>)['reviewers']
    if (requestId === null || documentId === null || workspaceId === null) return null
    if (requestedBy === null || !Array.isArray(reviewers)) return null
    const readable = reviewers.flatMap((reviewer: unknown) => {
      if (typeof reviewer !== 'object' || reviewer === null) return []
      const kind = readString(reviewer, 'kind')
      const id = readString(reviewer, 'id')
      return kind !== null && id !== null && REVIEWER_KINDS.has(kind)
        ? [{ kind: kind as ReviewerKind, id }]
        : []
    })
    return {
      version: EVENT_PAYLOAD_VERSION,
      requestId,
      documentId: documentId as DocumentId,
      workspaceId: workspaceId as WorkspaceId,
      requestedBy: requestedBy as UserId,
      reviewers: readable,
    }
  },
})

const reviewDecidedReader = createVersionedReader<ReviewDecidedPayload>({
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const requestId = readString(payload, 'requestId')
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    const decidedBy = readString(payload, 'decidedBy')
    const decision = readString(payload, 'decision')
    const status = readString(payload, 'status')
    if (requestId === null || documentId === null || workspaceId === null) return null
    if (decidedBy === null || status === null) return null
    if (decision !== 'approve' && decision !== 'request_changes') return null
    return {
      version: EVENT_PAYLOAD_VERSION,
      requestId,
      documentId: documentId as DocumentId,
      workspaceId: workspaceId as WorkspaceId,
      decidedBy: decidedBy as UserId,
      decision,
      status: status as ReviewStatus,
    }
  },
})

const reviewWithdrawnReader = createVersionedReader<ReviewWithdrawnPayload>({
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const requestId = readString(payload, 'requestId')
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    const withdrawnBy = readString(payload, 'withdrawnBy')
    if (requestId === null || documentId === null || workspaceId === null) return null
    if (withdrawnBy === null) return null
    return {
      version: EVENT_PAYLOAD_VERSION,
      requestId,
      documentId: documentId as DocumentId,
      workspaceId: workspaceId as WorkspaceId,
      withdrawnBy: withdrawnBy as UserId,
      reason: readString(payload, 'reason') === 'superseded' ? 'superseded' : 'withdrawn',
    }
  },
})

/** A `ReviewRequested` payload, or null when it is not one this release can read. */
export function parseReviewRequested(payload: unknown): ReviewRequestedPayload | null {
  return reviewRequestedReader.read(payload)
}

/** A `ReviewDecided` payload, or null when it is not one this release can read. */
export function parseReviewDecided(payload: unknown): ReviewDecidedPayload | null {
  return reviewDecidedReader.read(payload)
}

/** A `ReviewWithdrawn` payload, or null when it is not one this release can read. */
export function parseReviewWithdrawn(payload: unknown): ReviewWithdrawnPayload | null {
  return reviewWithdrawnReader.read(payload)
}
