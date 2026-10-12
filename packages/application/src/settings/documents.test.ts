import { BUILTIN_THEMES, DEFAULT_THEME } from '@quill/theme'
import { describe, expect, it } from 'vitest'

import {
  defaultOrganisationSettings,
  defaultWorkspaceSettings,
  ORGANISATION_SETTINGS_PATH,
  parseOrganisationSettings,
  parseWorkspaceSettings,
  recommendedLayout,
  SECRET_NAME_PATTERN,
  validateOrganisationSettings,
  validateWorkspaceSettings,
  WORKSPACE_SETTINGS_VERSION,
  workspaceSettingsPath,
} from './documents.ts'
import { LAYOUT_CHOICES, LAYOUT_SLOTS } from './layout.ts'

const organisation = defaultOrganisationSettings()

describe('paths', () => {
  it('puts the organisation settings in the system workspace', () => {
    expect(ORGANISATION_SETTINGS_PATH).toMatch(/^\.[a-z]+\/organisation\.yaml$/)
  })

  it('gives each workspace its own file, named by its id', () => {
    expect(workspaceSettingsPath('w-1')).toMatch(/^\.[a-z]+\/workspaces\/w-1\.yaml$/)
  })
})

describe('defaults', () => {
  it('are valid organisation settings', () => {
    expect(validateOrganisationSettings(organisation)).toMatchObject({ valid: true })
  })

  it('start from the built-in default theme (ADR-028)', () => {
    expect(organisation.theme).toEqual(DEFAULT_THEME)
  })

  it('take the layout the theme recommends, and leave it unlocked', () => {
    expect(organisation.layout).toEqual({ default: DEFAULT_THEME.variants, locked: false })
  })

  it('allow share links, withhold public publishing, and enforce contrast', () => {
    expect(organisation.policies).toEqual({
      shareLinksAllowed: true,
      publicPublishingAllowed: false,
      contrastEnforcement: 'enforced',
    })
  })

  it('can be built on any theme, taking that theme’s recommended layout', () => {
    for (const theme of Object.values(BUILTIN_THEMES)) {
      expect(defaultOrganisationSettings(theme).layout.default).toEqual(recommendedLayout(theme))
    }
  })

  it('reads back an organisation on Calm, whose layout divides sections with plain space', () => {
    const settings = defaultOrganisationSettings(BUILTIN_THEMES.calm)
    expect(settings.layout.default.rules).toBe('plain')
    expect(parseOrganisationSettings(settings)).toEqual(settings)
  })

  it('reads back an organisation on Grid, whose reading column starts beside the navigation', () => {
    const settings = defaultOrganisationSettings(BUILTIN_THEMES.grid)
    expect(settings.layout.default.align).toBe('start')
    expect(validateOrganisationSettings(settings)).toMatchObject({ valid: true })
    expect(parseOrganisationSettings(settings)).toEqual(settings)
  })

  it('reads a layout saved before alignment existed as centred, by leaving it unstated', () => {
    const { align: _align, ...before } = defaultOrganisationSettings(BUILTIN_THEMES.grid).layout
      .default
    const settings = { ...organisation, layout: { ...organisation.layout, default: before } }
    expect(validateOrganisationSettings(settings)).toMatchObject({ valid: true })
  })

  it('refuses an alignment outside the bounded set', () => {
    const settings = {
      ...organisation,
      layout: {
        ...organisation.layout,
        default: { ...organisation.layout.default, align: 'justify' },
      },
    }
    expect(validateOrganisationSettings(settings)).toMatchObject({ valid: false })
  })

  it('give a workspace a file that inherits everything', () => {
    expect(defaultWorkspaceSettings('w-1')).toEqual({
      version: WORKSPACE_SETTINGS_VERSION,
      workspaceId: 'w-1',
    })
    expect(validateWorkspaceSettings(defaultWorkspaceSettings('w-1'))).toMatchObject({
      valid: true,
    })
  })
})

describe('validation', () => {
  it('reports every problem at once, with a pointer to each', () => {
    const result = validateOrganisationSettings({ ...organisation, name: '', publicMenu: 3 })
    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('expected the document to be refused')
    expect(result.issues.map((issue) => issue.path).toSorted()).toEqual(['/name', '/publicMenu'])
  })

  it('refuses a document with fields nobody declared', () => {
    expect(validateOrganisationSettings({ ...organisation, surprise: true })).toMatchObject({
      valid: false,
    })
  })

  it('refuses a layout variant outside the bounded set (ADR-028)', () => {
    const layout = { ...organisation.layout, default: { ...organisation.layout.default } }
    const result = validateOrganisationSettings({
      ...organisation,
      layout: { ...layout, default: { ...layout.default, rules: 'shadows' } },
    })
    expect(result).toMatchObject({ valid: false })
  })

  it('accepts every value the bounded set does offer', () => {
    for (const slot of LAYOUT_SLOTS) {
      for (const choice of LAYOUT_CHOICES[slot]) {
        const result = validateOrganisationSettings({
          ...organisation,
          layout: {
            ...organisation.layout,
            default: { ...organisation.layout.default, [slot]: choice },
          },
        })
        expect(result, `${slot}=${choice}`).toMatchObject({ valid: true })
      }
    }
  })

  it('refuses a logo that is not a content hash', () => {
    expect(
      validateOrganisationSettings({
        ...organisation,
        logo: { hash: 'not-a-hash', mediaType: 'image/png', alt: '' },
      }),
    ).toMatchObject({ valid: false })
  })

  it('accepts a logo referenced by its blob hash', () => {
    expect(
      validateOrganisationSettings({
        ...organisation,
        logo: { hash: 'a'.repeat(64), mediaType: 'image/svg+xml', alt: 'Acme' },
      }),
    ).toMatchObject({ valid: true })
  })

  it('runs the theme package’s own checks over the theme inside it', () => {
    const result = validateOrganisationSettings({
      ...organisation,
      theme: {
        ...organisation.theme,
        // A real curated face, but one the mono role is not offered: the
        // schema cannot say that, and the theme package's validator can.
        type: { ...organisation.theme.type, mono: { source: 'curated', id: 'inter' } },
      },
    })
    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('expected the theme to be refused')
    expect(result.issues[0]?.path).toBe('/theme/type/mono')
  })

  it('refuses a theme that is not a theme document at all', () => {
    expect(validateOrganisationSettings({ ...organisation, theme: {} })).toMatchObject({
      valid: false,
    })
  })

  it('refuses a contrast policy outside the two ADR-028 names', () => {
    expect(
      validateOrganisationSettings({
        ...organisation,
        policies: { ...organisation.policies, contrastEnforcement: 'off' },
      }),
    ).toMatchObject({ valid: false })
  })

  it('refuses workspace settings with a layout outside the set', () => {
    expect(
      validateWorkspaceSettings({
        version: WORKSPACE_SETTINGS_VERSION,
        workspaceId: 'w-1',
        layout: { ...organisation.layout.default, navigation: 'carousel' },
      }),
    ).toMatchObject({ valid: false })
  })
})

describe('version dispatch (rule 17)', () => {
  it('reads the version this release writes', () => {
    expect(parseOrganisationSettings(organisation)).toEqual(organisation)
    expect(parseWorkspaceSettings(defaultWorkspaceSettings('w-1'))).not.toBeNull()
  })

  it('refuses a version no shipped reader understands, rather than guessing', () => {
    expect(parseOrganisationSettings({ ...organisation, version: 99 })).toBeNull()
    expect(parseWorkspaceSettings({ version: 99, workspaceId: 'w-1' })).toBeNull()
  })

  it('refuses a document with no version at all', () => {
    const { version: _version, ...withoutVersion } = organisation
    expect(parseOrganisationSettings(withoutVersion)).toBeNull()
  })

  it('refuses a document of the right version but the wrong shape', () => {
    expect(parseOrganisationSettings({ version: organisation.version })).toBeNull()
    expect(parseWorkspaceSettings({ version: WORKSPACE_SETTINGS_VERSION })).toBeNull()
  })
})

const matches = (name: string): boolean => new RegExp(SECRET_NAME_PATTERN).test(name)

describe('secret names', () => {
  it('accepts the path-like names settings files reference', () => {
    expect(matches('oidc/entra/client-secret')).toBe(true)
    expect(matches('smtp.password')).toBe(true)
  })

  it('refuses anything that could be confused for another name', () => {
    expect(matches('OIDC/Entra')).toBe(false)
    expect(matches('/leading')).toBe(false)
    expect(matches('trailing/')).toBe(false)
    expect(matches('two//slashes')).toBe(false)
    expect(matches('')).toBe(false)
  })
})
