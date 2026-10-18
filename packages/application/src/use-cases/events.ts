import { ROLES } from '@quill/domain'
import type {
  DocumentId,
  ReviewDecision,
  ReviewerKind,
  ReviewStatus,
  RevisionId,
  Role,
  UserId,
  WorkspaceId,
} from '@quill/domain'

import { defineEvent } from '../events/define-event.ts'
import type { EventPayloadInput } from '../events/define-event.ts'
import type {
  CollectionId,
  GrantEffect,
  GrantRow,
  MagicLinkPurpose,
  PrincipalKind,
  ScopeKind,
} from '../ports/persistence.ts'

/**
 * Every event Quill emits (plan §22, ADR-056).
 *
 * Each is one `defineEvent`: its type name, the version this release writes,
 * and a reader for every version ever shipped (ADR-033) — an event written by
 * one release is read by a consumer running a later one, so the shape can
 * grow but never silently change meaning. The `X` constants and `parseX`
 * functions below are those definitions under the names the rest of the code
 * already uses.
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
 * An attachment's bytes were replaced by a new revision under the same URL
 * (ADR-043). Every published body that shows it changes without being
 * republished, so what was derived from those bodies — the search index, the
 * public site's cached pages — is brought up to date from this.
 */
export const ATTACHMENT_REVISED = 'AttachmentRevised'

export const DOCUMENT_DELETED = 'DocumentDeleted'
export const COLLECTION_DELETED = 'CollectionDeleted'

/**
 * Who may read what changed (ADR-012). The two are events of their own rather
 * than one "grant changed" because what is derived from them treats them
 * differently, and because a revoke is the one that must not be late: a stale
 * cache after a grant is a page nobody can reach, and after a revoke it is a
 * page somebody still can.
 */
export const GRANT_CREATED = 'GrantCreated'
export const GRANT_REVOKED = 'GrantRevoked'

/**
 * A link preview is wanted (ADR-042). Fetching a stranger's page is slow, can
 * fail, and must not happen while a reader waits, so a miss queues this and the
 * reader is shown a plain link meanwhile. The outbox gives it retries with
 * backoff and a dead letter for free.
 */
export const LINK_PREVIEW_REQUESTED = 'LinkPreviewRequested'

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

export interface AttachmentRevisedPayload {
  readonly version: number
  readonly attachmentId: string
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  /** The attachment's own version after the revision. */
  readonly attachmentVersion: number
}

export interface DocumentDeletedPayload {
  readonly version: number
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly collectionId: string | null
  readonly deletedBy: UserId | null
}

export interface CollectionDeletedPayload {
  readonly version: number
  readonly collectionId: string
  readonly workspaceId: WorkspaceId
  readonly deletedBy: UserId | null
}

/**
 * A grant, as it was: the row is gone once a revoke has happened, and what is
 * derived from it still has to know which scope and which principal to look at.
 */
export interface GrantChangedPayload {
  readonly version: number
  readonly grantId: string
  readonly principalKind: PrincipalKind
  readonly principalId: string | null
  readonly scopeKind: ScopeKind
  readonly scopeId: string | null
  readonly role: Role
  readonly effect: GrantEffect
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

const MAGIC_LINK_PURPOSES = ['sign-in', 'email-verification', 'password-reset'] as const
const PRINCIPAL_KINDS = ['user', 'group', 'public', 'share_link'] as const
const SCOPE_KINDS = ['instance', 'unit', 'workspace', 'collection', 'document'] as const
const GRANT_EFFECTS = ['allow', 'deny'] as const

function readField(payload: unknown, key: string): unknown {
  return (payload as Record<string, unknown>)[key]
}

function readString(payload: unknown, key: string): string | null {
  const value = readField(payload, key)
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** One of a closed set of strings, found by comparison rather than asserted. */
function readMember<T extends string>(
  payload: unknown,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = readField(payload, key)
  return allowed.find((member) => member === value) ?? null
}

export const documentCreated = defineEvent<DocumentCreatedPayload>(DOCUMENT_CREATED, {
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    const title = readString(payload, 'title')
    const createdBy = readString(payload, 'createdBy')
    if (documentId === null || workspaceId === null || title === null || createdBy === null) {
      return null
    }
    return {
      version: EVENT_PAYLOAD_VERSION,
      documentId: documentId as DocumentId,
      workspaceId: workspaceId as WorkspaceId,
      title,
      createdBy: createdBy as UserId,
    }
  },
})

export const documentPublished = defineEvent<DocumentPublishedPayload>(DOCUMENT_PUBLISHED, {
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

export const documentRenamed = defineEvent<DocumentRenamedPayload>(DOCUMENT_RENAMED, {
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

export const documentMoved = defineEvent<DocumentMovedPayload>(DOCUMENT_MOVED, {
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

export const attachmentRevised = defineEvent<AttachmentRevisedPayload>(ATTACHMENT_REVISED, {
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const attachmentId = readString(payload, 'attachmentId')
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    const attachmentVersion = readField(payload, 'attachmentVersion')
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

export const documentDeleted = defineEvent<DocumentDeletedPayload>(DOCUMENT_DELETED, {
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    if (documentId === null || workspaceId === null) return null
    return {
      version: EVENT_PAYLOAD_VERSION,
      documentId: documentId as DocumentId,
      workspaceId: workspaceId as WorkspaceId,
      collectionId: readString(payload, 'collectionId'),
      deletedBy: readString(payload, 'deletedBy') as UserId | null,
    }
  },
})

export const collectionDeleted = defineEvent<CollectionDeletedPayload>(COLLECTION_DELETED, {
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const collectionId = readString(payload, 'collectionId')
    const workspaceId = readString(payload, 'workspaceId')
    if (collectionId === null || workspaceId === null) return null
    return {
      version: EVENT_PAYLOAD_VERSION,
      collectionId,
      workspaceId: workspaceId as WorkspaceId,
      deletedBy: readString(payload, 'deletedBy') as UserId | null,
    }
  },
})

/** The reader both grant events share: they carry the same snapshot of the grant. */
function readGrantChanged(payload: unknown): GrantChangedPayload | null {
  const grantId = readString(payload, 'grantId')
  const principalKind = readMember(payload, 'principalKind', PRINCIPAL_KINDS)
  const scopeKind = readMember(payload, 'scopeKind', SCOPE_KINDS)
  const role = readMember(payload, 'role', ROLES)
  const effect = readMember(payload, 'effect', GRANT_EFFECTS)
  if (
    grantId === null ||
    principalKind === null ||
    scopeKind === null ||
    role === null ||
    effect === null
  ) {
    return null
  }
  return {
    version: EVENT_PAYLOAD_VERSION,
    grantId,
    principalKind,
    principalId: readString(payload, 'principalId'),
    scopeKind,
    scopeId: readString(payload, 'scopeId'),
    role,
    effect,
  }
}

/**
 * A grant row as the payload of the event that reports it. One function for
 * both events, so what a revoke says about the grant is exactly what its
 * creation said.
 */
export function grantChange(grant: GrantRow): EventPayloadInput<GrantChangedPayload> {
  return {
    grantId: grant.id,
    principalKind: grant.principalKind,
    principalId: grant.principalId,
    scopeKind: grant.scopeKind,
    scopeId: grant.scopeId,
    role: grant.role,
    effect: grant.effect,
  }
}

export const grantCreated = defineEvent<GrantChangedPayload>(GRANT_CREATED, {
  [EVENT_PAYLOAD_VERSION]: readGrantChanged,
})

export const grantRevoked = defineEvent<GrantChangedPayload>(GRANT_REVOKED, {
  [EVENT_PAYLOAD_VERSION]: readGrantChanged,
})

export const mailRequested = defineEvent<MailRequestedPayload>(
  MAIL_REQUESTED,
  {
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
      const purpose = readMember(payload, 'purpose', MAGIC_LINK_PURPOSES)
      if (url === null || purpose === null) return null
      return { version: EVENT_PAYLOAD_VERSION, kind: 'magic-link', to, url, purpose }
    },
  },
  // A magic link's payload carries its token (ADR-011), which is in the
  // database only until the mail is sent and has no business on a bus.
  { announced: false },
)

const REVIEWER_KINDS = ['user', 'group'] as const
const REVIEW_DECISIONS = ['approve', 'request_changes'] as const

export const reviewRequested = defineEvent<ReviewRequestedPayload>(REVIEW_REQUESTED, {
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const requestId = readString(payload, 'requestId')
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    const requestedBy = readString(payload, 'requestedBy')
    const reviewers = readField(payload, 'reviewers')
    if (requestId === null || documentId === null || workspaceId === null) return null
    if (requestedBy === null || !Array.isArray(reviewers)) return null
    const readable = reviewers.flatMap((reviewer: unknown) => {
      if (typeof reviewer !== 'object' || reviewer === null) return []
      const kind = readMember(reviewer, 'kind', REVIEWER_KINDS)
      const id = readString(reviewer, 'id')
      return kind !== null && id !== null ? [{ kind, id }] : []
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

export const reviewDecided = defineEvent<ReviewDecidedPayload>(REVIEW_DECIDED, {
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    const requestId = readString(payload, 'requestId')
    const documentId = readString(payload, 'documentId')
    const workspaceId = readString(payload, 'workspaceId')
    const decidedBy = readString(payload, 'decidedBy')
    const decision = readMember(payload, 'decision', REVIEW_DECISIONS)
    const status = readString(payload, 'status')
    if (requestId === null || documentId === null || workspaceId === null) return null
    if (decidedBy === null || status === null || decision === null) return null
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

export const reviewWithdrawn = defineEvent<ReviewWithdrawnPayload>(REVIEW_WITHDRAWN, {
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

/**
 * Each payload, or null when it is not one this release can read. An
 * unreadable event is left for a release that understands it rather than
 * failing the consumer for ever.
 */
export const parseMailRequested = mailRequested.parse
export const parseDocumentCreated = documentCreated.parse
export const parseDocumentPublished = documentPublished.parse
export const parseDocumentRenamed = documentRenamed.parse
export const parseDocumentMoved = documentMoved.parse
export const parseAttachmentRevised = attachmentRevised.parse
export const parseReviewRequested = reviewRequested.parse
export const parseReviewDecided = reviewDecided.parse
export const parseReviewWithdrawn = reviewWithdrawn.parse
