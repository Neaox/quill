import { describe, expect, it } from 'vitest'

import { groupId, shareLinkId, userId } from '../ids.ts'
import {
  PUBLIC_PRINCIPAL,
  groupPrincipal,
  principalKey,
  shareLinkPrincipal,
  userPrincipal,
} from './principal.ts'

const ID = '018f4c1e-7c3a-7c1d-9b2e-1f2a3b4c5d6e'

describe('principal constructors', () => {
  it('tag each principal with its kind', () => {
    expect(userPrincipal(userId(ID))).toEqual({ kind: 'user', userId: ID })
    expect(groupPrincipal(groupId(ID))).toEqual({ kind: 'group', groupId: ID })
    expect(shareLinkPrincipal(shareLinkId(ID))).toEqual({ kind: 'share-link', shareLinkId: ID })
    expect(PUBLIC_PRINCIPAL).toEqual({ kind: 'public' })
  })
})

describe('principalKey', () => {
  it('prefixes the kind so ids of different kinds never collide', () => {
    expect(principalKey(userPrincipal(userId(ID)))).toBe(`user:${ID}`)
    expect(principalKey(groupPrincipal(groupId(ID)))).toBe(`group:${ID}`)
    expect(principalKey(shareLinkPrincipal(shareLinkId(ID)))).toBe(`share-link:${ID}`)
    expect(principalKey(PUBLIC_PRINCIPAL)).toBe('public')
  })

  it('gives the same key to equal principals', () => {
    expect(principalKey(userPrincipal(userId(ID)))).toBe(principalKey(userPrincipal(userId(ID))))
  })
})
