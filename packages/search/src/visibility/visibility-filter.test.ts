import { PUBLIC_PRINCIPAL, userId, userPrincipal, workspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { visibilityFilter } from './visibility-filter.ts'

const WORKSPACE_A = workspaceId('11111111-1111-4111-8111-111111111111')
const WORKSPACE_B = workspaceId('22222222-2222-4222-8222-222222222222')
const USER = userPrincipal(userId('33333333-3333-4333-8333-333333333333'))

describe('visibilityFilter', () => {
  it('carries every workspace the caller may read', () => {
    const result = visibilityFilter([WORKSPACE_A, WORKSPACE_B], [USER])
    expect(result.workspaceIds).toEqual([WORKSPACE_A, WORKSPACE_B])
  })

  it('de-duplicates repeated workspace ids', () => {
    const result = visibilityFilter([WORKSPACE_A, WORKSPACE_A], [USER])
    expect(result.workspaceIds).toEqual([WORKSPACE_A])
  })

  it('keys principals with the same stable key permission resolution uses', () => {
    const result = visibilityFilter([WORKSPACE_A], [USER, PUBLIC_PRINCIPAL])
    expect(result.principalKeys).toEqual(expect.arrayContaining([`user:${USER.userId}`, 'public']))
    expect(result.principalKeys).toHaveLength(2)
  })

  it('de-duplicates a principal held more than once', () => {
    const result = visibilityFilter([WORKSPACE_A], [USER, USER])
    expect(result.principalKeys).toEqual([`user:${USER.userId}`])
  })

  it('produces an empty filter for no workspaces and no principals', () => {
    expect(visibilityFilter([], [])).toEqual({ workspaceIds: [], principalKeys: [] })
  })
})
