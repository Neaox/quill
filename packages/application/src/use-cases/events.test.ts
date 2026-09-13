import { describe, expect, it } from 'vitest'
import { documentId, revisionId, userId, workspaceId } from '@quill/domain'

import {
  EVENT_PAYLOAD_VERSION,
  parseDocumentMoved,
  parseDocumentPublished,
  parseDocumentRenamed,
  parseMailRequested,
} from './events.ts'

const DOC = documentId('00000000-0000-4000-8000-000000000201')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const USER = userId('00000000-0000-4000-8000-000000000001')
const REVISION = revisionId('a'.repeat(40))

const published = {
  version: EVENT_PAYLOAD_VERSION,
  documentId: DOC,
  workspaceId: WORKSPACE,
  revision: REVISION,
  publishedBy: USER,
}

describe('parseDocumentPublished', () => {
  it('reads a payload of the version it knows', () => {
    expect(parseDocumentPublished(published)).toEqual(published)
  })

  it('refuses anything it cannot read, rather than guessing', () => {
    expect(parseDocumentPublished(null)).toBeNull()
    expect(parseDocumentPublished('DocumentPublished')).toBeNull()
    expect(parseDocumentPublished({ ...published, version: 99 })).toBeNull()
    expect(parseDocumentPublished({ ...published, documentId: '' })).toBeNull()
    expect(parseDocumentPublished({ ...published, workspaceId: 7 })).toBeNull()
    expect(parseDocumentPublished({ ...published, revision: undefined })).toBeNull()
    expect(parseDocumentPublished({ ...published, publishedBy: null })).toBeNull()
  })
})

describe('parseDocumentRenamed', () => {
  const renamed = {
    version: EVENT_PAYLOAD_VERSION,
    documentId: DOC,
    workspaceId: WORKSPACE,
    from: 'Old',
    to: 'New',
  }

  it('reads a payload of the version it knows', () => {
    expect(parseDocumentRenamed(renamed)).toEqual(renamed)
  })

  it('treats a missing previous title as unknown but still reads the event', () => {
    expect(parseDocumentRenamed({ ...renamed, from: undefined })).toEqual({ ...renamed, from: '' })
  })

  it('refuses anything it cannot read', () => {
    expect(parseDocumentRenamed({ version: 2 })).toBeNull()
    expect(parseDocumentRenamed({ ...renamed, documentId: '' })).toBeNull()
    expect(parseDocumentRenamed({ ...renamed, workspaceId: '' })).toBeNull()
    expect(parseDocumentRenamed({ ...renamed, to: '' })).toBeNull()
  })
})

/**
 * Delivery is an outbox event (ADR-011, review finding H3), so its payload is
 * a persisted format like any other and its reader dispatches on the version.
 */
describe('parseMailRequested', () => {
  const magicLink = {
    version: EVENT_PAYLOAD_VERSION,
    kind: 'magic-link',
    to: 'ada@example.com',
    url: 'https://docs.example.com/auth/magic-link#token=abc',
    purpose: 'sign-in',
  }
  const notice = {
    version: EVENT_PAYLOAD_VERSION,
    kind: 'account-exists',
    to: 'ada@example.com',
    signInUrl: 'https://docs.example.com/auth/sign-in',
  }

  it('reads a magic link and an account-exists notice', () => {
    expect(parseMailRequested(magicLink)).toEqual(magicLink)
    expect(parseMailRequested(notice)).toEqual(notice)
  })

  it('refuses a payload missing what it needs', () => {
    expect(parseMailRequested({ version: EVENT_PAYLOAD_VERSION, kind: 'magic-link' })).toBeNull()
    expect(parseMailRequested({ ...magicLink, to: '' })).toBeNull()
    expect(parseMailRequested({ ...magicLink, url: '' })).toBeNull()
    expect(parseMailRequested({ ...notice, signInUrl: '' })).toBeNull()
  })

  /** A purpose nothing recognises is not a purpose: better unread than guessed. */
  it('refuses a purpose this release does not know', () => {
    expect(parseMailRequested({ ...magicLink, purpose: 'something-new' })).toBeNull()
    expect(parseMailRequested({ ...magicLink, purpose: '' })).toBeNull()
  })

  it('refuses a version nothing shipped can read', () => {
    expect(parseMailRequested({ ...magicLink, version: 99 })).toBeNull()
  })
})

/**
 * A move between collections changes a public address (ADR-035), so its event
 * is read the same guarded way every other persisted format is.
 */
describe('parseDocumentMoved', () => {
  const moved = {
    version: EVENT_PAYLOAD_VERSION,
    documentId: DOC,
    workspaceId: WORKSPACE,
    fromCollectionId: 'guides',
    toCollectionId: 'runbooks',
  }

  it('reads a move', () => {
    expect(parseDocumentMoved(moved)).toEqual(moved)
  })

  it('reads a move out of, or into, no collection at all', () => {
    expect(parseDocumentMoved({ ...moved, fromCollectionId: null })).toEqual({
      ...moved,
      fromCollectionId: null,
    })
    expect(parseDocumentMoved({ ...moved, toCollectionId: null })).toEqual({
      ...moved,
      toCollectionId: null,
    })
  })

  it('refuses a payload that names no document or no workspace', () => {
    expect(parseDocumentMoved({ ...moved, documentId: '' })).toBeNull()
    expect(parseDocumentMoved({ ...moved, workspaceId: '' })).toBeNull()
  })

  it('refuses a version nothing shipped can read', () => {
    expect(parseDocumentMoved({ ...moved, version: 99 })).toBeNull()
  })
})
