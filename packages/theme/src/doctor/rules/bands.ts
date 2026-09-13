import {
  LIGHTNESS_BANDS,
  RAISED_SEPARATION,
  SURFACE_SEPARATION,
  inBand,
  type NeutralRole,
} from '../../colour/bands.ts'
import type { Palette } from '../../colour/palette.ts'
import { check, fromChecks, round, type Rule } from '../rule.ts'

const BANDED_ROLES: readonly (NeutralRole | 'accent')[] = [
  'paper',
  'surface',
  'raised',
  'border',
  'muted',
  'ink',
  'accent',
]

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
            inBand(lightness, band),
          )
        }),
      ),
      'every role sits in the band its job calls for',
    ),
}

/** Section 3 and 7: a surface must read as a surface, and raised must read as raised. */
export const surfaceSeparationRule: Rule = {
  id: 'bands/surface-separation',
  section: 3,
  title: 'Surfaces step far enough from the paper to be seen',
  evaluate: (_theme, palettes) =>
    fromChecks(
      [palettes.light, palettes.dark].flatMap((palette) => {
        const { paper, surface, raised } = palette.colours
        const surfaceStep =
          palette.scheme === 'light'
            ? paper.lightness - surface.lightness
            : surface.lightness - paper.lightness
        const raisedStep =
          palette.scheme === 'light'
            ? raised.lightness - paper.lightness
            : raised.lightness - surface.lightness
        return [
          check(
            `${palette.scheme} surface is only ${round(surfaceStep, 1)} from paper, under ${
              SURFACE_SEPARATION[palette.scheme]
            }`,
            surfaceStep >= SURFACE_SEPARATION[palette.scheme],
          ),
          check(
            `${palette.scheme} raised surface is only ${round(raisedStep, 1)} from the surface below it, under ${
              RAISED_SEPARATION[palette.scheme]
            }`,
            raisedStep >= RAISED_SEPARATION[palette.scheme],
          ),
        ]
      }),
      'paper, surface and raised are separable by lightness alone',
    ),
}
