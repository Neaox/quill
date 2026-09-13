import { describe, expect, it } from 'vitest'

import { NO_CAPABILITIES, capabilitiesForRole } from './capabilities.ts'

describe('capabilitiesForRole', () => {
  it('derives every capability from the role', () => {
    expect(capabilitiesForRole('viewer')).toEqual({
      view: true,
      comment: false,
      edit: false,
      manage: false,
      own: false,
    })
    expect(capabilitiesForRole('owner')).toEqual({
      view: true,
      comment: true,
      edit: true,
      manage: true,
      own: true,
    })
  })
})

describe('NO_CAPABILITIES', () => {
  it('permits nothing', () => {
    expect(Object.values(NO_CAPABILITIES).every((allowed) => allowed === false)).toBe(true)
  })

  it('has the same shape as a derived set', () => {
    expect(Object.keys(NO_CAPABILITIES).toSorted()).toEqual(
      Object.keys(capabilitiesForRole('viewer')).toSorted(),
    )
  })
})
