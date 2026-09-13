import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES } from '@quill/theme'

import { createHasher } from '../infrastructure/hasher.ts'
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

const stylesheets = (designSystemCss = '.prose { color: red }') =>
  createPublicStylesheets({ hasher: createHasher(), designSystemCss })

describe('the public stylesheet', () => {
  it('carries the theme, the syntax colours and the design system, in that order', () => {
    const sheet = stylesheets().forTheme(BUILTIN_THEMES.instrument)
    expect(sheet.css).toContain('--palette-background')
    expect(sheet.css).toContain('--token-keyword')
    expect(sheet.css.indexOf('--palette-background')).toBeLessThan(
      sheet.css.indexOf('.prose { color: red }'),
    )
  })

  it('carries light at the root and dark under the reader’s own preference', () => {
    const sheet = stylesheets().forTheme(BUILTIN_THEMES.instrument)
    expect(sheet.css).toContain('color-scheme: light')
    expect(sheet.css).toContain('@media (prefers-color-scheme: dark)')
    expect(sheet.css).toContain("[data-theme='dark']")
  })

  it('is addressed by the hash of the theme that produced it', () => {
    const sheet = stylesheets().forTheme(BUILTIN_THEMES.instrument)
    expect(sheet.href).toBe(`${PUBLIC_ASSET_PREFIX}/theme-${sheet.hash}.css`)
    expect(publicAssetHref(sheet.hash)).toBe(sheet.href)
    expect(sheet.hash).toMatch(/^[0-9a-f]{32}$/u)
  })

  it('gives two themes two addresses, and one theme one object', () => {
    const sheets = stylesheets()
    const instrument = sheets.forTheme(BUILTIN_THEMES.instrument)
    const press = sheets.forTheme(BUILTIN_THEMES.press)
    expect(instrument.hash).not.toBe(press.hash)
    // The identical object, so a page view after the first pays nothing.
    expect(sheets.forTheme(BUILTIN_THEMES.instrument)).toBe(instrument)
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
