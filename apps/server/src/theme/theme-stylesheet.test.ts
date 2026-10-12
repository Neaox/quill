import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES, CURATED_FACE_FILES, forkTheme, generateTheme, press } from '@quill/theme'
import type { ThemeDocument } from '@quill/theme'

import { createHasher } from '../infrastructure/hasher.ts'
import { createFaceFiles, FONT_ROUTE_PREFIX } from './face-files.ts'
import {
  createThemeStylesheets,
  deliveryScope,
  THEME_STYLESHEET_PATH,
  themeIdentity,
} from './theme-stylesheet.ts'

const faceFiles = await createFaceFiles(async (packageName, file) =>
  Buffer.from(`${packageName}/${file}`),
)
const stylesheets = () => createThemeStylesheets({ hasher: createHasher(), faceFiles })

/** The declarations of the block opened by exactly this line. */
const block = (css: string, opening: string): string => {
  const start = css.indexOf(`${opening}\n`)
  expect(start, `no block opens with ${opening}`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

/**
 * A theme an organisation customised from Press and saved before Press was
 * superseded by Editorial: the whole document, base and all, exactly as it
 * sits in a settings file today (AGENTS.md rule 17).
 */
const custom: ThemeDocument = {
  ...press,
  id: 'organisation-theme',
  name: 'Acme',
  base: 'press',
  seeds: { ...press.seeds, accent: { hue: 150, chroma: 0.12 } },
}

describe('the identity a theme applies under', () => {
  it('is a built-in’s own id', () => {
    expect(themeIdentity(BUILTIN_THEMES.atelier)).toBe('atelier')
  })

  it('is the built-in a customised theme was forked from, even one since superseded', () => {
    expect(themeIdentity(custom)).toBe('press')
    expect(themeIdentity(forkTheme('press', { id: 'acme', name: 'Acme' }))).toBe('editorial')
  })

  it('refuses an identity that is not a plain word, because it becomes a selector', () => {
    expect(() => themeIdentity({ ...BUILTIN_THEMES.atelier, id: "x'] body {" })).toThrow(
      /Not a theme identity/u,
    )
  })

  it('is the theme’s own id when it was never forked', () => {
    const { base: _base, ...unforked } = custom
    expect(themeIdentity({ ...unforked, id: 'acme' })).toBe('acme')
  })

  it('is one more type selector than any bundled identity, so it wins in either order', () => {
    expect(deliveryScope('press')).toBe("html:root[data-theme-id='press']")
  })
})

describe('the delivered stylesheet', () => {
  it('is what the generator writes, light, dark by preference, and both by choice', () => {
    const sheet = stylesheets().forTheme(custom)
    const generated = generateTheme(custom)
    const scope = deliveryScope('press')

    const light = block(sheet.css, `${scope} {`)
    const preferred = block(sheet.css, `  ${scope}:not([data-theme='light']) {`)
    const chosenDark = block(sheet.css, `${scope}[data-theme='dark'] {`)
    expect(sheet.css).toContain('@media (prefers-color-scheme: dark) {')
    expect(block(sheet.css, `${scope}[data-theme='light'] {`)).toContain('color-scheme: light;')

    // Every token the generator emits, whatever it is — a role added to the
    // generator is delivered without anybody touching this module.
    for (const [name, value] of Object.entries(generated.light)) {
      expect(light).toContain(`${name}: ${value};`)
    }
    for (const [name, value] of Object.entries(generated.dark)) {
      expect(preferred).toContain(`${name}: ${value};`)
      expect(chosenDark).toContain(`${name}: ${value};`)
    }
  })

  it('colours the organisation’s labels, in both schemes, under the same scope (ADR-037)', () => {
    const labelled: ThemeDocument = {
      ...custom,
      labels: [{ name: 'airbnb', title: 'Airbnb', hue: 15 }],
    }
    const sheet = stylesheets().forTheme(labelled)
    const scope = deliveryScope('press')
    const [airbnb] = generateTheme(labelled).labels

    expect(block(sheet.css, `${scope} {`)).toContain(`--label-airbnb-ink: ${airbnb?.light.ink};`)
    expect(block(sheet.css, `${scope}[data-theme='dark'] {`)).toContain(
      `--label-airbnb-ink: ${airbnb?.dark.ink};`,
    )
    expect(sheet.css).toContain(`${scope} .badge[data-label='airbnb'] {`)
    expect(sheet.css).toContain(`${scope} .diagram[data-diagram='svg'] :is(.airbnb, .airbnb *)`)
    expect(sheet.hash).not.toBe(stylesheets().forTheme(custom).hash)
  })

  it('declares the faces the theme names, at this server’s content-addressed font addresses', () => {
    const sheet = stylesheets().forTheme(press)
    const { package: packageName, files } = CURATED_FACE_FILES.newsreader
    for (const { file } of files) {
      expect(sheet.css).toContain(`url('${faceFiles.href(packageName, file)}') format('woff2')`)
    }
    expect(faceFiles.href(packageName, files[0]?.file ?? '')).toMatch(
      new RegExp(`^${FONT_ROUTE_PREFIX}/newsreader-latin-wght-normal\\.[0-9a-f]{16}\\.woff2$`, 'u'),
    )
    expect(sheet.css).not.toContain('IBM Plex')
  })

  it('is addressed by a hash of its own content, linked with that hash as a cache key', () => {
    const sheet = stylesheets().forTheme(BUILTIN_THEMES.instrument)
    expect(sheet.hash).toBe(createHasher().contentHash(sheet.css).slice(0, 32))
    expect(sheet.href).toBe(`${THEME_STYLESHEET_PATH}?v=${sheet.hash}`)
  })

  it('is generated once per theme, and differs between themes', () => {
    const sheets = stylesheets()
    const saved = sheets.forTheme(press)
    expect(sheets.forTheme(press)).toBe(saved)
    expect(sheets.forTheme({ ...press })).toBe(saved)
    expect(sheets.forTheme(custom).hash).not.toBe(saved.hash)
  })

  it('keeps a bounded number of themes, and regenerates one it let go of identically', () => {
    const sheets = stylesheets()
    const first = sheets.forTheme(BUILTIN_THEMES.instrument)
    for (let hue = 0; hue < 20; hue += 1) {
      sheets.forTheme(
        forkTheme('instrument', {
          id: 'many',
          name: 'Many',
          seeds: { accent: { hue, chroma: 0.1 } },
        }),
      )
    }
    const again = sheets.forTheme(BUILTIN_THEMES.instrument)
    expect(again).not.toBe(first)
    expect(again.css).toBe(first.css)
  })
})
