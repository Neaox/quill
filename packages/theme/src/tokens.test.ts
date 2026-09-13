import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  PALETTE_TOKENS,
  SYNTAX_CLASSES,
  SYNTAX_CLASS_FAMILIES,
  SYNTAX_FAMILIES,
  SYNTAX_TOKENS,
  TOKEN_NAMES,
} from './tokens.ts'

// The default theme's generated stylesheet, not `tokens.css`: ADR-028 makes
// colour generated rather than written, so the `--palette-*` custom
// properties are declared here (and in each other theme's `.gen.css`, which
// `generated-css.test.ts` keeps in lockstep with this one) and only ever
// consumed, via `var()`, in the hand-written file.
const instrumentCss = readFileSync(
  fileURLToPath(new URL('../../ui/src/styles/generated/instrument.gen.css', import.meta.url)),
  'utf8',
)

describe('the palette token list', () => {
  it('is exactly what the generated stylesheet declares, so nothing resolves to nothing', () => {
    const declared = [...instrumentCss.matchAll(/^\s{2}(--palette-[a-z-]+):/gmu)].map(
      (match) => match[1],
    )
    expect(new Set(declared)).toEqual(new Set(PALETTE_TOKENS))
  })
})

describe('the syntax token classes', () => {
  it('covers every class ADR-030 names', () => {
    expect(SYNTAX_TOKENS).toHaveLength(SYNTAX_CLASSES.length)
    expect(SYNTAX_CLASSES).toContain('template-string')
    expect(SYNTAX_CLASSES).toContain('interpolation')
  })

  it('gives every class a family', () => {
    for (const name of SYNTAX_CLASSES) {
      expect(SYNTAX_FAMILIES).toContain(SYNTAX_CLASS_FAMILIES[name])
    }
  })

  it('names every family after a class, so the family variable is a class variable', () => {
    for (const family of SYNTAX_FAMILIES) {
      expect(SYNTAX_CLASS_FAMILIES[family]).toBe(family)
    }
  })

  it('states each colour once and aliases the rest', () => {
    const anchors = SYNTAX_CLASSES.filter((name) => SYNTAX_CLASS_FAMILIES[name] === name)
    expect(anchors).toHaveLength(SYNTAX_FAMILIES.length)
  })
})

describe('the full token list', () => {
  it('has no duplicates', () => {
    expect(new Set(TOKEN_NAMES).size).toBe(TOKEN_NAMES.length)
  })

  it('carries the type, shape and layout variables an export needs offline', () => {
    expect(TOKEN_NAMES).toEqual(
      expect.arrayContaining([
        '--font-display',
        '--font-reading',
        '--radius-md',
        '--layout-content',
        '--density-scale',
      ]),
    )
  })
})
