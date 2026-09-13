/**
 * The two entry points, checked as contracts rather than as re-exports: the
 * public barrel must not offer Git vocabulary (AGENTS.md rule 9), and the
 * internal one must keep offering it, because a revisions-index rebuild reads
 * commit trailers directly (ADR-014).
 */

import { documentId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import * as internal from './internal.ts'
import * as published from './index.ts'

const DOCUMENT = documentId('018f4c1e-7c3a-7c1d-9b2e-1f2a3b4c5d6e')

const GIT_VOCABULARY = [
  'walkCommits',
  'parseTrailers',
  'hashObject',
  'serialiseObject',
  'parseContentPath',
  'GitRepository',
  'DEFAULT_REF',
]

describe('the public entry point', () => {
  it('offers the adapter, its backends, their options, and their errors', () => {
    expect(Object.keys(published).toSorted()).toEqual([
      'ContentPathError',
      'ContentStoreError',
      'FilesystemObjectStore',
      'FilesystemObjectStoreProvider',
      'GitContentStore',
      'GitObjectError',
      'LeakedLockError',
      'MemoryObjectStore',
      'MemoryObjectStoreProvider',
      'RefLockPackingHook',
    ])
  })

  it('offers no Git vocabulary at all', () => {
    expect(Object.keys(published).filter((name) => GIT_VOCABULARY.includes(name))).toEqual([])
  })
})

describe('the internal entry point', () => {
  it('offers the Git vocabulary a repository tool needs', () => {
    for (const name of GIT_VOCABULARY) expect(internal).toHaveProperty(name)
  })

  it('reads a commit trailer, which is what an index rebuild does', () => {
    const message = internal.buildCommitMessage({
      changes: [{ kind: 'delete', documentId: DOCUMENT, path: 'a.md' }],
      changeNote: 'Superseded.',
    })
    const trailers = internal.parseTrailers(message)
    expect(internal.trailerValues(trailers, internal.DOCUMENT_ID_TRAILER)).toEqual([DOCUMENT])
    expect(internal.changedDocumentIds(trailers)).toEqual([DOCUMENT])
  })
})
