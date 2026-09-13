import { describe, expect, it } from 'vitest'
import { atelier } from './builtin/atelier.ts'
import { instrument } from './builtin/instrument.ts'
import { press } from './builtin/press.ts'
import { buildPalettes } from './colour/palette.ts'
import type { ThemeDocument } from './schema/theme-document.ts'
import { fontStack, radiusScale, toTokenMap } from './token-map.ts'
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
})
