import { describe, expect, it } from 'vitest'

import { collectionId, documentId, groupId, shareLinkId, userId, workspaceId } from '../ids.ts'
import type { Contribution } from './combine.ts'
import { combineContributions, supersedesAtScope } from './combine.ts'
import type { Grant } from './grant.ts'
import type { Principal } from './principal.ts'
import { PUBLIC_PRINCIPAL, groupPrincipal, shareLinkPrincipal, userPrincipal } from './principal.ts'
import { collectionScope, documentScope, workspaceScope } from './scope.ts'

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

/** Depths as `materialiseEffectivePermissions` counts them: deeper is nearer the document. */
const WORKSPACE_DEPTH = 1
const COLLECTION_DEPTH = 2
const DOCUMENT_DEPTH = 3

const WORKSPACE = workspaceScope(workspaceId(uuid(1)))
const COLLECTION = collectionScope(collectionId(uuid(2)))
const DOCUMENT = documentScope(documentId(uuid(3)))

const ALICE = userPrincipal(userId(uuid(4)))
const PLATFORM = groupPrincipal(groupId(uuid(5)))
const LINK = shareLinkPrincipal(shareLinkId(uuid(6)))

function allow(
  role: Contribution['role'],
  depth: number,
  scope: Contribution['scope'],
  principal: Principal = ALICE,
): Contribution {
  return { principal, role, effect: 'allow', depth, scope }
}

/** A deny on a person: it withdraws the document from them however they reach it. */
function deny(
  depth: number,
  scope: Contribution['scope'],
  principal: Principal = ALICE,
): Contribution {
  return { principal, role: 'viewer', effect: 'deny', depth, scope }
}

describe('combineContributions', () => {
  it('decides nothing when no principal contributed', () => {
    expect(combineContributions([])).toEqual({ role: null, decidedBy: null })
  })

  it('takes the highest role among allows', () => {
    const highest = allow('admin', WORKSPACE_DEPTH, WORKSPACE)
    expect(combineContributions([allow('viewer', COLLECTION_DEPTH, COLLECTION), highest])).toEqual({
      role: 'admin',
      decidedBy: highest,
    })
  })

  it('prefers the nearer scope when two allows carry the same role', () => {
    const nearer = allow('editor', COLLECTION_DEPTH, COLLECTION)
    expect(combineContributions([allow('editor', WORKSPACE_DEPTH, WORKSPACE), nearer])).toEqual({
      role: 'editor',
      decidedBy: nearer,
    })
  })

  it('keeps the first of two allows that match in role and scope', () => {
    const first = allow('editor', COLLECTION_DEPTH, COLLECTION)
    expect(
      combineContributions([first, allow('editor', COLLECTION_DEPTH, COLLECTION)]).decidedBy,
    ).toBe(first)
  })

  it('lets a deny discard an allow inherited from a broader scope', () => {
    const denial = deny(DOCUMENT_DEPTH, DOCUMENT)
    expect(combineContributions([allow('owner', WORKSPACE_DEPTH, WORKSPACE), denial])).toEqual({
      role: null,
      decidedBy: denial,
    })
  })

  it('lets a deny beat an allow at the same scope', () => {
    const denial = deny(DOCUMENT_DEPTH, DOCUMENT)
    expect(combineContributions([allow('owner', DOCUMENT_DEPTH, DOCUMENT), denial])).toEqual({
      role: null,
      decidedBy: denial,
    })
  })

  it('lets an allow strictly nearer than the deny survive it', () => {
    const exception = allow('viewer', DOCUMENT_DEPTH, DOCUMENT)
    expect(combineContributions([deny(COLLECTION_DEPTH, COLLECTION), exception])).toEqual({
      role: 'viewer',
      decidedBy: exception,
    })
  })

  it('measures every allow against the nearest deny', () => {
    const nearest = deny(COLLECTION_DEPTH, COLLECTION)
    expect(
      combineContributions([
        deny(WORKSPACE_DEPTH, WORKSPACE),
        nearest,
        allow('owner', WORKSPACE_DEPTH, WORKSPACE),
      ]),
    ).toEqual({ role: null, decidedBy: nearest })
  })

  it('keeps the first of two denies at the same depth', () => {
    const first = deny(DOCUMENT_DEPTH, DOCUMENT)
    expect(combineContributions([first, deny(DOCUMENT_DEPTH, DOCUMENT)]).decidedBy).toBe(first)
  })

  it('lets a deny on a group withdraw an allow held through a user', () => {
    const denial = deny(DOCUMENT_DEPTH, DOCUMENT, PLATFORM)
    expect(
      combineContributions([allow('owner', COLLECTION_DEPTH, COLLECTION, ALICE), denial]),
    ).toEqual({
      role: null,
      decidedBy: denial,
    })
  })

  it('lets a deny on the public principal close only the public channel', () => {
    const member = allow('editor', WORKSPACE_DEPTH, WORKSPACE, ALICE)
    expect(
      combineContributions([
        member,
        allow('viewer', COLLECTION_DEPTH, COLLECTION, PUBLIC_PRINCIPAL),
        deny(DOCUMENT_DEPTH, DOCUMENT, PUBLIC_PRINCIPAL),
      ]),
    ).toEqual({ role: 'editor', decidedBy: member })
  })

  it('refuses an anonymous reader whose only principal is the denied channel', () => {
    const denial = deny(DOCUMENT_DEPTH, DOCUMENT, PUBLIC_PRINCIPAL)
    expect(combineContributions([denial])).toEqual({ role: null, decidedBy: denial })
  })

  it('lets a deny on a share link close only that link', () => {
    const member = allow('viewer', COLLECTION_DEPTH, COLLECTION, ALICE)
    expect(combineContributions([member, deny(DOCUMENT_DEPTH, DOCUMENT, LINK)])).toEqual({
      role: 'viewer',
      decidedBy: member,
    })
  })

  it('keeps the nearest closed channel as the explanation when nothing else applies', () => {
    const nearest = deny(DOCUMENT_DEPTH, DOCUMENT, PUBLIC_PRINCIPAL)
    expect(
      combineContributions([deny(COLLECTION_DEPTH, COLLECTION, LINK), nearest]).decidedBy,
    ).toBe(nearest)
    expect(
      combineContributions([nearest, deny(COLLECTION_DEPTH, COLLECTION, LINK)]).decidedBy,
    ).toBe(nearest)
  })

  it('prefers a withdrawal to a closed channel when explaining a refusal', () => {
    const withdrawal = deny(COLLECTION_DEPTH, COLLECTION, ALICE)
    expect(
      combineContributions([deny(DOCUMENT_DEPTH, DOCUMENT, PUBLIC_PRINCIPAL), withdrawal])
        .decidedBy,
    ).toBe(withdrawal)
  })
})

function verdict(
  effect: Grant['effect'],
  role: Grant['role'],
): { effect: Grant['effect']; role: Grant['role'] } {
  return { effect, role }
}

describe('supersedesAtScope', () => {
  it('lets a deny replace an allow', () => {
    expect(supersedesAtScope(verdict('deny', 'viewer'), verdict('allow', 'owner'))).toBe(true)
  })

  it('never replaces a deny', () => {
    expect(supersedesAtScope(verdict('allow', 'owner'), verdict('deny', 'viewer'))).toBe(false)
    expect(supersedesAtScope(verdict('deny', 'owner'), verdict('deny', 'viewer'))).toBe(false)
  })

  it('replaces an allow only with a strictly higher one', () => {
    expect(supersedesAtScope(verdict('allow', 'admin'), verdict('allow', 'editor'))).toBe(true)
    expect(supersedesAtScope(verdict('allow', 'editor'), verdict('allow', 'editor'))).toBe(false)
    expect(supersedesAtScope(verdict('allow', 'viewer'), verdict('allow', 'editor'))).toBe(false)
  })
})
