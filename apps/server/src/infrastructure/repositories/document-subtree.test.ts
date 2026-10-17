import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { documentId, workspaceId } from '@quill/domain'
import type { CollectionId, DocumentId } from '@quill/domain'
import { aShortId } from '@quill/application/test-support'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createCollectionRepository } from './collection-repository.ts'
import { createDocumentRepository } from './document-repository.ts'
import { createDocumentSummaryRepository } from './document-summary-repository.ts'
import { createUnitRepository } from './unit-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'

/**
 * A child pages list's two reads against a real Postgres (ADR-056): the
 * subtree in one recursive query bounded by its depth, and the summaries of
 * any number of pages in one more.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const COLLECTION = '00000000-0000-4000-8000-000000000301' as CollectionId
const id = (n: number): DocumentId =>
  documentId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

let database: TestDatabase
let documents: ReturnType<typeof createDocumentRepository>

beforeAll(async () => {
  database = await createTestDatabase()
  documents = createDocumentRepository(database.db)
  await createUnitRepository(database.db).create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await createWorkspaceRepository(database.db).create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await createCollectionRepository(database.db).create({
    id: COLLECTION,
    workspaceId: WORKSPACE,
    name: 'Guides',
    slug: 'guides',
    now: NOW,
  })
  // root ── a ── a1 ── a11 ── a111
  //      └─ b
  for (const [key, parent, title] of [
    [1, null, 'root'],
    [2, 1, 'a'],
    [3, 2, 'a1'],
    [4, 3, 'a11'],
    [5, 4, 'a111'],
    [6, 1, 'b'],
    [7, null, 'elsewhere'],
  ] as const) {
    await documents.create({
      id: id(key),
      shortId: aShortId(key),
      workspaceId: WORKSPACE,
      collectionId: COLLECTION,
      parentId: parent === null ? null : id(parent),
      slug: title,
      path: `guides/${title}.md`,
      title,
      status: 'published',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
  }
}, 30_000)

afterAll(async () => {
  await database.drop()
})

const titles = (rows: readonly { title: string }[]): string[] =>
  rows.map((row) => row.title).toSorted()

describe('DocumentRepository.listDescendants', () => {
  it('walks down as many levels as asked, and leaves the document itself out', async () => {
    expect(titles(await documents.listDescendants(id(1), 1))).toEqual(['a', 'b'])
    expect(titles(await documents.listDescendants(id(1), 2))).toEqual(['a', 'a1', 'b'])
    expect(titles(await documents.listDescendants(id(1), 6))).toEqual([
      'a',
      'a1',
      'a11',
      'a111',
      'b',
    ])
    expect(titles(await documents.listDescendants(id(3), 6))).toEqual(['a11', 'a111'])
  })

  it('answers nothing for a page with no children', async () => {
    expect(await documents.listDescendants(id(7), 3)).toEqual([])
  })

  it('reads whole rows, as every other read does', async () => {
    const [a] = await documents.listDescendants(id(1), 1)
    expect(a).toMatchObject({ workspaceId: WORKSPACE, collectionId: COLLECTION, parentId: id(1) })
    expect(a?.createdAt).toEqual(NOW)
  })
})

describe('DocumentSummaryRepository', () => {
  it('reads each page’s summary and icon, or its body’s first line, in one query', async () => {
    const insert = async (
      key: number,
      summary: string | null,
      icon: string | null,
      body: string,
    ): Promise<void> => {
      await database.pool.query(
        `INSERT INTO document_search (document_id, workspace_id, collection_id, path, title, headings, body, status, summary, icon, updated_at, indexed_at)
         VALUES ($1, $2, $3, 'p', 't', '', $4, 'published', $5, $6, now(), now())`,
        [id(key), WORKSPACE, COLLECTION, body, summary, icon],
      )
    }
    await insert(2, 'About a.', '🅰️', 'Body of a.')
    await insert(3, null, null, 'First paragraph of a1.\nSecond.')
    await insert(4, null, null, '')

    const summaries = createDocumentSummaryRepository(database.db)
    const rows = await summaries.listByIds([id(2), id(3), id(4), id(6)])
    expect(rows.toSorted((left, right) => (left.documentId < right.documentId ? -1 : 1))).toEqual([
      { documentId: id(2), summary: 'About a.', icon: '🅰️' },
      { documentId: id(3), summary: 'First paragraph of a1.', icon: null },
      { documentId: id(4), summary: null, icon: null },
    ])
    expect(await summaries.listByIds([])).toEqual([])
  })
})
