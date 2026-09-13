import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { PUBLIC_SITE_STYLESHEETS, styleSheetPath } from '@quill/design-css'

/**
 * The public site ships plain CSS, so the semantic layer `tokens.css` declares
 * inside Tailwind's `@theme` is restated in `public-site.css` as ordinary
 * custom properties. Two files declaring one set of values is exactly the
 * drift `generated-css.test.ts` exists to prevent for the palettes, so the
 * same move is made here — and it is **set equality**, not an intersection: a
 * token added to `tokens.css` and forgotten here would resolve to nothing on
 * the web while looking right in the app, which is the precise failure this
 * file exists to catch. Adding a token therefore forces a decision: share it,
 * or name it in `APP_ONLY` with a reason.
 */

/** Every `--name: value` a stylesheet declares, last declaration winning. */
function declarations(css: string): ReadonlyMap<string, string> {
  const declared = new Map<string, string>()
  for (const [, name, value] of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gu)) {
    /* v8 ignore next -- both capture groups are mandatory in the pattern. */
    if (name === undefined || value === undefined) continue
    declared.set(name, value.replaceAll(/\s+/gu, ' ').trim())
  }
  return declared
}

/**
 * Names the two files declare differently on purpose.
 *
 * `--anchor-offset` is where a heading lands when it is scrolled to, which is
 * the height of whichever bar is above it: the application shell's in the app,
 * the site header's on the web.
 */
const DELIBERATELY_DIFFERENT = new Set(['--anchor-offset'])

/**
 * Names `tokens.css` declares that the public site deliberately does not.
 *
 * Each one is here because nothing the public site renders can ask for it: the
 * shell, the overlays and the density axis belong to the application, and the
 * fallback families, radii and per-size line heights are redeclared by every
 * generated theme (ADR-028) or by `prose.css` itself, so restating a
 * last-resort value here would be a second answer nobody reads.
 */
const APP_ONLY = new Set([
  // The application shell's bar, and the scroll offset derived from it.
  '--spacing-shell-header',
  // Overlay and elevation, which the public site has none of.
  '--shadow-raised',
  '--shadow-overlay',
  '--shadow-dialog',
  // Tailwind's own transition defaults, which only utilities read.
  '--default-transition-duration',
  '--default-transition-timing-function',
])

/**
 * Names a generated theme redeclares on every page, so a value here would be a
 * last-resort fallback the public site never reaches.
 */
const GENERATED_BY_THE_THEME = /^--(font|radius|layout|palette|token|density-scale)/u

/** Per-size line heights, which `prose.css` sets on the element instead. */
const SIZE_LINE_HEIGHT = /--line-height$/u

/** `tokens.css` is this package's; the plain CSS is `@quill/design-css`'s. */
const read = (name: string): string =>
  readFileSync(
    name === 'tokens.css' ? new URL(name, import.meta.url) : styleSheetPath(name),
    'utf8',
  )

describe('the public site stylesheet', () => {
  const tokens = declarations(read('tokens.css'))
  const publicSite = declarations(read('public-site.css'))

  /** What both files are expected to declare: everything else is named above. */
  const shared = [...tokens.keys()].filter(
    (name) =>
      !APP_ONLY.has(name) && !GENERATED_BY_THE_THEME.test(name) && !SIZE_LINE_HEIGHT.test(name),
  )

  it('declares exactly the tokens the application declares, and no fewer', () => {
    expect(shared.length).toBeGreaterThan(20)
    expect(shared.filter((name) => !publicSite.has(name))).toEqual([])
  })

  it('declares each of them with the same value', () => {
    const compared = shared.filter((name) => !DELIBERATELY_DIFFERENT.has(name))
    expect(Object.fromEntries(compared.map((name) => [name, publicSite.get(name)]))).toEqual(
      Object.fromEntries(compared.map((name) => [name, tokens.get(name)])),
    )
  })

  it('carries every semantic colour name a component or the prose can ask for', () => {
    const semantic = [...tokens.keys()].filter((name) => name.startsWith('--color-'))
    expect(semantic.length).toBeGreaterThan(0)
    expect(semantic.filter((name) => !publicSite.has(name))).toEqual([])
  })

  /**
   * The check above is only worth having if it can fail, so this is the proof:
   * a token the application declares and the public site does not is found.
   */
  it('would notice a token the public site had forgotten', () => {
    const forgotten = declarations('--text-sm: 0.875rem;')
    expect(shared.filter((name) => !forgotten.has(name)).length).toBeGreaterThan(0)
  })

  it('names the stylesheets the server serves, in the order they cascade', () => {
    expect(PUBLIC_SITE_STYLESHEETS).toEqual(['public-site.css', 'layout.css', 'prose.css'])
  })

  it('resolves each of them to a file that exists', () => {
    for (const name of PUBLIC_SITE_STYLESHEETS) expect(read(name).length).toBeGreaterThan(0)
  })
})
