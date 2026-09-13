import { describe, expect, it } from 'vitest'

import { collectionId, documentId, groupId, unitId, userId, workspaceId } from '../ids.ts'
import type { Grant } from './grant.ts'
import { PUBLIC_PRINCIPAL, groupPrincipal, userPrincipal } from './principal.ts'
import { NO_PERMISSION, resolvePermission } from './resolve.ts'
import type { ScopeChain } from './scope-chain.ts'
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

const DOCUMENT = documentScope(documentId(uuid(1)))
const COLLECTION = collectionScope(collectionId(uuid(2)))
const WORKSPACE = workspaceScope(workspaceId(uuid(3)))
const UNIT = unitScope(unitId(uuid(4)))
const ELSEWHERE = collectionScope(collectionId(uuid(5)))

const ALICE = userPrincipal(userId(uuid(6)))
const BOB = userPrincipal(userId(uuid(7)))
const PLATFORM = groupPrincipal(groupId(uuid(8)))
const PARENT_DOCUMENT = documentScope(documentId(uuid(9)))

const CHAIN: ScopeChain = [DOCUMENT, COLLECTION, WORKSPACE, UNIT, INSTANCE_SCOPE]
const NESTED_CHAIN: ScopeChain = [
  DOCUMENT,
  PARENT_DOCUMENT,
  COLLECTION,
  WORKSPACE,
  UNIT,
  INSTANCE_SCOPE,
]

function allow(principal: Grant['principal'], scope: Grant['scope'], role: Grant['role']): Grant {
  return { principal, scope, role, effect: 'allow' }
}

function deny(principal: Grant['principal'], scope: Grant['scope']): Grant {
  return { principal, scope, role: 'viewer', effect: 'deny' }
}

function resolve(grants: readonly Grant[], identities = [ALICE, PLATFORM, PUBLIC_PRINCIPAL]) {
  return resolvePermission({ chain: CHAIN, identities, grants })
}

describe('resolvePermission', () => {
  it('returns no permission when nothing on the chain applies', () => {
    expect(resolve([])).toBe(NO_PERMISSION)
    expect(NO_PERMISSION.capabilities).toEqual({
      view: false,
      comment: false,
      edit: false,
      manage: false,
      own: false,
    })
  })

  it('ignores grants to principals the request does not hold', () => {
    expect(resolve([allow(BOB, INSTANCE_SCOPE, 'owner')])).toBe(NO_PERMISSION)
  })

  it('ignores grants at scopes that are not on the chain', () => {
    expect(resolve([allow(ALICE, ELSEWHERE, 'owner')])).toBe(NO_PERMISSION)
  })

  it('inherits a grant made higher up the chain', () => {
    const permission = resolve([allow(ALICE, UNIT, 'editor')])
    expect(permission.role).toBe('editor')
    expect(permission.decidedAt).toEqual(UNIT)
    expect(permission.capabilities).toEqual({
      view: true,
      comment: true,
      edit: true,
      manage: false,
      own: false,
    })
  })

  it('lets the most specific scope decide, even when it grants less', () => {
    const permission = resolve([allow(ALICE, UNIT, 'owner'), allow(ALICE, COLLECTION, 'viewer')])
    expect(permission.role).toBe('viewer')
    expect(permission.decidedAt).toEqual(COLLECTION)
  })

  it('takes the highest role among allows at the deciding scope', () => {
    const lower = allow(ALICE, COLLECTION, 'viewer')
    const higher = allow(PLATFORM, COLLECTION, 'admin')
    expect(resolve([lower, higher]).by).toBe(higher)
    expect(resolve([higher, lower]).by).toBe(higher)
  })

  it('keeps the first grant when two allows tie', () => {
    const first = allow(ALICE, COLLECTION, 'editor')
    const second = allow(PLATFORM, COLLECTION, 'editor')
    expect(resolve([first, second]).by).toBe(first)
  })

  it('lets a deny beat allows at the same scope, whoever holds it', () => {
    const denial = deny(PLATFORM, DOCUMENT)
    const permission = resolve([allow(ALICE, DOCUMENT, 'owner'), denial])

    expect(permission.role).toBeNull()
    expect(permission.capabilities.view).toBe(false)
    expect(permission.decidedAt).toEqual(DOCUMENT)
    expect(permission.by).toBe(denial)
  })

  it('records the first deny when several apply', () => {
    const first = deny(ALICE, DOCUMENT)
    const second = deny(PLATFORM, DOCUMENT)
    expect(resolve([first, second]).by).toBe(first)
  })

  it('leaves higher scopes untouched by a deny below them', () => {
    const permission = resolve([allow(ALICE, UNIT, 'admin'), deny(ALICE, DOCUMENT)])
    expect(permission.role).toBeNull()
    expect(permission.decidedAt).toEqual(DOCUMENT)
  })

  it('applies a public grant to a signed-in request', () => {
    const permission = resolve([allow(PUBLIC_PRINCIPAL, WORKSPACE, 'viewer')])
    expect(permission.role).toBe('viewer')
  })

  it('grants an owner every capability', () => {
    expect(resolve([allow(ALICE, DOCUMENT, 'owner')]).capabilities).toEqual({
      view: true,
      comment: true,
      edit: true,
      manage: true,
      own: true,
    })
  })

  it('takes the highest of several grants one principal holds at one scope', () => {
    const highest = allow(ALICE, COLLECTION, 'admin')
    const permission = resolve([allow(ALICE, COLLECTION, 'viewer'), highest])
    expect(permission.role).toBe('admin')
    expect(permission.by).toBe(highest)
  })

  it('lets a deny on one principal withdraw what another principal allowed', () => {
    const denial = deny(ALICE, DOCUMENT)
    const permission = resolve([allow(PLATFORM, COLLECTION, 'editor'), denial])

    expect(permission.role).toBeNull()
    expect(permission.decidedAt).toEqual(DOCUMENT)
    expect(permission.by).toBe(denial)
  })

  it('lets an explicit allow nearer than an inherited deny win', () => {
    const exception = allow(ALICE, DOCUMENT, 'viewer')
    const permission = resolvePermission({
      chain: NESTED_CHAIN,
      identities: [ALICE, PLATFORM, PUBLIC_PRINCIPAL],
      grants: [deny(PLATFORM, PARENT_DOCUMENT), exception],
    })

    expect(permission.role).toBe('viewer')
    expect(permission.decidedAt).toEqual(DOCUMENT)
    expect(permission.by).toBe(exception)
  })

  it('never lets a public grant narrow what a signed-in reader already held', () => {
    const alice = allow(ALICE, WORKSPACE, 'editor')
    const withoutPublic = resolve([alice])
    const withPublic = resolve([alice, allow(PUBLIC_PRINCIPAL, COLLECTION, 'viewer')])

    expect(withoutPublic.role).toBe('editor')
    expect(withPublic.role).toBe('editor')
    expect(withPublic.by).toBe(alice)
  })

  it('lets a document be carved out of a public collection without hiding it from members', () => {
    const alice = allow(ALICE, WORKSPACE, 'editor')
    const permission = resolve([
      alice,
      allow(PUBLIC_PRINCIPAL, COLLECTION, 'viewer'),
      deny(PUBLIC_PRINCIPAL, DOCUMENT),
    ])

    expect(permission.role).toBe('editor')
    expect(permission.by).toBe(alice)
  })

  it('refuses an anonymous reader the document that public deny carved out', () => {
    const denial = deny(PUBLIC_PRINCIPAL, DOCUMENT)
    const permission = resolvePermission({
      chain: CHAIN,
      identities: [PUBLIC_PRINCIPAL],
      grants: [allow(PUBLIC_PRINCIPAL, COLLECTION, 'viewer'), denial],
    })

    expect(permission.role).toBeNull()
    expect(permission.decidedAt).toEqual(DOCUMENT)
    expect(permission.by).toBe(denial)
  })

  it('lets a group be made read-only without lowering a member granted more elsewhere', () => {
    const alice = allow(ALICE, WORKSPACE, 'editor')
    const permission = resolve([
      alice,
      allow(PLATFORM, UNIT, 'admin'),
      allow(PLATFORM, COLLECTION, 'viewer'),
    ])

    expect(permission.role).toBe('editor')
    expect(permission.by).toBe(alice)
    expect(
      resolvePermission({
        chain: CHAIN,
        identities: [PLATFORM],
        grants: [allow(PLATFORM, UNIT, 'admin'), allow(PLATFORM, COLLECTION, 'viewer')],
      }).role,
    ).toBe('viewer')
  })
})
