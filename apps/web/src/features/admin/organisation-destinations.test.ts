import { describe, expect, it } from 'vitest'

import { SETTINGS_SECTIONS } from '../settings/settings-sections.ts'
import { ORGANISATION_DESTINATIONS } from './organisation-destinations.ts'

describe('the organisation destinations', () => {
  it('offer every settings screen, in the settings navigation’s own order', () => {
    const offered = ORGANISATION_DESTINATIONS.map((destination) => destination.to)

    expect(offered.slice(0, SETTINGS_SECTIONS.length)).toEqual(
      SETTINGS_SECTIONS.map((section) => section.to),
    )
  })

  it('end with the unit and workspace tree, which is administration but not a setting', () => {
    expect(ORGANISATION_DESTINATIONS.at(-1)?.to).toBe('/admin/organisation')
  })
})
