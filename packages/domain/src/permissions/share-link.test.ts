import { describe, expect, it } from 'vitest'

import { collectionId, documentId, shareLinkId, unitId, userId, workspaceId } from '../ids.ts'
import type { ScopeChain } from './scope-chain.ts'
import type { ShareLink } from './share-link.ts'
import {
  isShareLinkRole,
  isShareLinkScope,
  shareLinkCovers,
  shareLinkGrants,
  shareLinkState,
} from './share-link.ts'
import { shareLinkPrincipal } from './principal.ts'
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

const TARGET = documentId(uuid(1))
const CHILD = documentId(uuid(2))
const ELSEWHERE = documentId(uuid(3))
const LINK_ID = shareLinkId(uuid(4))
const CREATOR = userId(uuid(5))

const COLLECTION = collectionScope(collectionId(uuid(6)))
const WORKSPACE = workspaceScope(workspaceId(uuid(7)))
const UNIT = unitScope(unitId(uuid(8)))

const NOW = new Date('2026-03-01T12:00:00.000Z')

/** The chain of a document, with the ancestors it nests under, nearest first. */
function chainOf(...documents: readonly ReturnType<typeof documentId>[]): ScopeChain {
  return [...documents.map(documentScope), COLLECTION, WORKSPACE, UNIT, INSTANCE_SCOPE]
}

function link(overrides: Partial<ShareLink> = {}): ShareLink {
  return {
    id: LINK_ID,
    documentId: TARGET,
    scope: 'document',
    role: 'viewer',
    expiresAt: null,
    revokedAt: null,
    createdBy: CREATOR,
    ...overrides,
  }
}

describe('share link scopes and roles', () => {
  it('recognises the two scopes and rejects anything else', () => {
    expect(isShareLinkScope('document')).toBe(true)
    expect(isShareLinkScope('subtree')).toBe(true)
    expect(isShareLinkScope('collection')).toBe(false)
  })

  it('carries view only until comment and edit arrive in M7', () => {
    expect(isShareLinkRole('viewer')).toBe(true)
    expect(isShareLinkRole('editor')).toBe(false)
    expect(isShareLinkRole('owner')).toBe(false)
  })
})

describe('shareLinkState', () => {
  it('is valid while it has neither been revoked nor expired', () => {
    expect(shareLinkState(link(), NOW)).toBe('valid')
    expect(shareLinkState(link({ expiresAt: new Date(NOW.getTime() + 1) }), NOW)).toBe('valid')
  })

  it('expires at the instant it says, not a millisecond later', () => {
    expect(shareLinkState(link({ expiresAt: NOW }), NOW)).toBe('expired')
    expect(shareLinkState(link({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe('expired')
  })

  it('reports revocation ahead of expiry, so the deliberate act is what is recorded', () => {
    const revoked = link({
      revokedAt: new Date(NOW.getTime() - 10_000),
      expiresAt: new Date(NOW.getTime() - 1),
    })
    expect(shareLinkState(revoked, NOW)).toBe('revoked')
  })
})

describe('shareLinkCovers', () => {
  it('covers its own document, whichever scope it carries', () => {
    expect(shareLinkCovers(link(), chainOf(TARGET))).toBe(true)
    expect(shareLinkCovers(link({ scope: 'subtree' }), chainOf(TARGET))).toBe(true)
  })

  it('does not reach a child when the link is for one document', () => {
    expect(shareLinkCovers(link(), chainOf(CHILD, TARGET))).toBe(false)
  })

  it('reaches every document nested under its target when the link is a subtree', () => {
    const subtree = link({ scope: 'subtree' })
    expect(shareLinkCovers(subtree, chainOf(CHILD, TARGET))).toBe(true)
    expect(shareLinkCovers(subtree, chainOf(ELSEWHERE, CHILD, TARGET))).toBe(true)
  })

  it('reaches nothing outside its target subtree', () => {
    expect(shareLinkCovers(link({ scope: 'subtree' }), chainOf(ELSEWHERE))).toBe(false)
  })

  it('reaches no chain that is not a document at all', () => {
    const workspaceChain: ScopeChain = [WORKSPACE, UNIT, INSTANCE_SCOPE]
    expect(shareLinkCovers(link(), workspaceChain)).toBe(false)
    expect(shareLinkCovers(link({ scope: 'subtree' }), workspaceChain)).toBe(false)
  })

  it('reaches nothing at all on an empty chain', () => {
    expect(shareLinkCovers(link(), [])).toBe(false)
  })
})

describe('shareLinkGrants', () => {
  it('grants the link its role at its target document', () => {
    expect(shareLinkGrants(link(), chainOf(TARGET))).toEqual([
      {
        principal: shareLinkPrincipal(LINK_ID),
        scope: documentScope(TARGET),
        role: 'viewer',
        effect: 'allow',
      },
    ])
  })

  it('grants a subtree link the same one grant, which the chain inherits downwards', () => {
    const grants = shareLinkGrants(link({ scope: 'subtree' }), chainOf(CHILD, TARGET))
    expect(grants).toHaveLength(1)
    expect(grants[0]?.scope).toEqual(documentScope(TARGET))
  })

  it('grants nothing where the link does not reach', () => {
    expect(shareLinkGrants(link(), chainOf(CHILD, TARGET))).toEqual([])
    expect(shareLinkGrants(link({ scope: 'subtree' }), chainOf(ELSEWHERE))).toEqual([])
  })
})
