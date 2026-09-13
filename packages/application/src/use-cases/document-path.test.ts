import { describe, expect, it } from 'vitest'
import { documentId, shortId, workspaceId } from '@quill/domain'

import {
  canonicaliseDocumentLinks,
  directoryOf,
  documentIdFromUrl,
  documentPath,
  documentPathCandidates,
  documentReference,
  documentReferenceFromUrl,
  documentUrl,
  linkedDocumentIds,
  linkedDocumentReferences,
  MAX_PATH_ATTEMPTS,
  namedSlug,
  parseDocumentReference,
  UNTITLED_SLUG,
  workspaceLinkReferences,
} from './document-path.ts'
import type { DocumentRow } from '../ports/persistence.ts'

const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
const NOW = new Date('2026-01-01T00:00:00.000Z')

const KEY = shortId('k7m3q9v2xd')
const OTHER_KEY = shortId('b4n8t2w6yz')

const parent: DocumentRow = {
  id: DOC,
  shortId: KEY,
  workspaceId: WORKSPACE,
  collectionId: 'collection-1',
  parentId: null,
  slug: 'authentication',
  path: 'architecture/authentication.md',
  title: 'Authentication',
  status: 'published',
  templateId: null,
  templateVersion: null,
  headRevision: null,
  createdAt: NOW,
  updatedAt: NOW,
}

describe('namedSlug', () => {
  it('is the shared slug for anything that has to be called something', () => {
    expect(namedSlug('Regional failover runbook')).toBe('regional-failover-runbook')
  })

  it('falls back to a word when a title leaves nothing behind', () => {
    expect(namedSlug('???')).toBe(UNTITLED_SLUG)
  })
})

describe('documentPath', () => {
  it('puts a top-level document beside its collection and a child inside its parent', () => {
    expect(
      documentPath({
        workspaceId: WORKSPACE,
        collectionSlug: 'architecture',
        parent: null,
        slug: 'authentication',
      }),
    ).toBe('architecture/authentication.md')

    expect(
      documentPath({
        workspaceId: WORKSPACE,
        collectionSlug: 'architecture',
        parent,
        slug: 'tokens',
      }),
    ).toBe('architecture/authentication/tokens.md')
  })

  it('reads a directory from a path with or without the Markdown suffix', () => {
    expect(directoryOf('architecture/authentication.md')).toBe('architecture/authentication')
    expect(directoryOf('architecture')).toBe('architecture')
  })
})

describe('documentPathCandidates', () => {
  const placement = {
    workspaceId: WORKSPACE,
    collectionSlug: 'architecture',
    parent: null,
    slug: 'authentication',
  }

  it('offers the plain path first and numbers the ones after it', () => {
    expect([...documentPathCandidates(placement, 3)]).toEqual([
      { slug: 'authentication', path: 'architecture/authentication.md' },
      { slug: 'authentication-2', path: 'architecture/authentication-2.md' },
      { slug: 'authentication-3', path: 'architecture/authentication-3.md' },
    ])
  })

  it('is bounded, so a path nobody can take ends in an answer rather than a spin', () => {
    expect([...documentPathCandidates(placement)]).toHaveLength(MAX_PATH_ATTEMPTS)
  })
})

describe('linkedDocumentIds', () => {
  it('finds every document a body names, once each, and nothing that is not one', () => {
    const other = documentId('00000000-0000-4000-8000-000000000202')
    const markdown = [
      `See [the runbook](/d/${DOC}) and [it again](/d/${DOC.toUpperCase()}#step-2).`,
      `Also [](/d/${other}), [the guide](/guides/on-call), and https://example.com/d/nope.`,
    ].join('\n')
    expect([...linkedDocumentIds(markdown)]).toEqual([DOC, other])
    expect([...linkedDocumentIds('nothing here')]).toEqual([])
    // A readable link names a document too, but not by an id anybody can read
    // off it, so it is not one of these.
    expect([...linkedDocumentIds(`[a](/d/${DOC}) [b](/d/notes-${KEY})`)]).toEqual([DOC])
  })
})

describe('canonical document URLs', () => {
  it('round trips an id, and reports anything else as not a document link', () => {
    expect(documentUrl(DOC)).toBe(`/d/${DOC}`)
    expect(documentIdFromUrl(documentUrl(DOC))).toBe(DOC)
    expect(documentIdFromUrl(`/d/${DOC.toUpperCase()}#section`)).toBe(DOC)
    expect(documentIdFromUrl('https://example.com')).toBeNull()
    expect(documentIdFromUrl('/d/not-a-uuid')).toBeNull()
  })
})

describe('parseDocumentReference', () => {
  it('reads the key off the end of the words', () => {
    expect(parseDocumentReference(`authentication-architecture-${KEY}`)).toEqual({
      kind: 'short-id',
      shortId: KEY,
    })
  })

  it('reads a bare key, and a key typed in its confusable form', () => {
    expect(parseDocumentReference(KEY)).toEqual({ kind: 'short-id', shortId: KEY })
    expect(parseDocumentReference('K7M3Q9V2XD')).toEqual({ kind: 'short-id', shortId: KEY })
  })

  it('reads the UUID form every older link carries', () => {
    expect(parseDocumentReference(DOC.toUpperCase())).toEqual({ kind: 'uuid', documentId: DOC })
  })

  it('reads nothing else', () => {
    expect(parseDocumentReference('getting-started')).toBeNull()
    expect(parseDocumentReference('')).toBeNull()
  })
})

describe('documentReference', () => {
  it('is the words and then the key', () => {
    expect(documentReference({ title: 'Authentication architecture', shortId: KEY })).toBe(
      `authentication-architecture-${KEY}`,
    )
  })

  it('is the key alone when a title leaves no words', () => {
    expect(documentReference({ title: '???', shortId: KEY })).toBe(KEY)
  })
})

describe('documentReferenceFromUrl', () => {
  it('reads a canonical link, a readable link, and a workspace-prefixed link', () => {
    expect(documentReferenceFromUrl(`/d/${DOC}`)).toEqual({ kind: 'uuid', documentId: DOC })
    expect(documentReferenceFromUrl(`/d/notes-${KEY}`)).toEqual({ kind: 'short-id', shortId: KEY })
    expect(documentReferenceFromUrl(`/w/engineering/d/notes-${KEY}#section`)).toEqual({
      kind: 'short-id',
      shortId: KEY,
    })
  })

  it('reads nothing out of a URL that names no document', () => {
    expect(documentReferenceFromUrl('/guides/on-call')).toBeNull()
    expect(documentReferenceFromUrl('https://example.com/d/nope')).toBeNull()
  })
})

describe('linkedDocumentReferences', () => {
  it('finds both forms, once each', () => {
    const markdown = `[a](/d/${DOC}) [b](/w/eng/d/notes-${KEY}) [c](/d/${KEY}) [d](/d/${DOC})`
    expect([...linkedDocumentReferences(markdown)]).toEqual([
      { kind: 'uuid', documentId: DOC },
      { kind: 'short-id', shortId: KEY },
    ])
  })
})

describe('workspaceLinkReferences', () => {
  it('finds the references an author pasted out of the address bar, once each', () => {
    const markdown = [
      `[a](/w/engineering/d/notes-${KEY})`,
      `[b](/w/platform/d/${DOC})`,
      `[c](/w/engineering/d/notes-${KEY})`,
      `[d](/d/${OTHER_KEY})`,
    ].join('\n')
    expect([...workspaceLinkReferences(markdown)]).toEqual([`notes-${KEY}`, DOC])
  })
})

describe('canonicaliseDocumentLinks', () => {
  const other = documentId('00000000-0000-4000-8000-000000000202')

  it('rewrites a resolved reference to the canonical id URL', () => {
    const markdown = `See [the runbook](/w/engineering/d/notes-${KEY}).`
    expect(canonicaliseDocumentLinks(markdown, new Map([[`notes-${KEY}`, other]]))).toBe(
      `See [the runbook](/d/${other}).`,
    )
  })

  it('leaves a reference nothing resolved exactly as it was', () => {
    const markdown = `See [the runbook](/w/engineering/d/notes-${OTHER_KEY}).`
    expect(canonicaliseDocumentLinks(markdown, new Map())).toBe(markdown)
  })

  it('leaves canonical links alone', () => {
    const markdown = `See [the runbook](/d/${other}).`
    expect(canonicaliseDocumentLinks(markdown, new Map([[String(other), other]]))).toBe(markdown)
  })
})
