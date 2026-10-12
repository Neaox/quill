import {
  defaultOrganisationSettings,
  ORGANISATION_SETTINGS_PATH,
  SETTINGS_VERSION,
  SYSTEM_WORKSPACE_ID,
} from '@quill/application'
import type { OrganisationSettings } from '@quill/application'
import { press, type ThemeDocument } from '@quill/theme'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * The organisation's theme, delivered (ADR-028, "Delivery";
 * `docs/architecture/api-contract-settings.md`).
 *
 * The three routes every page that renders with the theme needs: the identity
 * and the address to link, the stylesheet at that address, and the faces the
 * stylesheet names. All three answer without a session, because a share link
 * and the public site render with the theme and neither has one.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

interface ThemeSummary {
  readonly themeId: string
  readonly stylesheetHref: string
  readonly attributes: Readonly<Record<string, string>>
  readonly labels: readonly string[]
}

const summary = async (): Promise<ThemeSummary> => {
  const response = await harness.app.inject({
    method: 'GET',
    url: '/api/settings/organisation/theme',
  })
  expect(response.statusCode).toBe(200)
  return response.json<ThemeSummary>()
}

const stylesheet = (url = '/api/settings/organisation/theme.css', etag?: string) =>
  harness.app.inject({
    method: 'GET',
    url,
    ...(etag === undefined ? {} : { headers: { 'if-none-match': etag } }),
  })

const save = async (settings: OrganisationSettings) => {
  const current = await harness.app.inject({
    method: 'GET',
    url: '/api/settings/organisation',
    cookies: admin,
  })
  const response = await harness.app.inject({
    method: 'PUT',
    url: '/api/settings/organisation',
    cookies: admin,
    payload: { settings, expectedRevision: current.json<{ revision: string | null }>().revision },
  })
  expect(response.statusCode).toBe(200)
}

/**
 * A theme customised from Press and saved before Press was superseded by
 * Editorial: it must still save, load, and render as Press (AGENTS.md rule 17).
 */
const customised: ThemeDocument = {
  ...press,
  id: 'organisation-theme',
  name: 'Acme',
  base: 'press',
  seeds: { ...press.seeds, accent: { hue: 150, chroma: 0.12 } },
}

describe('the theme summary', () => {
  it('names the identity and the stylesheet to link, to anybody, signed in or not', async () => {
    expect(await summary()).toEqual({
      themeId: 'instrument',
      stylesheetHref: expect.stringMatching(
        /^\/api\/settings\/organisation\/theme\.css\?v=[0-9a-f]{32}$/u,
      ),
      // The default layout's rules; Instrument states no alignment.
      attributes: { 'data-rules': defaultOrganisationSettings().layout.default.rules },
      labels: [],
      emoji: [],
      labelEmoji: {},
    })
  })

  it('is never kept without asking: a saved theme must show on the next page', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/settings/organisation/theme',
    })
    expect(response.headers['cache-control']).toBe('no-cache')
  })
})

describe('the theme stylesheet', () => {
  it('is CSS, readable without a session, and validated by its content hash', async () => {
    const response = await stylesheet()
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/css; charset=utf-8')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['cache-control']).toBe('public, no-cache')

    const { stylesheetHref } = await summary()
    const hash = stylesheetHref.split('?v=')[1]
    expect(response.headers.etag).toBe(`"${hash}"`)
  })

  it('carries the generated theme, light, dark, both choices, and its faces', async () => {
    const css = (await stylesheet()).body
    expect(css).toContain("html:root[data-theme-id='instrument'] {")
    expect(css).toContain('@media (prefers-color-scheme: dark) {')
    expect(css).toContain("html:root[data-theme-id='instrument'][data-theme='dark'] {")
    expect(css).toContain("html:root[data-theme-id='instrument'][data-theme='light'] {")
    expect(css).toContain('--palette-accent:')
    expect(css).toContain("font-family: 'IBM Plex Sans';")
  })

  it('answers 304 to a reader who already holds it, and nothing else', async () => {
    const etag = (await stylesheet()).headers.etag
    expect(typeof etag).toBe('string')
    const again = await stylesheet(undefined, String(etag))
    expect(again.statusCode).toBe(304)
    expect(again.body).toBe('')
    expect(again.headers.etag).toBe(etag)
  })

  it('answers the same sheet at the address the summary gave, which only keys a cache', async () => {
    const { stylesheetHref } = await summary()
    expect((await stylesheet(stylesheetHref)).body).toBe((await stylesheet()).body)
  })

  it('changes, with its tag and its address, when an administrator saves a theme', async () => {
    const before = await summary()
    const oldTag = (await stylesheet()).headers.etag

    const defaults = defaultOrganisationSettings()
    await save({
      ...defaults,
      theme: { ...customised, labels: [{ name: 'airbnb', title: 'Airbnb', hue: 15 }] },
      layout: { ...defaults.layout, default: { ...defaults.layout.default, rules: 'cards' } },
    })

    const after = await summary()
    expect(after.themeId).toBe('press')
    // The organisation's layout decides the rules, over what Press recommends.
    expect(after.attributes).toEqual({ 'data-rules': 'cards' })
    expect(after.labels).toEqual(['airbnb'])
    expect(after.stylesheetHref).not.toBe(before.stylesheetHref)

    const response = await stylesheet(undefined, String(oldTag))
    expect(response.statusCode).toBe(200)
    expect(response.headers.etag).not.toBe(oldTag)
    expect(response.body).toContain("html:root[data-theme-id='press'] {")
    expect(response.body).toContain("font-family: 'Newsreader';")
  })
})

describe('the faces', () => {
  const firstFontAddress = async (): Promise<string> => {
    const match = /url\('(\/api\/fonts\/[^']+)'\)/u.exec((await stylesheet()).body)
    expect(match).not.toBeNull()
    return match?.[1] ?? ''
  }

  it('are served from the address the stylesheet names, immutable, to anybody', async () => {
    const response = await harness.app.inject({ method: 'GET', url: await firstFontAddress() })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('font/woff2')
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(response.rawPayload.subarray(0, 4).toString('latin1')).toBe('wOF2')
  })

  it('are a 404 for any name that is not one of them', async () => {
    for (const name of [
      'inter-latin-wght-normal.0000000000000000.woff2',
      '..%2F..%2Fpackage.json',
      'inter-latin-wght-normal.woff2',
    ]) {
      const response = await harness.app.inject({ method: 'GET', url: `/api/fonts/${name}` })
      expect(response.statusCode).toBe(404)
    }
  })
})

/** Last, because it leaves a file this release cannot read behind it. */
describe('settings this release cannot read', () => {
  it('are a refusal that names nothing, rather than somebody else’s theme', async () => {
    const before = await harness.deps.contentStore.readFile(
      SYSTEM_WORKSPACE_ID,
      ORGANISATION_SETTINGS_PATH,
    )
    await harness.deps.contentStore.putFile({
      workspaceId: SYSTEM_WORKSPACE_ID,
      path: ORGANISATION_SETTINGS_PATH,
      text: `version: ${SETTINGS_VERSION + 1}\nname: From the future\n`,
      expected: before?.text ?? null,
      author: { name: 'A newer release', email: 'future@example.com' },
    })

    for (const url of [
      '/api/settings/organisation/theme',
      '/api/settings/organisation/theme.css',
    ]) {
      const response = await harness.app.inject({ method: 'GET', url })
      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({
        error: { code: 'settings_unreadable', message: expect.any(String) },
      })
    }
  })
})
