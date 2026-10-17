import { describe, expect, it } from 'vitest'

import { SETTINGS_SECTIONS } from '../settings/settings-sections.ts'
import {
  ORGANISATION_DESTINATIONS,
  ORGANISATION_PEOPLE,
  ORGANISATION_SETTINGS_HOME,
  ORGANISATION_STRUCTURE,
} from './organisation-destinations.ts'

describe('the organisation destinations', () => {
  it('offer every settings screen, in the settings navigation’s own order', () => {
    const offered = ORGANISATION_DESTINATIONS.map((destination) => destination.to)

    expect(offered.slice(0, SETTINGS_SECTIONS.length)).toEqual(
      SETTINGS_SECTIONS.map((section) => section.to),
    )
  })

  it('go on to the unit and workspace tree and then the people, which are administration but not settings', () => {
    expect(ORGANISATION_DESTINATIONS.slice(-2).map((destination) => destination.to)).toEqual([
      ORGANISATION_STRUCTURE,
      ORGANISATION_PEOPLE,
    ])
  })

  it('keep every settings screen under the settings home, which the person menu offers as one item', () => {
    for (const destination of ORGANISATION_DESTINATIONS.slice(0, SETTINGS_SECTIONS.length)) {
      expect(destination.to.startsWith(`${ORGANISATION_SETTINGS_HOME}/`)).toBe(true)
    }
    expect(ORGANISATION_STRUCTURE.startsWith(ORGANISATION_SETTINGS_HOME)).toBe(false)
    expect(ORGANISATION_PEOPLE.startsWith(ORGANISATION_SETTINGS_HOME)).toBe(false)
  })
})
