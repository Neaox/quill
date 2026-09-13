import { describe, expect, it } from 'vitest'

import { collectionId, documentId, unitId, workspaceId } from '../ids.ts'
import type { Collection } from '../tenancy/collection.ts'
import type { Document } from '../tenancy/document.ts'
import type { OrganisationalUnit } from '../tenancy/organisational-unit.ts'
import type { Workspace } from '../tenancy/workspace.ts'
import { buildDocumentAncestorChain, buildScopeChain, buildUnitChain } from './scope-chain.ts'
import {
  INSTANCE_SCOPE,
  collectionScope,
  documentScope,
  unitScope,
  workspaceScope,
} from './scope.ts'

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

const ROOT = unitId(uuid(1))
const TEAM = unitId(uuid(2))
const MISSING = unitId(uuid(9))
const WORKSPACE = workspaceId(uuid(3))
const COLLECTION = collectionId(uuid(4))
const OTHER_COLLECTION = collectionId(uuid(5))
const DOCUMENT = documentId(uuid(6))
const OTHER_WORKSPACE = workspaceId(uuid(7))
const PARENT_DOCUMENT = documentId(uuid(10))
const GRANDPARENT_DOCUMENT = documentId(uuid(11))
const MISSING_DOCUMENT = documentId(uuid(12))
const FOREIGN_DOCUMENT = documentId(uuid(13))

const root: OrganisationalUnit = {
  id: ROOT,
  parentId: null,
  name: 'Acme',
  slug: 'acme',
  label: 'company',
}
const team: OrganisationalUnit = {
  id: TEAM,
  parentId: ROOT,
  name: 'Platform',
  slug: 'platform',
  label: 'team',
}
const unitsById = new Map([
  [ROOT, root],
  [TEAM, team],
])

const workspace: Workspace = { id: WORKSPACE, unitId: TEAM, name: 'Docs', slug: 'docs' }
const collection: Collection = {
  id: COLLECTION,
  workspaceId: WORKSPACE,
  name: 'Guides',
  slug: 'guides',
}
const document: Document = {
  id: DOCUMENT,
  workspaceId: WORKSPACE,
  collectionId: COLLECTION,
  parentId: null,
  slug: 'intro',
  title: 'Intro',
  status: 'published',
}
const documentsById = new Map([[DOCUMENT, document]])

describe('buildUnitChain', () => {
  it('walks from the given unit to the root, nearest first', () => {
    expect(buildUnitChain(TEAM, unitsById)).toEqual({ ok: true, value: [team, root] })
  })

  it('fails when a unit on the path is not known', () => {
    expect(buildUnitChain(MISSING, unitsById)).toEqual({
      ok: false,
      error: { kind: 'unknown-unit', unitId: MISSING },
    })
  })

  it('fails instead of looping when parent pointers form a cycle', () => {
    const looped = new Map([
      [ROOT, { ...root, parentId: TEAM }],
      [TEAM, team],
    ])
    expect(buildUnitChain(TEAM, looped)).toEqual({
      ok: false,
      error: { kind: 'unit-cycle', unitId: TEAM },
    })
  })

  it('fails when a unit is its own parent', () => {
    const looped = new Map([[ROOT, { ...root, parentId: ROOT }]])
    expect(buildUnitChain(ROOT, looped)).toEqual({
      ok: false,
      error: { kind: 'unit-cycle', unitId: ROOT },
    })
  })
})

describe('buildDocumentAncestorChain', () => {
  const parent: Document = { ...document, id: PARENT_DOCUMENT, parentId: null, slug: 'parent' }
  const grandparent: Document = {
    ...document,
    id: GRANDPARENT_DOCUMENT,
    parentId: null,
    slug: 'grandparent',
  }
  const nested: Document = { ...document, parentId: PARENT_DOCUMENT }
  const nestedTwoDeep: Document = { ...document, parentId: PARENT_DOCUMENT }
  const parentedByGrandparent: Document = {
    ...parent,
    parentId: GRANDPARENT_DOCUMENT,
  }

  it('returns nothing for a document with no parent', () => {
    expect(buildDocumentAncestorChain(document, documentsById)).toEqual({ ok: true, value: [] })
  })

  it('walks from the given document to the root, nearest first', () => {
    const byId = new Map([
      [PARENT_DOCUMENT, parentedByGrandparent],
      [GRANDPARENT_DOCUMENT, grandparent],
    ])
    expect(buildDocumentAncestorChain(nestedTwoDeep, byId)).toEqual({
      ok: true,
      value: [parentedByGrandparent, grandparent],
    })
  })

  it('fails when a parent on the path is not known', () => {
    const orphan: Document = { ...document, parentId: MISSING_DOCUMENT }
    expect(buildDocumentAncestorChain(orphan, documentsById)).toEqual({
      ok: false,
      error: { kind: 'unknown-document', documentId: MISSING_DOCUMENT },
    })
  })

  it('fails instead of looping when parent pointers form a cycle', () => {
    const looped = new Map([
      [PARENT_DOCUMENT, { ...parent, parentId: DOCUMENT }],
      [DOCUMENT, { ...nested, id: DOCUMENT }],
    ])
    expect(buildDocumentAncestorChain(looped.get(DOCUMENT)!, looped)).toEqual({
      ok: false,
      error: { kind: 'document-cycle', documentId: DOCUMENT },
    })
  })

  it('fails when a document is its own parent', () => {
    const selfParented = new Map([[DOCUMENT, { ...document, parentId: DOCUMENT }]])
    expect(buildDocumentAncestorChain(selfParented.get(DOCUMENT)!, selfParented)).toEqual({
      ok: false,
      error: { kind: 'document-cycle', documentId: DOCUMENT },
    })
  })

  it('fails when an ancestor belongs to a different collection', () => {
    const foreign: Document = { ...document, id: FOREIGN_DOCUMENT, collectionId: OTHER_COLLECTION }
    const byId = new Map([[PARENT_DOCUMENT, foreign]])
    expect(buildDocumentAncestorChain(nested, byId)).toEqual({
      ok: false,
      error: {
        kind: 'document-ancestor-outside-collection',
        documentId: FOREIGN_DOCUMENT,
        collectionId: COLLECTION,
      },
    })
  })
})

describe('buildScopeChain', () => {
  it('orders the chain from the document up to the instance', () => {
    const chain = buildScopeChain({ document, collection, workspace, unitsById, documentsById })
    expect(chain).toEqual({
      ok: true,
      value: [
        documentScope(DOCUMENT),
        collectionScope(COLLECTION),
        workspaceScope(WORKSPACE),
        unitScope(TEAM),
        unitScope(ROOT),
        INSTANCE_SCOPE,
      ],
    })
  })

  it('inserts ancestor documents ahead of the collection, nearest first', () => {
    const parent: Document = {
      ...document,
      id: PARENT_DOCUMENT,
      parentId: GRANDPARENT_DOCUMENT,
      slug: 'parent',
    }
    const grandparent: Document = {
      ...document,
      id: GRANDPARENT_DOCUMENT,
      parentId: null,
      slug: 'grandparent',
    }
    const nested: Document = { ...document, parentId: PARENT_DOCUMENT }
    const byId = new Map([
      [PARENT_DOCUMENT, parent],
      [GRANDPARENT_DOCUMENT, grandparent],
    ])

    const chain = buildScopeChain({
      document: nested,
      collection,
      workspace,
      unitsById,
      documentsById: byId,
    })
    expect(chain).toEqual({
      ok: true,
      value: [
        documentScope(DOCUMENT),
        documentScope(PARENT_DOCUMENT),
        documentScope(GRANDPARENT_DOCUMENT),
        collectionScope(COLLECTION),
        workspaceScope(WORKSPACE),
        unitScope(TEAM),
        unitScope(ROOT),
        INSTANCE_SCOPE,
      ],
    })
  })

  it('fails when the collection belongs to another workspace', () => {
    const chain = buildScopeChain({
      document,
      collection: { ...collection, workspaceId: OTHER_WORKSPACE },
      workspace,
      unitsById,
      documentsById,
    })
    expect(chain).toEqual({
      ok: false,
      error: {
        kind: 'collection-outside-workspace',
        collectionId: COLLECTION,
        workspaceId: WORKSPACE,
      },
    })
  })

  it('fails when the document belongs to another collection', () => {
    const chain = buildScopeChain({
      document: { ...document, collectionId: OTHER_COLLECTION },
      collection,
      workspace,
      unitsById,
      documentsById,
    })
    expect(chain).toEqual({
      ok: false,
      error: {
        kind: 'document-outside-collection',
        documentId: DOCUMENT,
        collectionId: COLLECTION,
      },
    })
  })

  it('fails when the document belongs to another workspace', () => {
    const chain = buildScopeChain({
      document: { ...document, workspaceId: OTHER_WORKSPACE },
      collection,
      workspace,
      unitsById,
      documentsById,
    })
    expect(chain).toEqual({
      ok: false,
      error: {
        kind: 'document-outside-workspace',
        documentId: DOCUMENT,
        workspaceId: WORKSPACE,
      },
    })
  })

  it('propagates a broken ancestor document chain', () => {
    const nested: Document = { ...document, parentId: MISSING_DOCUMENT }
    const chain = buildScopeChain({
      document: nested,
      collection,
      workspace,
      unitsById,
      documentsById,
    })
    expect(chain).toEqual({
      ok: false,
      error: { kind: 'unknown-document', documentId: MISSING_DOCUMENT },
    })
  })

  it('propagates a broken unit tree', () => {
    const chain = buildScopeChain({
      document,
      collection,
      workspace: { ...workspace, unitId: MISSING },
      unitsById,
      documentsById,
    })
    expect(chain).toEqual({ ok: false, error: { kind: 'unknown-unit', unitId: MISSING } })
  })
})
