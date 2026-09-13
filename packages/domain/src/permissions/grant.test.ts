import { describe, expect, it } from 'vitest'

import { collectionId, documentId, userId } from '../ids.ts'
import type { Grant } from './grant.ts'
import { validateGrant } from './grant.ts'
import { PUBLIC_PRINCIPAL, userPrincipal } from './principal.ts'
import { collectionScope, documentScope } from './scope.ts'

const ID = '018f4c1e-7c3a-7c1d-9b2e-1f2a3b4c5d6e'
const ALICE = userPrincipal(userId(ID))
const DOCUMENT = documentScope(documentId(ID))
const COLLECTION = collectionScope(collectionId(ID))

function grant(overrides: Partial<Grant>): Grant {
  return { principal: ALICE, scope: COLLECTION, role: 'editor', effect: 'allow', ...overrides }
}

describe('validateGrant', () => {
  it('accepts an allow at any scope and returns the grant', () => {
    const valid = grant({})
    expect(validateGrant(valid)).toEqual({ ok: true, value: valid })
  })

  it('accepts a deny at document scope', () => {
    expect(validateGrant(grant({ scope: DOCUMENT, effect: 'deny' })).ok).toBe(true)
  })

  it('rejects a deny above document scope', () => {
    const result = validateGrant(grant({ scope: COLLECTION, effect: 'deny' }))
    expect(result).toEqual({
      ok: false,
      error: [{ kind: 'deny-outside-document-scope', scope: 'collection' }],
    })
  })

  it('accepts a viewer grant to the public principal', () => {
    expect(validateGrant(grant({ principal: PUBLIC_PRINCIPAL, role: 'viewer' })).ok).toBe(true)
  })

  it('rejects any higher role for the public principal', () => {
    const result = validateGrant(grant({ principal: PUBLIC_PRINCIPAL, role: 'contributor' }))
    expect(result).toEqual({
      ok: false,
      error: [{ kind: 'public-principal-above-viewer', role: 'contributor' }],
    })
  })

  it('reports every violation at once', () => {
    const result = validateGrant(
      grant({ principal: PUBLIC_PRINCIPAL, scope: COLLECTION, role: 'admin', effect: 'deny' }),
    )
    expect(result.ok ? [] : result.error.map((violation) => violation.kind)).toEqual([
      'deny-outside-document-scope',
      'public-principal-above-viewer',
    ])
  })
})
