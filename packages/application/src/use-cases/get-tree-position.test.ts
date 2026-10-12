import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, workspaceId } from '@quill/domain'

import { aShortId } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { getTreePosition } from './get-tree-position.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const id = (n: number) => documentId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

let uow: InMemoryUnitOfWork

async function aDocument(n: number, parent: number | null) {
  await uow.repos.documents.create({
    id: id(n),
    shortId: aShortId(),
    workspaceId: WORKSPACE,
    collectionId: 'log',
    parentId: parent === null ? null : id(parent),
    slug: `doc-${String(n)}`,
    path: `log/doc-${String(n)}.md`,
    title: `Doc ${String(n)}`,
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  await uow.repos.units.create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'log',
    workspaceId: WORKSPACE,
    name: 'Log',
    slug: 'log',
    now: NOW,
  })
  await aDocument(1, null)
  await aDocument(2, 1)
  await aDocument(3, 2)
  await aDocument(4, 3)
  await aDocument(5, 3)
})

describe('getTreePosition', () => {
  it('names the collection, the documents above it from the outside in, and how many are beneath', async () => {
    expect(await getTreePosition({ uow }, id(3))).toEqual({
      kind: 'position',
      collectionId: 'log',
      ancestors: [id(1), id(2)],
      childCount: 2,
    })
  })

  it('has no ancestors at the top of a collection, and no children when it is a leaf', async () => {
    expect(await getTreePosition({ uow }, id(1))).toMatchObject({ ancestors: [], childCount: 1 })
    expect(await getTreePosition({ uow }, id(4))).toMatchObject({
      ancestors: [id(1), id(2), id(3)],
      childCount: 0,
    })
  })

  it('says so for a document that does not exist', async () => {
    expect(await getTreePosition({ uow }, id(99))).toEqual({
      kind: 'not-found',
      documentId: id(99),
    })
  })
})
