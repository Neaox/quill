import type { DocumentId, RevisionId, UserId, WorkspaceId } from '@quill/domain'

import type { MagicLinkPurpose } from '../ports/persistence.ts'
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
