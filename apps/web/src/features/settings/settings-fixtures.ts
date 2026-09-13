import { DEFAULT_THEME } from '@quill/theme/builtin'

import type { OrganisationSettings, SecretDto } from '../../lib/api/index.ts'
import { jsonResponse, type FakeRouteHandler } from '../../lib/api/testing.ts'

/**
 * The fixtures every settings screen's test builds on.
 *
 * They live beside the screens rather than in each test file because five
 * suites need the same organisation document and the same `me`, and a
 * settings document is large enough that five copies of it would drift within
 * a release. Nothing outside a test imports this module.
 */

export const admin = (): Response =>
  jsonResponse(200, {
    id: 'user-1',
    email: 'admin@example.com',
    displayName: 'Admin',
    emailVerified: true,
    isInstanceAdmin: true,
  })

export const member = (): Response =>
  jsonResponse(200, {
    id: 'user-2',
    email: 'member@example.com',
    displayName: 'Member',
    emailVerified: true,
    isInstanceAdmin: false,
  })

export function organisationSettings(
  overrides: Partial<OrganisationSettings> = {},
): OrganisationSettings {
  return {
    version: 1,
    name: 'Acme',
    theme: DEFAULT_THEME,
    layout: { default: DEFAULT_THEME.variants, locked: false },
    publicNavigation: [{ label: 'Handbook', href: '/handbook' }],
    policies: {
      shareLinksAllowed: true,
      publicPublishingAllowed: false,
      contrastEnforcement: 'enforced',
    },
    ...overrides,
  }
}

export const REVISION = 'a'.repeat(40)
export const NEXT_REVISION = 'b'.repeat(40)

/** `GET /api/settings/organisation` answering a document at `REVISION`. */
export function readOrganisation(
  settings: OrganisationSettings = organisationSettings(),
  revision: string | null = REVISION,
): FakeRouteHandler {
  return () => jsonResponse(200, { revision, settings })
}

/** The doctor's verdict a `PUT` answers with, with one rule per status. */
export function themeReport(overrides: { readonly enforcedWarns?: boolean } = {}) {
  const enforcedWarns = overrides.enforcedWarns ?? false
  return {
    themeId: 'instrument',
    results: [
      {
        id: 'legibility.text-contrast',
        section: 1,
        title: 'Text meets AA',
        status: enforcedWarns ? ('warn' as const) : ('pass' as const),
        detail: enforcedWarns ? 'body on surface is 3.1:1, below 4.5:1' : 'every pair is above 4.5',
        enforced: true,
      },
      {
        id: 'uniformity.gamut',
        section: 7,
        title: 'Every colour is in gamut',
        status: 'adjusted' as const,
        detail: 'accent chroma reduced to fit sRGB',
        enforced: false,
      },
    ],
    summary: { pass: enforcedWarns ? 0 : 1, adjusted: 1, warn: enforcedWarns ? 1 : 0 },
    adjustments: [{ role: 'accent', property: 'chroma', reason: 'gamut', from: 0.2, to: 0.185 }],
    enforcedRulesHold: !enforcedWarns,
  }
}

export function secret(name: string, overrides: Partial<SecretDto> = {}): SecretDto {
  return {
    name,
    keyId: 'key-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    rotatedAt: null,
    rewrappedAt: null,
    ...overrides,
  }
}
