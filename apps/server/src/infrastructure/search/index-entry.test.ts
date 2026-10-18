import type { IndexableDocument } from '@quill/application'
import { collectionId, documentId, revisionId, workspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { toIndexRow } from './index-entry.ts'

const DOCUMENT = documentId('11111111-1111-4111-8111-111111111111')
const REVISION = revisionId('a'.repeat(40))
const UPDATED_AT = new Date('2026-01-01T00:00:00.000Z')
const INDEXED_AT = new Date('2026-02-01T00:00:00.000Z')

const INDEXABLE: IndexableDocument = {
  version: 3,
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
  tags: ['Runbook', 'runbook', 'Database', 'Area/Billing'],
  owners: ['Ada Lovelace'],
  status: 'published',
  updatedAt: UPDATED_AT,
  contributors: [
    { name: 'Ada Lovelace', email: 'ada@example.com' },
    { name: 'Sam Taylor', email: 'sam@example.com' },
  ],
  properties: { severity: ['high'], regions: ['eu', 'us'] },
}

describe('an index entry', () => {
  it('repeats a heading by its depth weight, so an h1 outranks an h6 within one column', () => {
    const row = toIndexRow({ document: INDEXABLE, indexedAt: INDEXED_AT })
    expect(row.headings).toBe('Detect Detect Detect Detect Detect Detect Promote')
  })

  it('folds tags and owners to lower case and de-duplicates them', () => {
    const row = toIndexRow({ document: INDEXABLE, indexedAt: INDEXED_AT })
    expect(row.tags).toEqual(['runbook', 'database', 'area/billing'])
    expect(row.owners).toEqual(['ada lovelace'])
  })

  it('keeps every tag and its ancestors for the hierarchy, from the one function that reads a tag', () => {
    const row = toIndexRow({ document: INDEXABLE, indexedAt: INDEXED_AT })
    expect(row.tagPaths).toEqual(['runbook', 'database', 'area', 'area/billing'])
  })

  it('stores the properties as the projection folded them', () => {
    const row = toIndexRow({ document: INDEXABLE, indexedAt: INDEXED_AT })
    expect(row.properties).toEqual({ severity: ['high'], regions: ['eu', 'us'] })
  })

  it('keeps the addresses of those who published for exact matching, one line of names for substring matching', () => {
    const row = toIndexRow({ document: INDEXABLE, indexedAt: INDEXED_AT })
    expect(row.contributorEmails).toEqual(['ada@example.com', 'sam@example.com'])
    // A line per person, lower case, name then address: a needle cannot run
    // from one person into the next, because it has no line break in it.
    expect(row.contributorsText).toBe('ada lovelace ada@example.com\nsam taylor sam@example.com')
  })

  it('has no one to name for a document nobody is recorded as publishing', () => {
    const row = toIndexRow({ document: { ...INDEXABLE, contributors: [] }, indexedAt: INDEXED_AT })
    expect(row.contributorEmails).toEqual([])
    expect(row.contributorsText).toBe('')
  })

  it('records the revision it was projected from, and when (ADR-034)', () => {
    const row = toIndexRow({ document: INDEXABLE, indexedAt: INDEXED_AT })
    expect(row).toMatchObject({
      documentId: DOCUMENT,
      revision: REVISION,
      indexVersion: 3,
      indexedAt: INDEXED_AT,
      updatedAt: UPDATED_AT,
      path: 'runbooks/failover.md',
      status: 'published',
    })
  })

  it('carries the summary and icon a child pages list shows, or null for none (ADR-058)', () => {
    expect(
      toIndexRow({
        document: { ...INDEXABLE, summary: 'Promote it.', icon: '🛟' },
        indexedAt: INDEXED_AT,
      }),
    ).toMatchObject({ summary: 'Promote it.', icon: '🛟' })
    expect(toIndexRow({ document: INDEXABLE, indexedAt: INDEXED_AT })).toMatchObject({
      summary: null,
      icon: null,
    })
  })

  it('carries the author’s lifecycle, or null for none', () => {
    expect(
      toIndexRow({ document: { ...INDEXABLE, lifecycle: 'deprecated' }, indexedAt: INDEXED_AT }),
    ).toMatchObject({ lifecycle: 'deprecated', status: 'published' })
    expect(toIndexRow({ document: INDEXABLE, indexedAt: INDEXED_AT })).toMatchObject({
      lifecycle: null,
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
