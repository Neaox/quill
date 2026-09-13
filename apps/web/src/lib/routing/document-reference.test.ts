import { describe, expect, it } from 'vitest'

import {
  documentIdFromReference,
  documentLink,
  documentReference,
  parseDocumentReference,
  workspaceLink,
} from './document-reference.ts'

const KEY = 'k7m3q9v2rt'
const UUID = '0d1c2b3a-4e5f-6a7b-8c9d-0e1f2a3b4c5d'

describe('parseDocumentReference', () => {
  it('reads the key from the last segment, whatever the title did to the slug', () => {
    expect(parseDocumentReference(`authentication-architecture-${KEY}`)).toEqual({
      kind: 'key',
      key: KEY,
      slug: 'authentication-architecture',
    })
  })

  it('accepts the bare key, because the words are optional', () => {
    expect(parseDocumentReference(KEY)).toEqual({ kind: 'key', key: KEY, slug: '' })
  })

  it('reads a title that ends in a number without mistaking it for the key', () => {
    expect(parseDocumentReference(`quarterly-plan-2026-${KEY}`)).toEqual({
      kind: 'key',
      key: KEY,
      slug: 'quarterly-plan-2026',
    })
  })

  it('still resolves a bare UUID, because every link that exists today is one', () => {
    expect(parseDocumentReference(UUID)).toEqual({ kind: 'id', id: UUID })
  })

  it('refuses a reference whose tail is neither a key nor a whole id', () => {
    expect(parseDocumentReference('authentication-architecture')).toEqual({ kind: 'unknown' })
    // Nine characters, and one that Crockford's alphabet leaves out.
    expect(parseDocumentReference(`page-k7m3q9v2r`)).toEqual({ kind: 'unknown' })
    expect(parseDocumentReference(`page-k7m3q9v2ri`)).toEqual({ kind: 'unknown' })
  })

  it('answers what the API should be asked for', () => {
    expect(documentIdFromReference(parseDocumentReference(`page-${KEY}`))).toBe(KEY)
    expect(documentIdFromReference(parseDocumentReference(UUID))).toBe(UUID)
    expect(documentIdFromReference(parseDocumentReference('nonsense'))).toBeUndefined()
  })
})

describe('documentReference', () => {
  it('builds the canonical form from the current title and the key', () => {
    expect(
      documentReference({ id: UUID, title: 'Authentication architecture', shortId: KEY }),
    ).toBe(`authentication-architecture-${KEY}`)
  })

  it('is the bare key for a title that slugifies to nothing', () => {
    expect(documentReference({ id: UUID, title: '¿!—', shortId: KEY })).toBe(KEY)
  })

  it('round-trips: what it builds is what the parser reads', () => {
    const reference = documentReference({ id: UUID, title: 'Release notes 2026', shortId: KEY })
    expect(parseDocumentReference(reference)).toEqual({
      kind: 'key',
      key: KEY,
      slug: 'release-notes-2026',
    })
  })
})

describe('workspaceLink and documentLink', () => {
  it('describe a place as a route pattern and its parameters, never as a built URL', () => {
    expect(workspaceLink('engineering')).toEqual({
      to: '/w/$workspaceSlug',
      params: { workspaceSlug: 'engineering' },
    })
    expect(documentLink('engineering', `authentication-${KEY}`)).toEqual({
      to: '/w/$workspaceSlug/d/$documentId',
      params: { workspaceSlug: 'engineering', documentId: `authentication-${KEY}` },
      search: {},
    })
  })

  it('names a revision in the search params rather than in the path', () => {
    expect(documentLink('engineering', KEY, { rev: 'abc123' }).search).toEqual({ rev: 'abc123' })
  })

  it('reads the newest revision with no search params at all, so one page has one address', () => {
    expect(documentLink('engineering', KEY, { rev: undefined }).search).toEqual({})
  })
})
