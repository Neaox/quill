import { describe, expect, it } from 'vitest'
import { atelier } from './builtin/atelier.ts'
import { instrument } from './builtin/instrument.ts'
import { press } from './builtin/press.ts'
import { buildPalettes } from './colour/palette.ts'
import type { ThemeDocument } from './schema/theme-document.ts'
import {
  DEFAULT_READING_SCALE,
  fontStack,
  proseTokens,
  radiusScale,
  readingSetting,
  toTokenMap,
} from './token-map.ts'
import { TOKEN_NAMES } from './tokens.ts'

const palettes = buildPalettes(instrument)

describe('radiusScale', () => {
  it('reproduces the scale in tokens.css at step 2', () => {
    expect(radiusScale(2)).toEqual({
      sm: '0.25rem',
      md: '0.375rem',
      lg: '0.5rem',
      xl: '0.75rem',
      xl2: '1rem',
    })
  })

  it('collapses to sharp corners at step 0 and doubles at step 4', () => {
    expect(radiusScale(0).md).toBe('0')
    expect(radiusScale(4).md).toBe('0.75rem')
  })

  it('falls back to the reference scale for a step outside the range', () => {
    expect(radiusScale(9)).toEqual(radiusScale(2))
  })
})

describe('fontStack', () => {
  it('quotes a family with a space and leaves a single word alone', () => {
    expect(fontStack({ source: 'curated', id: 'ibm-plex-serif' })).toContain("'IBM Plex Serif'")
    expect(fontStack({ source: 'curated', id: 'newsreader' })).toMatch(/^Newsreader, /u)
  })

  it('ends an uploaded face on the generic it declared', () => {
    expect(
      fontStack({
        source: 'uploaded',
        family: 'Northwind Mono',
        url: '/fonts/northwind-mono.woff2',
        generic: 'monospace',
        licence: { name: 'OFL-1.1' },
      }),
    ).toBe("'Northwind Mono', monospace")
  })

  it('keeps an uploaded family inside its string, whatever it is called', () => {
    // The stack is a custom property on every page the theme styles, the
    // public site included: a family name that closed the declaration would
    // be a rule of the administrator's choosing on every one of them.
    const stack = fontStack({
      source: 'uploaded',
      family: "Evil;}body{display:none}x{--y:'",
      url: '/fonts/evil.woff2',
      generic: 'serif',
      licence: { name: 'OFL-1.1' },
    })
    expect(stack).toBe("'Evil;}body{display:none}x{--y:\\27 ', serif")
  })

  it('leaves the generic families bare, because a quoted one is a family of that name', () => {
    const stack = fontStack({ source: 'curated', id: 'inter' })
    expect(stack).toContain(', -apple-system, ')
    expect(stack).toContain(', system-ui, ')
    expect(stack).toContain(", 'Segoe UI', ")
  })
})

describe('toTokenMap', () => {
  it('emits every token and nothing else', () => {
    const map = toTokenMap(instrument, palettes.light)
    expect(Object.keys(map).toSorted()).toEqual([...TOKEN_NAMES].toSorted())
  })

  it('writes colours as OKLCH, which is what tokens.css is written in', () => {
    const map = toTokenMap(instrument, palettes.light)
    expect(map['--palette-background']).toMatch(/^oklch\(/u)
    expect(map['--palette-overlay']).toContain('/')
  })

  it('states each syntax colour once and points the rest at it', () => {
    const map = toTokenMap(instrument, palettes.light)
    expect(map['--token-keyword']).toMatch(/^oklch\(/u)
    expect(map['--token-tag']).toBe('var(--token-keyword)')
    expect(map['--token-boolean']).toBe('var(--token-number)')
  })

  it('takes the type pairing, radius and density from the document', () => {
    const map = toTokenMap(press, buildPalettes(press).light)
    expect(map['--font-reading']).toContain('Newsreader')
    expect(map['--font-display']).toContain('Newsreader')
    expect(map['--radius-md']).toBe(radiusScale(1).md)
    expect(map['--layout-gutter']).toBe('1.5rem')
    expect(toTokenMap(instrument, palettes.light)['--layout-gutter']).toBe('1.125rem')
    expect(toTokenMap(atelier, buildPalettes(atelier).light)['--density-scale']).toBe('1')
  })

  it('lets a tenant replace an individual token, per scheme and for both', () => {
    const themed: ThemeDocument = {
      ...instrument,
      overrides: {
        shared: { '--radius-md': '2rem' },
        light: { '--palette-selection': 'rebeccapurple' },
        dark: { '--font-mono': 'Courier, monospace' },
      },
    }
    const light = toTokenMap(themed, buildPalettes(themed).light)
    const dark = toTokenMap(themed, buildPalettes(themed).dark)
    expect(light['--radius-md']).toBe('2rem')
    expect(dark['--radius-md']).toBe('2rem')
    expect(light['--palette-selection']).toBe('rebeccapurple')
    expect(dark['--palette-selection']).toMatch(/^oklch\(/u)
    expect(dark['--font-mono']).toBe('Courier, monospace')
  })

  it('keeps the generated value where an override would end the declaration it sits in', () => {
    // An override is written into a stylesheet every page wears, the public
    // site's included: a value that closed its declaration or its block would
    // be a rule of the administrator's choosing on all of them.
    const hostile = [
      'red; } body { display: none',
      'red }',
      'red {',
      'red /* the rest',
      "'unclosed",
      'back\\slash',
      'line\nbreak',
    ]
    for (const value of hostile) {
      const themed: ThemeDocument = {
        ...instrument,
        overrides: { shared: { '--palette-selection': value } },
      }
      expect(toTokenMap(themed, buildPalettes(themed).light)['--palette-selection']).toMatch(
        /^oklch\(/u,
      )
    }
    const quoted: ThemeDocument = {
      ...instrument,
      overrides: { shared: { '--font-mono': "'Courier New', monospace" } },
    }
    expect(toTokenMap(quoted, buildPalettes(quoted).light)['--font-mono']).toBe(
      "'Courier New', monospace",
    )
  })
})

describe('readingSetting', () => {
  it('reproduces the shared setting in tokens.css when a theme states none', () => {
    expect(readingSetting(undefined)).toEqual({
      size: '1.0625rem',
      leading: '1.7',
      measure: '38rem',
    })
    expect(DEFAULT_READING_SCALE).toEqual({ size: 17, leading: 1.7, measure: 38 })
  })

  it('serves a size stated in pixels as rem, without floating-point noise', () => {
    expect(readingSetting({ size: 18.5 }).size).toBe('1.15625rem')
    expect(readingSetting({ size: 15 }).size).toBe('0.9375rem')
  })

  it('takes each part on its own, keeping the shared value for the rest', () => {
    expect(readingSetting({ leading: 1.6 })).toEqual({
      size: '1.0625rem',
      leading: '1.6',
      measure: '38rem',
    })
  })

  it('reaches the token map as the reading size, its leading, and the content column', () => {
    const themed: ThemeDocument = {
      ...instrument,
      type: { ...instrument.type, scale: { size: 16, leading: 1.625, measure: 42 } },
    }
    const map = toTokenMap(themed, palettes.light)
    expect(map['--text-reading']).toBe('1rem')
    expect(map['--text-reading--line-height']).toBe('1.625')
    expect(map['--leading-reading']).toBe('1.625')
    expect(map['--layout-content']).toBe('42rem')
    expect(map['--layout-wide']).toBe('58rem')
  })

  it('leaves a theme without a reading setting exactly where it was', () => {
    const map = toTokenMap(instrument, palettes.light)
    expect(map['--text-reading']).toBe('1.0625rem')
    expect(map['--leading-reading']).toBe('1.7')
    expect(map['--layout-content']).toBe('38rem')
  })
})

describe('proseTokens', () => {
  it('keeps the shared rhythm between blocks when a theme states none', () => {
    const tokens = proseTokens(undefined, undefined)
    expect(tokens['--prose-flow-block']).toBe('1.15em')
    expect(tokens['--prose-flow-after-heading']).toBe('0.75em')
    expect(tokens['--prose-flow-after-title']).toBe('0.75em')
    expect(tokens['--prose-flow-object-before']).toBe('1.6em')
    expect(tokens['--prose-flow-object-after']).toBe('1.6em')
  })

  it('sets the rhythm between blocks in the body size, so it scales with the reading text', () => {
    const tokens = proseTokens(
      {
        size: 15,
        flow: { block: 14, afterHeading: 10, afterTitle: 16, objectBefore: 22, objectAfter: 28 },
      },
      undefined,
    )
    // In multiples of `--text-reading`, never of the element's own size: a
    // callout or a lede is set smaller or larger than the body, and the space
    // before it must still be the pixels the design states.
    expect(tokens['--prose-flow-block']).toBe('calc(0.93333 * var(--text-reading))')
    expect(tokens['--prose-flow-after-heading']).toBe('calc(0.66667 * var(--text-reading))')
    expect(tokens['--prose-flow-after-title']).toBe('calc(1.06667 * var(--text-reading))')
    expect(tokens['--prose-flow-object-before']).toBe('calc(1.46667 * var(--text-reading))')
    expect(tokens['--prose-flow-object-after']).toBe('calc(1.86667 * var(--text-reading))')
  })

  it('measures the space above a section in the heading it sits above', () => {
    const tokens = proseTokens(
      {
        size: 15,
        h2: { size: 21, lineHeight: 27, weight: 650 },
        h3: { size: 17, lineHeight: 23 },
        space: { h2: 48, h3: 28 },
      },
      undefined,
    )
    // 48px above a 21px heading, and 28px above a 17px one: the pixels a
    // design states are the pixels a reader gets.
    expect(tokens['--prose-h2-space']).toBe('2.28571em')
    expect(tokens['--prose-h3-space']).toBe('1.64706em')
  })

  it('reproduces the shared prose scale when a theme states none', () => {
    const tokens = proseTokens(undefined, undefined)
    expect(tokens['--prose-h1-size']).toBe('2.074em')
    expect(tokens['--prose-h2-space']).toBe('2.6em')
    expect(tokens['--prose-link-colour']).toBe('var(--palette-foreground)')
    expect(tokens['--prose-link-offset']).toBe('0.16em')
  })

  it('serves headings as an em of the body, so a presentation still scales them', () => {
    const tokens = proseTokens(
      {
        size: 15,
        h1: { size: 34, lineHeight: 40, weight: 700, tracking: -0.02 },
        space: { h2: 48 },
        lede: { size: 17, lineHeight: 27.2 },
      },
      undefined,
    )
    expect(tokens['--prose-h1-size']).toBe('2.26667em')
    expect(tokens['--prose-h1-leading']).toBe('1.17647')
    expect(tokens['--prose-h1-weight']).toBe('700')
    expect(tokens['--prose-h1-tracking']).toBe('-0.02em')
    // The space is set on the heading, so it is an em of the heading: 48px
    // over the shared h2 of 1.33 × 15px.
    expect(tokens['--prose-h2-space']).toBe('2.40602em')
    expect(tokens['--prose-lede-size']).toBe('1.13333em')
    expect(tokens['--prose-lede-leading']).toBe('1.6')
    // What the theme did not state stays shared.
    expect(tokens['--prose-h2-size']).toBe('1.33em')
  })

  it('keeps the furniture at the interface size, in rem', () => {
    const tokens = proseTokens(
      {
        eyebrow: { size: 13, weight: 600, tracking: 0.08 },
        table: { size: 13.5 },
        code: { size: 13 },
      },
      undefined,
    )
    expect(tokens['--prose-eyebrow-size']).toBe('0.8125rem')
    expect(tokens['--prose-table-size']).toBe('0.84375rem')
    expect(tokens['--prose-table-leading']).toBe('1.5')
    expect(tokens['--prose-code-size']).toBe('0.8125rem')
  })

  it('draws a link from the theme’s inks', () => {
    const tokens = proseTokens(undefined, {
      text: 'accent',
      underline: 'current',
      thickness: 1,
      hoverThickness: 2,
      offset: 3,
    })
    expect(tokens['--prose-link-colour']).toBe('var(--palette-accent-ink)')
    expect(tokens['--prose-link-decoration']).toBe('currentColor')
    expect(tokens['--prose-link-thickness']).toBe('1px')
    expect(tokens['--prose-link-thickness-hover']).toBe('2px')
    expect(tokens['--prose-link-offset']).toBe('3px')
  })
})

describe('proseTokens, with only part of a setting stated', () => {
  it('fills an eyebrow, a table and links from the shared values where a theme is silent', () => {
    const tokens = proseTokens(
      { size: 15, eyebrow: { size: 13 }, table: { size: 13.5 } },
      { text: 'accent', underline: 'accent' },
    )
    expect(tokens['--prose-eyebrow-weight']).toBe('600')
    expect(tokens['--prose-eyebrow-tracking']).toBe('0em')
    expect(tokens['--prose-table-leading']).toBe('1.5')
    expect(tokens['--prose-link-thickness']).toBe('from-font')
    expect(tokens['--prose-link-thickness-hover']).toBe('from-font')
    expect(tokens['--prose-link-offset']).toBe('0.16em')
  })

  it('thickens a link on hover by its own thickness when no hover thickness is given', () => {
    const tokens = proseTokens(undefined, {
      text: 'ink',
      underline: 'quiet',
      thickness: 1.5,
      offset: 3,
    })
    expect(tokens['--prose-link-thickness']).toBe('1.5px')
    expect(tokens['--prose-link-thickness-hover']).toBe('1.5px')
    expect(tokens['--prose-link-offset']).toBe('3px')
  })
})
