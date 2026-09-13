import { describe, expect, it } from 'vitest'

import { collectionId, documentId, unitId, workspaceId } from '../ids.ts'
import {
  INSTANCE_SCOPE,
  SCOPE_KINDS,
  collectionScope,
  documentScope,
  scopeKey,
  scopeSpecificity,
  unitScope,
  workspaceScope,
} from './scope.ts'

const ID = '018f4c1e-7c3a-7c1d-9b2e-1f2a3b4c5d6e'

const EVERY_SCOPE = [
  INSTANCE_SCOPE,
  unitScope(unitId(ID)),
  workspaceScope(workspaceId(ID)),
  collectionScope(collectionId(ID)),
  documentScope(documentId(ID)),
] as const

describe('scope constructors', () => {
  it('tag each scope with its kind and subject', () => {
    expect(INSTANCE_SCOPE).toEqual({ kind: 'instance' })
    expect(unitScope(unitId(ID))).toEqual({ kind: 'unit', unitId: ID })
    expect(workspaceScope(workspaceId(ID))).toEqual({ kind: 'workspace', workspaceId: ID })
    expect(collectionScope(collectionId(ID))).toEqual({ kind: 'collection', collectionId: ID })
    expect(documentScope(documentId(ID))).toEqual({ kind: 'document', documentId: ID })
  })
})

describe('scopeSpecificity', () => {
  it('orders instance < unit < workspace < collection < document', () => {
    const ranks = EVERY_SCOPE.map(scopeSpecificity)
    expect(ranks).toEqual([0, 1, 2, 3, 4])
  })

  it('ranks every declared scope kind', () => {
    expect(EVERY_SCOPE.map((scope) => scope.kind)).toEqual([...SCOPE_KINDS])
  })
})

describe('scopeKey', () => {
  it('prefixes the kind so ids of different kinds never collide', () => {
    expect(EVERY_SCOPE.map(scopeKey)).toEqual([
      'instance',
      `unit:${ID}`,
      `workspace:${ID}`,
      `collection:${ID}`,
      `document:${ID}`,
    ])
  })
})
