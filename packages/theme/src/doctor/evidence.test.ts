import { describe, expect, it } from 'vitest'
import { instrument } from '../builtin/instrument.ts'
import { buildPalettes, type Palette, type ThemePalettes } from '../colour/palette.ts'
import { CONTRAST_FLOORS } from '../contrast/floors.ts'
import {
  adjustmentEvidence,
  contrastEvidence,
  failingRoles,
  isPaletteRole,
  meetsTarget,
  shortfall,
  swatchEvidence,
} from './evidence.ts'
import { boundaryPairs, syntaxPairs, textPairs } from './pairs.ts'

const palettes = buildPalettes(instrument)

describe('contrastEvidence', () => {
  it('measures every pair in both schemes against its floor', () => {
    const evidence = contrastEvidence(palettes, textPairs)
    const body = evidence.find((entry) => entry.label === 'body on paper')

    expect(evidence).toHaveLength(textPairs(palettes.light).length)
    expect(body).toMatchObject({
      kind: 'contrast',
      foreground: 'body',
      background: 'paper',
      target: CONTRAST_FLOORS.body,
      light: { foreground: palettes.light.colours.body, holds: true },
      dark: { background: palettes.dark.colours.paper, holds: true },
    })
    expect(body?.light.ratio).toBeGreaterThan(4.5)
    expect(body?.dark.lc).toBeGreaterThan(75)
  })

  it('names roles from the label, so a focus ring is not taken for the accent it is drawn in', () => {
    const evidence = contrastEvidence(palettes, boundaryPairs)

    expect(evidence.map((entry) => [entry.foreground, entry.background])).toEqual([
      ['focusRing', 'paper'],
      ['focusRing', 'surface'],
      ['focusRing', 'raised'],
      ['borderStrong', 'paper'],
      ['borderStrong', 'surface'],
    ])
  })

  it('names a syntax colour as the adjustment log does', () => {
    const [first] = contrastEvidence(palettes, syntaxPairs)
    expect(first?.foreground).toMatch(/^token-/)
    expect(first?.background).toBe('codeBackground')
  })

  it('keeps the label wording for a colour the palette does not hold', () => {
    const stranger = { lightness: 50, chroma: 0, hue: 0 }
    const pairsOf = (palette: Palette) => [
      {
        label: 'stamp',
        foreground: stranger,
        background: palette.colours.paper,
        floor: CONTRAST_FLOORS.nonText,
      },
    ]
    const [entry] = contrastEvidence(palettes, pairsOf, () => ({ lcAtMost: 200 }))

    expect(entry).toMatchObject({ foreground: 'stamp', background: 'paper' })
    expect(entry?.light.holds).toBe(true)
  })
})

describe('meetsTarget', () => {
  it('holds a pair only to the bounds its target states', () => {
    expect(meetsTarget(4.6, 76, { ratio: 4.5, lc: 75 })).toBe(true)
    expect(meetsTarget(4.4, 76, { ratio: 4.5, lc: 75 })).toBe(false)
    expect(meetsTarget(4.6, 70, { ratio: 4.5, lc: 75 })).toBe(false)
    expect(meetsTarget(2, 40, { lc: 30, lcAtMost: 45 })).toBe(true)
    expect(meetsTarget(2, 50, { lc: 30, lcAtMost: 45 })).toBe(false)
    expect(meetsTarget(1, 0, {})).toBe(true)
  })
})

describe('swatchEvidence', () => {
  it('samples each role in both schemes with the rule’s own verdict', () => {
    const [ink] = swatchEvidence(palettes, ['ink'], (palette) => palette.scheme === 'light')

    expect(ink).toEqual({
      kind: 'swatch',
      role: 'ink',
      light: { colour: palettes.light.colours.ink, holds: true },
      dark: { colour: palettes.dark.colours.ink, holds: false },
    })
  })
})

describe('adjustmentEvidence', () => {
  it('pairs what the seeds asked for with what shipped, per scheme', () => {
    const evidence = adjustmentEvidence(palettes, ['gamut'])
    const accent = evidence.find((entry) => entry.role === 'accent')

    expect(accent?.light?.after).toBe(palettes.light.colours.accent)
    expect(accent?.light?.before.chroma).toBeGreaterThan(accent?.light?.after.chroma ?? 1)
    expect(accent?.light?.before.lightness).toBe(accent?.light?.after.lightness)
    expect(accent?.light?.changes.every((change) => change.reason === 'gamut')).toBe(true)
  })

  it('puts a property changed twice back to its first value', () => {
    const changed: ThemePalettes = {
      light: {
        ...palettes.light,
        adjustments: [
          { role: 'ink', property: 'lightness', reason: 'contrast', from: 30, to: 25 },
          { role: 'ink', property: 'lightness', reason: 'contrast', from: 25, to: 22 },
        ],
      },
      dark: { ...palettes.dark, adjustments: [] },
    }
    const [ink] = adjustmentEvidence(changed, ['contrast'])

    expect(ink?.light?.before.lightness).toBe(30)
    expect(ink).not.toHaveProperty('dark')
  })

  it('resolves syntax colours and skips a role it cannot find', () => {
    const changed: ThemePalettes = {
      light: { ...palettes.light, adjustments: [] },
      dark: {
        ...palettes.dark,
        adjustments: [
          { role: 'token-keyword', property: 'chroma', reason: 'gamut', from: 0.2, to: 0.1 },
          { role: 'token-unknown', property: 'chroma', reason: 'gamut', from: 0.2, to: 0.1 },
          { role: 'mystery', property: 'chroma', reason: 'gamut', from: 0.2, to: 0.1 },
        ],
      },
    }
    const evidence = adjustmentEvidence(changed, ['gamut'])

    expect(evidence.map((entry) => entry.role)).toEqual(['token-keyword'])
    expect(evidence[0]?.dark?.after).toBe(palettes.dark.syntax.keyword)
    expect(evidence[0]).not.toHaveProperty('light')
  })
})

describe('failingRoles', () => {
  it('names both sides of a failing pair and the role of a failing swatch, per scheme', () => {
    const contrast = contrastEvidence(
      palettes,
      (palette) => textPairs(palette).slice(0, 1),
      () => ({
        ratio: 30,
      }),
    )
    const swatches = swatchEvidence(palettes, ['raised'], (palette) => palette.scheme === 'light')

    expect(
      failingRoles([...contrast, ...swatches, ...adjustmentEvidence(palettes, ['gamut'])]),
    ).toEqual([
      { scheme: 'light', role: 'ink' },
      { scheme: 'light', role: 'paper' },
      { scheme: 'dark', role: 'ink' },
      { scheme: 'dark', role: 'paper' },
      { scheme: 'dark', role: 'raised' },
    ])
  })
})

describe('isPaletteRole', () => {
  it('knows the palette’s roles', () => {
    expect(isPaletteRole('accentSubtle')).toBe(true)
    expect(isPaletteRole('token-keyword')).toBe(false)
  })
})

describe('swatches in context', () => {
  it('draws a surface on the one it rises from, and a wash behind its text', () => {
    const [paper, surface, raised, wash] = swatchEvidence(
      palettes,
      ['paper', 'surface', 'raised', 'accentSubtle'],
      () => true,
    )
    const { light, dark } = palettes

    expect(paper?.light).not.toHaveProperty('ground')
    expect(paper?.light.ink).toBe(light.colours.ink)
    expect(surface?.dark).toMatchObject({ ground: dark.colours.paper, ink: dark.colours.ink })
    expect(raised?.light.ground).toBe(light.colours.paper)
    expect(raised?.dark.ground).toBe(dark.colours.surface)
    expect(wash?.dark).toMatchObject({ ground: dark.colours.paper, ink: dark.colours.accentInk })
  })
})

describe('shortfall', () => {
  it('is nothing when everything holds', () => {
    expect(shortfall(contrastEvidence(palettes, textPairs))).toBe(0)
    expect(shortfall(adjustmentEvidence(palettes, ['gamut']))).toBe(0)
  })

  it('grows with how far a pair falls short of each bound, relative to the bound', () => {
    const [ink] = contrastEvidence(
      palettes,
      (palette) => textPairs(palette).slice(0, 1),
      () => ({ ratio: 100, lc: 200, lcAtMost: 10 }),
    )
    if (ink === undefined) throw new Error('no pair')
    const expected = (['light', 'dark'] as const).reduce((total, scheme) => {
      const { ratio, lc } = ink[scheme]
      return total + (100 - ratio) / 100 + (200 - lc) / 200 + (lc - 10) / 10
    }, 0)
    expect(shortfall([ink])).toBeCloseTo(expected)
  })

  it('counts each colour out of its band or budget once per scheme', () => {
    const swatches = swatchEvidence(
      palettes,
      ['ink', 'paper'],
      (palette) => palette.scheme === 'dark',
    )
    expect(shortfall(swatches)).toBe(2)
  })
})
