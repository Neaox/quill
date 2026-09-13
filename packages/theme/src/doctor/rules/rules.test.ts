import { describe, expect, it } from 'vitest'
import { instrument } from '../../builtin/instrument.ts'
import { press } from '../../builtin/press.ts'
import type { Adjustment } from '../../colour/adjustment.ts'
import type { Colour } from '../../colour/oklch.ts'
import {
  buildPalettes,
  type Palette,
  type PaletteRole,
  type ThemePalettes,
} from '../../colour/palette.ts'
import type { ThemeDocument } from '../../schema/theme-document.ts'
import { DEFAULT_DOCTOR_OPTIONS, type DoctorOptions, type Rule } from '../rule.ts'
import { lightnessBandRule, surfaceSeparationRule } from './bands.ts'
import { accentBudgetRule, areaBudgetRule, oneSaturatedThingRule } from './chroma.ts'
import { darkElevationRule, darkRecheckRule, darkRederivationRule } from './dark.ts'
import { neutralAgreementRule, statusHueRule, statusMatchRule } from './hue.ts'
import {
  darkInkAndPaperRule,
  decorativeTextRule,
  textContrastRule,
  textOnAccentRule,
  uiBoundaryRule,
} from './legibility.ts'
import { accentCoverageRule } from './proportion.ts'
import { chromaCompensationRule, gamutRule, rampHueRule } from './uniformity.ts'
import { accentSeparationRule, statusSeparationRule } from './vision.ts'

const base = buildPalettes(instrument)

type Patch = {
  readonly colours?: Partial<Record<PaletteRole, Colour>>
  readonly syntax?: Partial<Palette['syntax']>
  readonly adjustments?: readonly Adjustment[]
}

const patchOne = (palette: Palette, patch: Patch): Palette => ({
  ...palette,
  colours: { ...palette.colours, ...patch.colours },
  syntax: { ...palette.syntax, ...patch.syntax },
  adjustments: patch.adjustments ?? palette.adjustments,
})

const withLight = (patch: Patch): ThemePalettes => ({
  light: patchOne(base.light, patch),
  dark: base.dark,
})

const withDark = (patch: Patch): ThemePalettes => ({
  light: base.light,
  dark: patchOne(base.dark, patch),
})

const run = (rule: Rule, palettes: ThemePalettes, theme = instrument, options?: DoctorOptions) =>
  rule.evaluate(theme, palettes, options ?? DEFAULT_DOCTOR_OPTIONS)

const status = (rule: Rule, palettes: ThemePalettes, theme?: ThemeDocument) =>
  run(rule, palettes, theme).status

const grey = (lightness: number): Colour => ({ lightness, chroma: 0, hue: 0 })

/** A tone with no tint at all, which several rules treat as a separate case. */
const untinted: ThemeDocument = {
  ...instrument,
  seeds: { ...instrument.seeds, tone: { hue: 250, chroma: 0 } },
}

describe('section 1, legibility', () => {
  it('passes text contrast for a built-in and warns when the ink goes pale', () => {
    expect(status(textContrastRule, base)).toBe('pass')
    expect(status(textContrastRule, withLight({ colours: { ink: grey(95) } }))).toBe('warn')
  })

  it('warns when a syntax token disappears into the code background', () => {
    expect(
      status(
        textContrastRule,
        withLight({ syntax: { keyword: base.light.colours.codeBackground } }),
      ),
    ).toBe('warn')
  })

  it('passes the boundary floors and warns when the strong border fades', () => {
    expect(status(uiBoundaryRule, base)).toBe('pass')
    expect(status(uiBoundaryRule, withLight({ colours: { borderStrong: grey(97) } }))).toBe('warn')
  })

  it('keeps placeholder text in the decorative band', () => {
    expect(status(decorativeTextRule, base)).toBe('pass')
    expect(
      status(decorativeTextRule, withLight({ colours: { placeholder: base.light.colours.ink } })),
    ).toBe('warn')
  })

  it('checks the text on the accent, and that it is the better of the two candidates', () => {
    expect(status(textOnAccentRule, base)).toBe('pass')
    expect(status(textOnAccentRule, withLight({ colours: { accentForeground: grey(60) } }))).toBe(
      'warn',
    )
  })

  it('refuses pure white ink and pure black paper in dark mode', () => {
    expect(status(darkInkAndPaperRule, base)).toBe('pass')
    expect(status(darkInkAndPaperRule, withDark({ colours: { ink: grey(100) } }))).toBe('warn')
    expect(status(darkInkAndPaperRule, withDark({ colours: { paper: grey(0) } }))).toBe('warn')
  })
})

describe('section 2, perceptual uniformity', () => {
  it('passes when the ramp holds one hue and warns when a step drifts', () => {
    expect(status(rampHueRule, base)).toBe('pass')
    expect(
      status(
        rampHueRule,
        withLight({ colours: { border: { lightness: 90, chroma: 0.01, hue: 10 } } }),
      ),
    ).toBe('warn')
  })

  it('ignores hue on a ramp with no tint at all', () => {
    expect(status(rampHueRule, buildPalettes(untinted), untinted)).toBe('pass')
  })

  it('reports gamut mapping as an adjustment, a clean pass, or a colour still outside sRGB', () => {
    expect(status(gamutRule, base)).toBe('adjusted')
    expect(
      status(gamutRule, {
        light: patchOne(base.light, { adjustments: [] }),
        dark: patchOne(base.dark, { adjustments: [] }),
      }),
    ).toBe('pass')
    expect(
      status(
        gamutRule,
        withLight({ colours: { accent: { lightness: 60, chroma: 0.34, hue: 250 } } }),
      ),
    ).toBe('warn')
  })

  it('reports the hue-dependent chroma correction, and refuses one beyond fifteen percent', () => {
    expect(status(chromaCompensationRule, base)).toBe('adjusted')
    const none = {
      light: patchOne(base.light, { adjustments: [] }),
      dark: patchOne(base.dark, { adjustments: [] }),
    }
    expect(status(chromaCompensationRule, none)).toBe('pass')
    const excessive: Adjustment = {
      role: 'success',
      property: 'chroma',
      reason: 'compensation',
      from: 0.14,
      to: 0.1,
    }
    expect(status(chromaCompensationRule, withLight({ adjustments: [excessive] }))).toBe('warn')
  })
})

describe('section 3, lightness bands', () => {
  it('holds every role in its band', () => {
    expect(status(lightnessBandRule, base)).toBe('pass')
    expect(status(lightnessBandRule, withLight({ colours: { ink: grey(60) } }))).toBe('warn')
  })

  it('keeps surfaces a visible step from the paper, in both schemes', () => {
    expect(status(surfaceSeparationRule, base)).toBe('pass')
    expect(
      status(surfaceSeparationRule, withLight({ colours: { surface: base.light.colours.paper } })),
    ).toBe('warn')
    expect(
      status(surfaceSeparationRule, withDark({ colours: { raised: base.dark.colours.surface } })),
    ).toBe('warn')
  })
})

describe('section 4, chroma budget', () => {
  it('holds large areas inside their budget', () => {
    expect(status(areaBudgetRule, base)).toBe('pass')
    expect(
      status(
        areaBudgetRule,
        withLight({ colours: { surface: { lightness: 96, chroma: 0.1, hue: 250 } } }),
      ),
    ).toBe('warn')
  })

  it('warns when a chosen tone leaves no tint on the paper', () => {
    expect(status(areaBudgetRule, withLight({ colours: { paper: grey(98.5) } }))).toBe('warn')
  })

  it('asks for no tint when no tone was chosen', () => {
    expect(status(areaBudgetRule, buildPalettes(untinted), untinted)).toBe('pass')
  })

  it('holds the accent inside the small-area budget and reduced in dark mode', () => {
    expect(status(accentBudgetRule, base)).toBe('pass')
    expect(
      status(
        accentBudgetRule,
        withDark({ colours: { accent: { lightness: 70, chroma: 0.3, hue: 45 } } }),
      ),
    ).toBe('warn')
  })

  it('allows one saturated element class at a time', () => {
    expect(status(oneSaturatedThingRule, base)).toBe('pass')
    expect(
      status(
        oneSaturatedThingRule,
        withLight({ colours: { border: { lightness: 90, chroma: 0.2, hue: 250 } } }),
      ),
    ).toBe('warn')
  })
})

describe('section 5, hue relationships', () => {
  it('accepts a complementary tone and an analogous one', () => {
    expect(run(neutralAgreementRule, base).detail).toContain('complementary')
    expect(run(neutralAgreementRule, buildPalettes(press), press).detail).toContain('analogous')
  })

  it('waves through any accent when the tone is effectively grey', () => {
    expect(status(neutralAgreementRule, buildPalettes(untinted), untinted)).toBe('pass')
  })

  it('warns when the tone sits in the mismatch range', () => {
    const clashing: ThemeDocument = {
      ...instrument,
      seeds: {
        tone: { hue: 150, chroma: 0.012 },
        accent: { hue: 45, chroma: 0.15, lightness: 50 },
      },
    }
    expect(status(neutralAgreementRule, buildPalettes(clashing), clashing)).toBe('warn')
  })

  it('reports the status hue shift the accent forced', () => {
    expect(run(statusHueRule, base).detail).toContain('shifted')
    expect(status(statusHueRule, base)).toBe('adjusted')
  })

  it('passes when every status hue is already clear of the accent', () => {
    const cool: ThemeDocument = {
      ...instrument,
      seeds: { ...instrument.seeds, accent: { hue: 250, chroma: 0.15, lightness: 50 } },
    }
    expect(status(statusHueRule, buildPalettes(cool), cool)).toBe('pass')
  })

  it('warns when a status hue has left its band', () => {
    expect(
      status(
        statusHueRule,
        withLight({ colours: { danger: { lightness: 48, chroma: 0.1, hue: 300 } } }),
      ),
    ).toBe('warn')
  })

  it('requires the status set to differ in hue alone', () => {
    expect(status(statusMatchRule, base)).toBe('pass')
    expect(
      status(
        statusMatchRule,
        withLight({ colours: { warning: { lightness: 70, chroma: 0.1, hue: 85 } } }),
      ),
    ).toBe('warn')
  })
})

describe('section 6, proportion', () => {
  it('says nothing useful until the preview has measured coverage', () => {
    expect(run(accentCoverageRule, base).detail).toContain('live preview')
  })

  it('passes a modest coverage and warns above twelve percent', () => {
    expect(
      run(accentCoverageRule, base, instrument, { textContrast: 'enforced', accentCoverage: 0.08 })
        .status,
    ).toBe('pass')
    expect(
      run(accentCoverageRule, base, instrument, { textContrast: 'enforced', accentCoverage: 0.2 })
        .status,
    ).toBe('warn')
  })
})

describe('section 7, dark mode', () => {
  it('passes when dark keeps the hues and drops the chroma by a quarter', () => {
    expect(status(darkRederivationRule, base)).toBe('pass')
  })

  it('warns when a dark colour changes hue or gains chroma', () => {
    expect(
      status(
        darkRederivationRule,
        withDark({ colours: { ink: { ...base.dark.colours.ink, hue: 10 } } }),
      ),
    ).toBe('warn')
    expect(
      status(
        darkRederivationRule,
        withDark({ colours: { border: { ...base.dark.colours.border, chroma: 0.3 } } }),
      ),
    ).toBe('warn')
  })

  it('reports a dark accent that was not reduced enough, and copes with a grey accent', () => {
    expect(
      status(
        darkRederivationRule,
        withDark({
          colours: {
            accent: { ...base.dark.colours.accent, chroma: base.light.colours.accent.chroma },
          },
        }),
      ),
    ).toBe('adjusted')
    const greyAccent = {
      light: patchOne(base.light, { colours: { accent: grey(50) } }),
      dark: patchOne(base.dark, { colours: { accent: grey(70) } }),
    }
    expect(status(darkRederivationRule, greyAccent)).toBe('adjusted')
  })

  it('requires dark elevation to rise in lightness', () => {
    expect(status(darkElevationRule, base)).toBe('pass')
    expect(status(darkElevationRule, withDark({ colours: { surface: grey(10) } }))).toBe('warn')
  })

  it('re-checks every pair in dark mode', () => {
    expect(status(darkRecheckRule, base)).toBe('pass')
    expect(status(darkRecheckRule, withDark({ colours: { ink: base.dark.colours.paper } }))).toBe(
      'warn',
    )
  })
})

describe('section 8, colour vision deficiency', () => {
  it('advises a shape or a label when a red and a green converge, which the bands make unavoidable', () => {
    expect(status(statusSeparationRule, base)).toBe('adjusted')
    expect(run(statusSeparationRule, base).detail).toContain('shape or a label')
  })

  it('passes when the set stays far apart', () => {
    const separated = withLight({
      colours: {
        success: grey(20),
        warning: grey(60),
        danger: grey(95),
      },
    })
    expect(status(statusSeparationRule, { light: separated.light, dark: separated.light })).toBe(
      'pass',
    )
  })

  it('measures the accent against muted text and passes when it is clear', () => {
    expect(status(accentSeparationRule, base)).toBe('pass')
  })

  it('warns when a tenant override costs separation the seeds would have given', () => {
    const themed: ThemeDocument = {
      ...instrument,
      overrides: { light: { '--palette-accent': 'oklch(50% 0.016 250)' } },
    }
    expect(status(accentSeparationRule, buildPalettes(themed), themed)).toBe('warn')
  })

  it('advises rather than warns when the seeds themselves leave the accent close', () => {
    expect(status(accentSeparationRule, buildPalettes(press), press)).toBe('adjusted')
  })
})
