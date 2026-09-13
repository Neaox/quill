import { describe, expect, it } from 'vitest'

import { groupId, shareLinkId, unitId, userId } from '../ids.ts'
import type { Group } from '../tenancy/group.ts'
import type { User } from '../tenancy/user.ts'
import { principalIdentities } from './identities.ts'
import { PUBLIC_PRINCIPAL, groupPrincipal, shareLinkPrincipal, userPrincipal } from './principal.ts'

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

const UNIT = unitId(uuid(1))
const ALICE = userId(uuid(2))
const PLATFORM = groupId(uuid(3))
const ENGINEERING = groupId(uuid(4))
const DESIGN = groupId(uuid(5))
const UNKNOWN = groupId(uuid(6))
const LINK = shareLinkId(uuid(7))

const alice: User = { id: ALICE, name: 'Alice', email: 'alice@example.com' }

function group(id: ReturnType<typeof groupId>, parentGroupId: Group['parentGroupId']): Group {
  return { id, unitId: UNIT, parentGroupId, name: `group-${id.slice(-1)}` }
}

const groupsById = new Map([
  [PLATFORM, group(PLATFORM, ENGINEERING)],
  [ENGINEERING, group(ENGINEERING, null)],
  [DESIGN, group(DESIGN, ENGINEERING)],
])

describe('principalIdentities', () => {
  it('includes the user, their groups, the public principal, and the share link', () => {
    const identities = principalIdentities({
      isAnonymous: false,
      user: alice,
      groupIds: [PLATFORM],
      groupsById,
      shareLinkId: LINK,
    })

    expect(identities).toEqual([
      userPrincipal(ALICE),
      groupPrincipal(PLATFORM),
      groupPrincipal(ENGINEERING),
      PUBLIC_PRINCIPAL,
      shareLinkPrincipal(LINK),
    ])
  })

  it('omits the share link when there is none', () => {
    const identities = principalIdentities({
      isAnonymous: false,
      user: alice,
      groupIds: [],
      groupsById,
      shareLinkId: null,
    })

    expect(identities).toEqual([userPrincipal(ALICE), PUBLIC_PRINCIPAL])
  })

  it('yields a shared ancestor once', () => {
    const identities = principalIdentities({
      isAnonymous: false,
      user: alice,
      groupIds: [PLATFORM, DESIGN],
      groupsById,
      shareLinkId: null,
    })

    expect(identities).toEqual([
      userPrincipal(ALICE),
      groupPrincipal(PLATFORM),
      groupPrincipal(ENGINEERING),
      groupPrincipal(DESIGN),
      PUBLIC_PRINCIPAL,
    ])
  })

  it('keeps a membership whose group record is missing, without ancestors', () => {
    const identities = principalIdentities({
      isAnonymous: false,
      user: alice,
      groupIds: [UNKNOWN],
      groupsById,
      shareLinkId: null,
    })

    expect(identities).toEqual([userPrincipal(ALICE), groupPrincipal(UNKNOWN), PUBLIC_PRINCIPAL])
  })

  it('stops instead of looping when the group tree has a cycle', () => {
    const looped = new Map([
      [PLATFORM, group(PLATFORM, ENGINEERING)],
      [ENGINEERING, group(ENGINEERING, PLATFORM)],
    ])

    const identities = principalIdentities({
      isAnonymous: false,
      user: alice,
      groupIds: [PLATFORM],
      groupsById: looped,
      shareLinkId: null,
    })

    expect(identities).toEqual([
      userPrincipal(ALICE),
      groupPrincipal(PLATFORM),
      groupPrincipal(ENGINEERING),
      PUBLIC_PRINCIPAL,
    ])
  })

  it('gives an anonymous request only the public principal', () => {
    expect(principalIdentities({ isAnonymous: true, shareLinkId: null })).toEqual([
      PUBLIC_PRINCIPAL,
    ])
  })

  it('gives an anonymous request its share link', () => {
    expect(principalIdentities({ isAnonymous: true, shareLinkId: LINK })).toEqual([
      PUBLIC_PRINCIPAL,
      shareLinkPrincipal(LINK),
    ])
  })
})
