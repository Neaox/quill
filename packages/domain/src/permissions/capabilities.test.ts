import { describe, expect, it } from 'vitest'

import { ROLES } from '../roles.ts'
import { NATIVE_ORIGIN } from '../tenancy/workspace-origin.ts'
import type { WorkspaceOrigin } from '../tenancy/workspace-origin.ts'
import { NO_CAPABILITIES, capabilitiesForRole, narrowByOrigin } from './capabilities.ts'

const SOURCED: WorkspaceOrigin = { kind: 'sourced' }

describe('capabilitiesForRole', () => {
  it('derives every capability from the role', () => {
    expect(capabilitiesForRole('viewer')).toEqual({
      view: true,
      comment: false,
      edit: false,
      publish: false,
      arrange: false,
      manage: false,
      own: false,
    })
    expect(capabilitiesForRole('contributor')).toEqual({
      view: true,
      comment: true,
      edit: true,
      publish: false,
      arrange: false,
      manage: false,
      own: false,
    })
    expect(capabilitiesForRole('owner')).toEqual({
      view: true,
      comment: true,
      edit: true,
      publish: true,
      arrange: true,
      manage: true,
      own: true,
    })
  })

  it('grants arrange to exactly the roles that manage (ADR-061)', () => {
    for (const role of ROLES) {
      const capabilities = capabilitiesForRole(role)
      expect(capabilities.arrange).toBe(capabilities.manage)
    }
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

describe('narrowByOrigin', () => {
  it('leaves a native workspace exactly as the role says', () => {
    for (const role of ROLES) {
      expect(narrowByOrigin(capabilitiesForRole(role), NATIVE_ORIGIN)).toEqual(
        capabilitiesForRole(role),
      )
    }
  })

  it('turns off writing and arranging in a sourced workspace, whatever the role', () => {
    for (const role of ROLES) {
      const narrowed = narrowByOrigin(capabilitiesForRole(role), SOURCED)
      expect(narrowed.edit).toBe(false)
      expect(narrowed.publish).toBe(false)
      expect(narrowed.arrange).toBe(false)
    }
  })

  it('keeps reading, commenting, access and ownership in a sourced workspace', () => {
    expect(narrowByOrigin(capabilitiesForRole('owner'), SOURCED)).toEqual({
      view: true,
      comment: true,
      edit: false,
      publish: false,
      arrange: false,
      manage: true,
      own: true,
    })
    expect(narrowByOrigin(capabilitiesForRole('viewer'), SOURCED)).toEqual(
      capabilitiesForRole('viewer'),
    )
  })

  it('never grants what the role did not', () => {
    expect(narrowByOrigin(NO_CAPABILITIES, SOURCED)).toEqual(NO_CAPABILITIES)
    expect(narrowByOrigin(NO_CAPABILITIES, NATIVE_ORIGIN)).toEqual(NO_CAPABILITIES)
  })
})
