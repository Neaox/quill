import { describe, expect, it } from 'vitest'
import { instrument } from '../builtin/instrument.ts'
import { press } from '../builtin/press.ts'
import { CONTRAST_FLOORS } from '../contrast/floors.ts'
import { contrastRatio } from '../contrast/wcag.ts'
import type { ThemeDocument } from '../schema/theme-document.ts'
import { accentChromaFor, buildAccentVariants, hoverOf } from './accent.ts'
import { CHROMA_BUDGET, LIGHTNESS_BANDS, inBand } from './bands.ts'
import { buildNeutralRamp } from './neutral-ramp.ts'
import { buildPalettes, PALETTE_ROLES, PALETTE_TOKEN_ROLES } from './palette.ts'
import { separateFromAccent, buildStatusSet } from './status.ts'
import { buildSyntaxColours } from './syntax.ts'
import { buildTint } from './tint.ts'

const tone = { hue: 250, chroma: 0.008 }

describe('buildNeutralRamp', () => {
  it('holds one hue at every step', () => {
    const ramp = buildNeutralRamp(tone, 'light')
    for (const colour of Object.values(ramp.colours)) {
      expect(colour.hue).toBe(tone.hue)
    }
  })

  it('keeps the paper inside its band and inside the chroma budget', () => {
    const light = buildNeutralRamp(tone, 'light').colours
    const dark = buildNeutralRamp(tone, 'dark').colours
    expect(inBand(light.paper.lightness, LIGHTNESS_BANDS.paper.light)).toBe(true)
    expect(inBand(dark.paper.lightness, LIGHTNESS_BANDS.paper.dark)).toBe(true)
    expect(light.paper.chroma).toBeLessThanOrEqual(CHROMA_BUDGET.paper)
  })

  it('reduces chroma in dark mode rather than inverting the ramp', () => {
    const light = buildNeutralRamp(tone, 'light').colours
    const dark = buildNeutralRamp(tone, 'dark').colours
    expect(dark.ink.chroma).toBeLessThan(light.ink.chroma)
    expect(dark.ink.lightness).toBeGreaterThan(dark.paper.lightness)
  })

  it('settles the placeholder into the decorative band and reports the move', () => {
    const ramp = buildNeutralRamp(tone, 'light')
    expect(ramp.adjustments.some((entry) => entry.role === 'placeholder')).toBe(true)
  })
})

describe('accent variants', () => {
  const neutral = buildNeutralRamp(tone, 'light').colours

  it('clamps a seed chroma into the small-area budget', () => {
    expect(accentChromaFor(0.4, 'light')).toBe(CHROMA_BUDGET.accentMaximum)
    expect(accentChromaFor(0.01, 'light')).toBe(CHROMA_BUDGET.accentMinimum)
    expect(accentChromaFor(0.12, 'light')).toBe(0.12)
    expect(accentChromaFor(0.12, 'dark')).toBeLessThan(0.12)
  })

  it('darkens on hover in light mode and lightens in dark mode', () => {
    const colour = { lightness: 50, chroma: 0.12, hue: 25 }
    expect(hoverOf(colour, 'light').lightness).toBeLessThan(50)
    expect(hoverOf(colour, 'dark').lightness).toBeGreaterThan(50)
    expect(hoverOf(colour, 'dark').chroma).toBeLessThan(0.12)
  })

  it('keeps the tenant colour as the mark and derives a safe one for text', () => {
    const variants = buildAccentVariants({ hue: 45, chroma: 0.2, lightness: 62 }, 'light', neutral)
    expect(variants.colours.accentMark.lightness).toBe(62)
    expect(variants.colours.accent.lightness).toBeLessThan(62)
    expect(contrastRatio(variants.colours.accent, neutral.paper)).toBeGreaterThanOrEqual(
      CONTRAST_FLOORS.secondary.ratio,
    )
  })

  it('falls back to the band midpoint when the seed gives no lightness', () => {
    const variants = buildAccentVariants({ hue: 200, chroma: 0.12 }, 'light', neutral)
    expect(inBand(variants.colours.accent.lightness, LIGHTNESS_BANDS.accent.light)).toBe(true)
  })

  it('uses the accent itself as the focus ring', () => {
    const variants = buildAccentVariants({ hue: 25, chroma: 0.12, lightness: 42 }, 'light', neutral)
    expect(variants.colours.focusRing).toEqual(variants.colours.accent)
  })
})

describe('buildTint', () => {
  const neutral = buildNeutralRamp(tone, 'light').colours

  it('never carries more chroma than a panel may', () => {
    const tint = buildTint(
      'accentSubtle',
      { lightness: 48, chroma: 0.18, hue: 45 },
      'light',
      neutral,
    )
    expect(tint.colour.chroma).toBeLessThanOrEqual(CHROMA_BUDGET.panel)
  })

  it('keeps the ink readable on it', () => {
    const tint = buildTint(
      'accentSubtle',
      { lightness: 48, chroma: 0.18, hue: 45 },
      'light',
      neutral,
    )
    expect(contrastRatio(neutral.ink, tint.colour)).toBeGreaterThanOrEqual(
      CONTRAST_FLOORS.body.ratio,
    )
  })
})

describe('separateFromAccent', () => {
  it('leaves a status hue that is already clear of the accent', () => {
    expect(separateFromAccent('danger', 27.5, 200)).toEqual({ hue: 27.5, shifted: false })
  })

  it('moves a status hue away, as far as its band allows', () => {
    expect(separateFromAccent('danger', 27.5, 25)).toEqual({ hue: 30, shifted: true })
  })

  it('reports no shift when the hue is already at the far end of its band', () => {
    expect(separateFromAccent('danger', 30, 25)).toEqual({ hue: 30, shifted: false })
  })
})

describe('buildStatusSet', () => {
  const neutral = buildNeutralRamp(tone, 'light').colours
  const accent = { lightness: 48, chroma: 0.15, hue: 45 }

  it('matches lightness and chroma across the set', () => {
    const status = buildStatusSet(accent, 45, 'light', neutral).colours
    const lightnesses = [status.success, status.warning, status.danger].map((c) => c.lightness)
    const chromas = [status.success, status.warning, status.danger].map((c) => c.chroma)
    expect(Math.max(...lightnesses) - Math.min(...lightnesses)).toBeLessThanOrEqual(5)
    expect(Math.max(...chromas) - Math.min(...chromas)).toBeLessThanOrEqual(0.02)
  })

  it('takes the accent as info', () => {
    expect(buildStatusSet(accent, 45, 'light', neutral).colours.info).toBe(accent)
  })

  it('honours a tenant status override, band and all', () => {
    const status = buildStatusSet(accent, 200, 'light', neutral, {
      success: { hue: 300, chroma: 0.05 },
    }).colours
    expect(status.success.hue).toBe(155)
    expect(status.success.chroma).toBeLessThan(0.08)
  })

  it('copes with a status the tenant asked to be grey', () => {
    const status = buildStatusSet(accent, 200, 'light', neutral, {
      danger: { hue: 27, chroma: 0 },
    }).colours
    expect(status.danger.chroma).toBe(0)
  })
})

describe('buildSyntaxColours', () => {
  const codeBackground = { lightness: 96, chroma: 0.012, hue: 250 }

  it('takes the theme tone for the quiet families and fixed hues for the rest', () => {
    const colours = buildSyntaxColours(
      { tone: 250, success: 150, danger: 27 },
      'light',
      codeBackground,
    ).colours
    expect(colours.punctuation.hue).toBe(250)
    expect(colours.comment.hue).toBe(250)
    expect(colours.keyword.hue).toBe(300)
    expect(colours.inserted.hue).toBe(150)
    expect(colours.deleted.hue).toBe(27)
  })

  it('keeps every family readable on the code background', () => {
    const colours = buildSyntaxColours(
      { tone: 250, success: 150, danger: 27 },
      'light',
      codeBackground,
    ).colours
    for (const colour of Object.values(colours)) {
      expect(contrastRatio(colour, codeBackground)).toBeGreaterThanOrEqual(
        CONTRAST_FLOORS.secondary.ratio,
      )
    }
  })
})

describe('buildPalettes', () => {
  it('names a colour for every role and every syntax family', () => {
    const { light, dark } = buildPalettes(instrument)
    for (const role of PALETTE_ROLES) {
      expect(light.colours[role]).toBeDefined()
      expect(dark.colours[role]).toBeDefined()
    }
    expect(Object.keys(light.syntax)).toHaveLength(10)
  })

  it('maps every palette token to a role', () => {
    const { light } = buildPalettes(press)
    for (const role of Object.values(PALETTE_TOKEN_ROLES)) {
      expect(light.colours[role]).toBeDefined()
    }
  })

  it('gives the dark scheme the lower chroma at every role', () => {
    const { light, dark } = buildPalettes(press)
    for (const role of PALETTE_ROLES) {
      expect(dark.colours[role].chroma).toBeLessThanOrEqual(light.colours[role].chroma + 1e-9)
    }
  })

  it('drops the shadow to plain black in dark mode, where a tinted shadow means nothing', () => {
    const { dark } = buildPalettes(press)
    expect(dark.colours.shadowAmbient.chroma).toBe(0)
    expect(dark.colours.overlay.alpha).toBeGreaterThan(0.5)
  })

  it('folds a tenant token override into the palette the doctor grades', () => {
    const themed: ThemeDocument = {
      ...press,
      overrides: {
        shared: { '--palette-border': 'oklch(50% 0.2 300)' },
        light: { '--token-keyword': 'oklch(30% 0.1 10)' },
        dark: { '--palette-muted': 'oklch(80% 0.01 250)' },
      },
    }
    const { light, dark } = buildPalettes(themed)
    expect(light.colours.border.hue).toBeCloseTo(300, 0)
    expect(light.syntax.keyword.hue).toBeCloseTo(10, 0)
    expect(dark.colours.muted.lightness).toBeCloseTo(80, 0)
  })

  it('ignores an override that is not a colour, and one that names nothing', () => {
    const themed: ThemeDocument = {
      ...press,
      overrides: {
        shared: { '--palette-border': 'not-a-colour', '--radius-sm': '0.5rem' },
      },
    }
    const { light } = buildPalettes(themed)
    expect(light.colours.border).toEqual(buildPalettes(press).light.colours.border)
  })
})
