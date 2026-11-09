import { describe, expect, it } from 'vitest'

import { BUILTIN_THEMES } from '../builtin/index.ts'
import { grid } from '../builtin/grid.ts'
import { apcaLc } from '../contrast/apca.ts'
import { CONTRAST_FLOORS } from '../contrast/floors.ts'
import { contrastRatio } from '../contrast/wcag.ts'
import type { ThemeDocument } from '../schema/theme-document.ts'
import { buildPalettes } from './palette.ts'

const STATUSES = ['success', 'warning', 'danger'] as const

/** A status's words on its own fill, as a badge sets them. */
const pairOf = (
  theme: ThemeDocument,
  scheme: 'light' | 'dark',
  status: (typeof STATUSES)[number],
) => {
  const { colours } = buildPalettes(theme)[scheme]
  return { ink: colours[`${status}Ink`], fill: colours[`${status}Subtle`], status: colours[status] }
}

describe('a status’s ink (ADR-028, amended)', () => {
  it('reads on its own fill as body text does, in every built-in theme and both schemes', () => {
    for (const theme of Object.values(BUILTIN_THEMES)) {
      for (const scheme of ['light', 'dark'] as const) {
        for (const status of STATUSES) {
          const { ink, fill } = pairOf(theme, scheme, status)
          expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(CONTRAST_FLOORS.body.ratio)
          expect(Math.abs(apcaLc(ink, fill))).toBeGreaterThanOrEqual(CONTRAST_FLOORS.body.lc)
        }
      }
    }
  })

  it('is its status’s hue and chroma, moved only in lightness, away from the fill', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const { ink, status, fill } = pairOf(grid, scheme, 'success')
      expect(ink.hue).toBe(status.hue)
      expect(ink.chroma).toBe(status.chroma)
      expect(Math.abs(ink.lightness - fill.lightness)).toBeGreaterThan(
        Math.abs(status.lightness - fill.lightness),
      )
    }
  })

  it('settles against the fill a theme pins, so Grid’s dark wash takes lockstay’s contrast', () => {
    const { ink, fill } = pairOf(grid, 'dark', 'success')
    expect(fill).toMatchObject({ lightness: 30, chroma: 0.05, hue: 160 })
    // lockstay's ok-ink on ok-bg is 9.6:1; the generated status on its fill was 5.5:1.
    expect(contrastRatio(ink, fill)).toBeGreaterThan(9)
  })

  it('settles against a status colour a theme pins', () => {
    const pinned: ThemeDocument = {
      ...grid,
      overrides: {
        ...grid.overrides,
        light: { ...grid.overrides?.light, '--palette-danger': 'oklch(60% 0.15 27.5)' },
      },
    }
    const { ink, fill } = pairOf(pinned, 'light', 'danger')
    expect(ink.lightness).toBeLessThan(60)
    expect(Math.abs(apcaLc(ink, fill))).toBeGreaterThanOrEqual(CONTRAST_FLOORS.body.lc)
  })

  it('is left as a theme pins it', () => {
    const pinned: ThemeDocument = {
      ...grid,
      overrides: {
        ...grid.overrides,
        dark: { ...grid.overrides?.dark, '--palette-success-ink': 'oklch(70% 0.1 150)' },
      },
    }
    expect(buildPalettes(pinned).dark.colours.successInk).toMatchObject({
      lightness: 70,
      chroma: 0.1,
      hue: 150,
    })
  })
})
