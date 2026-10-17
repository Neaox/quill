import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES, press } from '@quill/theme'
import { tokenCssContract, tokenStylesheet } from '@quill/highlight'

import { createHasher } from '../infrastructure/hasher.ts'
import { createFaceFiles } from '../theme/face-files.ts'
import { createThemeStylesheets } from '../theme/theme-stylesheet.ts'
import {
  ASSET_MAX_AGE_SECONDS,
  createPublicStylesheets,
  loadDesignSystemCss,
  publicAssetHref,
  PUBLIC_ASSET_PREFIX,
} from './stylesheet.ts'

/**
 * The stylesheet is generated from the organisation's theme, addressed by its
 * own hash, and generated once per theme rather than once per request.
 */

const faceFiles = await createFaceFiles(async (_packageName, file) => Buffer.from(file))
const themeStylesheets = () => createThemeStylesheets({ hasher: createHasher(), faceFiles })

const stylesheets = (designSystemCss = '.prose { color: red }') =>
  createPublicStylesheets({
    hasher: createHasher(),
    themeStylesheets: themeStylesheets(),
    designSystemCss,
  })

describe('the public stylesheet', () => {
  it('carries the theme, the syntax colours and the design system, in that order', () => {
    const sheet = stylesheets().forTheme(BUILTIN_THEMES.instrument)
    expect(sheet.css).toContain('--palette-background')
    expect(sheet.css).toContain('--token-keyword')
    expect(sheet.css.indexOf('--palette-background')).toBeLessThan(
      sheet.css.indexOf('.prose { color: red }'),
    )
  })

  /**
   * ADR-030's contract covers the public site as it covers the application:
   * every token class has its colour variable from the theme, light and dark,
   * and both selector families read it, as the one rule text `packages/ui`
   * also writes, so code is never coloured on one surface and plain on another.
   */
  it.each(Object.entries(BUILTIN_THEMES))('colours every token class in %s', (_id, theme) => {
    const { css } = stylesheets().forTheme(theme)
    expect(css).toContain(tokenStylesheet())
    const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))
    for (const variable of tokenCssContract().variables) {
      expect(css.indexOf(`${variable}:`), `${variable} in light`).toBeGreaterThanOrEqual(0)
      expect(dark.indexOf(`${variable}:`), `${variable} in dark`).toBeGreaterThanOrEqual(0)
    }
  })

  it('opens with the very stylesheet the application links, faces and all', () => {
    const theme = themeStylesheets().forTheme(press)
    const sheet = stylesheets().forTheme(press)
    expect(sheet.css.startsWith(theme.css)).toBe(true)
    expect(sheet.css).toContain('@font-face')
    expect(sheet.identity).toBe('press')
  })

  it('carries light at the root and dark under the reader’s own preference', () => {
    const sheet = stylesheets().forTheme(BUILTIN_THEMES.instrument)
    expect(sheet.css).toContain('color-scheme: light')
    expect(sheet.css).toContain('@media (prefers-color-scheme: dark)')
    expect(sheet.css).toContain("[data-theme='dark']")
  })

  it('is addressed by a hash of its own content', () => {
    const sheet = stylesheets().forTheme(BUILTIN_THEMES.instrument)
    expect(sheet.hash).toBe(createHasher().contentHash(sheet.css).slice(0, 32))
    expect(sheet.href).toBe(`${PUBLIC_ASSET_PREFIX}/theme-${sheet.hash}.css`)
    expect(publicAssetHref(sheet.hash)).toBe(sheet.href)
    expect(sheet.hash).toMatch(/^[0-9a-f]{32}$/u)
  })

  it('gives two themes two addresses, and one theme one object', () => {
    const sheets = stylesheets()
    const instrument = sheets.forTheme(BUILTIN_THEMES.instrument)
    const saved = sheets.forTheme(press)
    expect(instrument.hash).not.toBe(saved.hash)
    // The same theme under a different design system is a different sheet,
    // so an upgrade can never hide behind a year-long immutable copy.
    expect(stylesheets('.prose { color: blue }').forTheme(press).hash).not.toBe(saved.hash)
    // The identical object, so a page view after the first pays nothing.
    expect(sheets.forTheme(BUILTIN_THEMES.instrument)).toBe(instrument)
  })

  /**
   * The address is served `immutable` for a year, so it has to change
   * whenever the bytes do — and a release that restyles the site's chrome
   * changes them without touching anybody's theme.
   */
  it('moves to a new address when the design system changes, not only the theme', () => {
    const before = stylesheets('.site-header { color: red }').forTheme(BUILTIN_THEMES.instrument)
    const after = stylesheets('.site-header { color: blue }').forTheme(BUILTIN_THEMES.instrument)
    expect(after.hash).not.toBe(before.hash)
  })

  it('serves a hash it has generated, and refuses one it has not', () => {
    const sheets = stylesheets()
    const sheet = sheets.forTheme(BUILTIN_THEMES.atelier)
    expect(sheets.byHash(sheet.hash)).toBe(sheet)
    expect(sheets.byHash('0'.repeat(32))).toBeNull()
  })

  it('is immutable for a year, because its address is its content', () => {
    expect(ASSET_MAX_AGE_SECONDS).toBe(31_536_000)
  })
})

describe('the design system CSS', () => {
  it('is read from the package, once', async () => {
    const css = await loadDesignSystemCss()
    expect(css).toContain('.prose')
    expect(css).toContain('.layout-grid')
    expect(css).toContain('.site-header')
    // Memoised: the second call is the same promise, not a second read.
    expect(await loadDesignSystemCss()).toBe(css)
  })
})
