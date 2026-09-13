import { describe, expect, it } from 'vitest'

import { defaultOrganisationSettings, defaultWorkspaceSettings } from './documents.ts'
import type { Layout } from './layout.ts'
import { resolveEffectiveSettings } from './resolve.ts'

const organisation = defaultOrganisationSettings()

const OVERRIDE: Layout = {
  comments: 'sidenotes',
  history: 'timeline',
  navigation: 'tabs',
  header: 'breadcrumb',
  rules: 'cards',
}

const withOverride = { ...defaultWorkspaceSettings('w-1'), layout: OVERRIDE }

describe('resolving down the ADR-028 table', () => {
  it('inherits the organisation default when the workspace has no file', () => {
    const effective = resolveEffectiveSettings(organisation, null)
    expect(effective.layout).toEqual(organisation.layout.default)
    expect(effective.layoutSource).toBe('organisation')
  })

  it('inherits it when the workspace has a file but no override', () => {
    const effective = resolveEffectiveSettings(organisation, defaultWorkspaceSettings('w-1'))
    expect(effective.layoutSource).toBe('organisation')
  })

  it('gives the workspace its own layout when it has one', () => {
    const effective = resolveEffectiveSettings(organisation, withOverride)
    expect(effective.layout).toEqual(OVERRIDE)
    expect(effective.layoutSource).toBe('workspace')
  })

  it('ignores an override the organisation has locked out', () => {
    const locked = { ...organisation, layout: { ...organisation.layout, locked: true } }
    const effective = resolveEffectiveSettings(locked, withOverride)
    expect(effective.layout).toEqual(organisation.layout.default)
    expect(effective.layoutSource).toBe('organisation')
    expect(effective.layoutLocked).toBe(true)
  })

  it('carries identity, policy and navigation down unchanged: they are the organisation’s', () => {
    const configured = {
      ...organisation,
      name: 'Acme',
      publicNavigation: [{ label: 'Handbook', href: '/handbook' }],
      policies: {
        shareLinksAllowed: false,
        publicPublishingAllowed: true,
        contrastEnforcement: 'advisory' as const,
      },
      logo: { hash: 'a'.repeat(64), mediaType: 'image/png' as const, alt: 'Acme' },
    }
    expect(resolveEffectiveSettings(configured, withOverride)).toMatchObject({
      theme: configured.theme,
      contrastEnforcement: 'advisory',
      organisationName: 'Acme',
      publicNavigation: configured.publicNavigation,
      policies: configured.policies,
      logo: configured.logo,
    })
  })

  it('omits the logo entirely when there is none, rather than reporting an empty one', () => {
    expect('logo' in resolveEffectiveSettings(organisation, null)).toBe(false)
  })
})
