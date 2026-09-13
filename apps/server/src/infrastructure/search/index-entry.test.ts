import type { IndexableDocument } from '@quill/application'
import { collectionId, documentId, revisionId, workspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { toIndexRow } from './index-entry.ts'

const DOCUMENT = documentId('11111111-1111-4111-8111-111111111111')
const REVISION = revisionId('a'.repeat(40))
const UPDATED_AT = new Date('2026-01-01T00:00:00.000Z')
const INDEXED_AT = new Date('2026-02-01T00:00:00.000Z')

const INDEXABLE: IndexableDocument = {
  version: 1,
  documentId: DOCUMENT,
  revision: REVISION,
  workspaceId: workspaceId('22222222-2222-4222-8222-222222222222'),
  collectionId: collectionId('33333333-3333-4333-8333-333333333333'),
  path: 'runbooks/failover.md',
  title: 'Database failover',
  headings: [
    { text: 'Detect', depth: 1, weight: 6 },
    { text: 'Promote', depth: 6, weight: 1 },
  ],
  body: 'Promote the replica.',
  tags: ['Runbook', 'runbook', 'Database'],
  owners: ['Ada Lovelace'],
  status: 'published',
  updatedAt: UPDATED_AT,
}

describe('an index entry', () => {
  it('repeats a heading by its depth weight, so an h1 outranks an h6 within one column', () => {
    const row = toIndexRow({ document: INDEXABLE, indexedAt: INDEXED_AT })
    expect(row.headings).toBe('Detect Detect Detect Detect Detect Detect Promote')
  })

  it('folds tags and owners to lower case and de-duplicates them', () => {
    const row = toIndexRow({ document: INDEXABLE, indexedAt: INDEXED_AT })
    expect(row.tags).toEqual(['runbook', 'database'])
    expect(row.owners).toEqual(['ada lovelace'])
  })

  it('records the revision it was projected from, and when (ADR-034)', () => {
    const row = toIndexRow({ document: INDEXABLE, indexedAt: INDEXED_AT })
    expect(row).toMatchObject({
      documentId: DOCUMENT,
      revision: REVISION,
      indexVersion: 1,
      indexedAt: INDEXED_AT,
      updatedAt: UPDATED_AT,
      path: 'runbooks/failover.md',
      status: 'published',
    })
  })

  it('carries a document that belongs to no collection', () => {
    const row = toIndexRow({
      document: { ...INDEXABLE, collectionId: null, headings: [] },
      indexedAt: INDEXED_AT,
    })
    expect(row.collectionId).toBeNull()
    expect(row.headings).toBe('')
  })

  it('keeps the whole body when no limit is asked for, however long it is', () => {
    const body = 'word '.repeat(100_000)
    const row = toIndexRow({ document: { ...INDEXABLE, body }, indexedAt: INDEXED_AT })
    expect(row.body).toBe(body)
  })

  it('cuts a body to a byte budget on a character boundary', () => {
    // Three bytes per character, so a byte budget that is not a multiple of
    // three falls inside one and has to be cut back to the boundary.
    const body = '。'.repeat(100)
    const row = toIndexRow({
      document: { ...INDEXABLE, body },
      indexedAt: INDEXED_AT,
      bodyByteLimit: 100,
    })
    expect(row.body).toBe('。'.repeat(33))
    expect(Buffer.byteLength(row.body, 'utf8')).toBeLessThanOrEqual(100)
  })

  it('leaves a body already inside the budget exactly as it was', () => {
    const row = toIndexRow({ document: INDEXABLE, indexedAt: INDEXED_AT, bodyByteLimit: 1_000 })
    expect(row.body).toBe('Promote the replica.')
  })
})
