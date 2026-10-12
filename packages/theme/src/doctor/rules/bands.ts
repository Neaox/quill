import {
  LIGHTNESS_BANDS,
  RAISED_SEPARATION,
  SURFACE_SEPARATION,
  inBand,
  type NeutralRole,
} from '../../colour/bands.ts'
import type { Palette } from '../../colour/palette.ts'
import { swatchEvidence } from '../evidence.ts'
import { check, fromChecks, round, type Rule } from '../rule.ts'

type BandedRole = NeutralRole | 'accent'

const BANDED_ROLES: readonly BandedRole[] = [
  'paper',
  'surface',
  'raised',
  'border',
  'muted',
  'body',
  'ink',
  'accent',
]

const holdsBand = (palette: Palette, role: BandedRole): boolean =>
  inBand(palette.colours[role].lightness, LIGHTNESS_BANDS[role][palette.scheme])

/** Section 3: the bands are what make every generated theme share a register. */
export const lightnessBandRule: Rule = {
  id: 'bands/role-lightness',
  section: 3,
  title: 'Every role sits in its lightness band',
  evaluate: (_theme, palettes) =>
    fromChecks(
      [palettes.light, palettes.dark].flatMap((palette: Palette) =>
        BANDED_ROLES.map((role) => {
          const band = LIGHTNESS_BANDS[role][palette.scheme]
          const lightness = palette.colours[role].lightness
          return check(
            `${palette.scheme} ${role} is L ${round(lightness, 1)}, outside L ${band.low} to ${band.high}`,
            holdsBand(palette, role),
          )
        }),
      ),
      'every role sits in the band its job calls for',
    ),
  evidence: (_theme, palettes) => swatchEvidence(palettes, BANDED_ROLES, holdsBand),
}

/**
 * How far each elevation steps from the one below it, in the direction that
 * reads as raised in its scheme. The paper is the ground and has no step.
 */
const elevationStep = (palette: Palette, role: 'surface' | 'raised'): number => {
  const { paper, surface, raised } = palette.colours
  const light = palette.scheme === 'light'
  if (role === 'surface') {
    return light ? paper.lightness - surface.lightness : surface.lightness - paper.lightness
  }
  return light ? raised.lightness - paper.lightness : raised.lightness - surface.lightness
}

const SEPARATION_FLOOR = { surface: SURFACE_SEPARATION, raised: RAISED_SEPARATION } as const

const holdsSeparation = (palette: Palette, role: 'paper' | 'surface' | 'raised'): boolean =>
  role === 'paper' || elevationStep(palette, role) >= SEPARATION_FLOOR[role][palette.scheme]

/** Section 3 and 7: a surface must read as a surface, and raised must read as raised. */
export const surfaceSeparationRule: Rule = {
  id: 'bands/surface-separation',
  section: 3,
  title: 'Surfaces step far enough from the paper to be seen',
  evaluate: (_theme, palettes) =>
    fromChecks(
      [palettes.light, palettes.dark].flatMap((palette) => [
        check(
          `${palette.scheme} surface is only ${round(elevationStep(palette, 'surface'), 1)} from paper, under ${
            SURFACE_SEPARATION[palette.scheme]
          }`,
          holdsSeparation(palette, 'surface'),
        ),
        check(
          `${palette.scheme} raised surface is only ${round(elevationStep(palette, 'raised'), 1)} from the surface below it, under ${
            RAISED_SEPARATION[palette.scheme]
          }`,
          holdsSeparation(palette, 'raised'),
        ),
      ]),
      'paper, surface and raised are separable by lightness alone',
    ),
  evidence: (_theme, palettes) =>
    swatchEvidence(palettes, ['paper', 'surface', 'raised'], holdsSeparation),
}
