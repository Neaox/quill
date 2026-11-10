import { describe, expect, it } from 'vitest'

import { instrument } from './builtin/instrument.ts'
import { buildPalettes } from './colour/palette.ts'
import { apcaLc } from './contrast/apca.ts'
import { CONTRAST_FLOORS } from './contrast/floors.ts'
import { contrastRatio } from './contrast/wcag.ts'
import { toCss } from './css.ts'
import { reportOn } from './doctor/run.ts'
import { generateTheme } from './generate.ts'
import { labelRules } from './label-css.ts'
import { isLabelName, labelNameProblem, MAX_LABELS } from './schema/labels.ts'
import type { ThemeDocument } from './schema/theme-document.ts'
import { validateThemeDocument } from './schema/validate.ts'

const withLabels = (labels: unknown): unknown => ({ ...instrument, labels })

/** The doctor's verdict on a theme's labels. */
const verdict = (theme: ThemeDocument) =>
  reportOn(theme, buildPalettes(theme)).results.find((result) => result.id === 'legibility/labels')

const channels: ThemeDocument = {
  ...instrument,
  labels: [
    { name: 'alcove', title: 'Alcove', hue: 15 },
    { name: 'almanac', title: 'Almanac.org', hue: 255, chroma: 0.16 },
    // A pale seed the generator has to darken in light and lighten in dark.
    { name: 'nook', title: 'Nook', hue: 95, chroma: 0.3 },
  ],
}

describe('a label in the theme document (ADR-037)', () => {
  it('is optional, so every theme saved before labels existed is unchanged', () => {
    expect(validateThemeDocument(instrument).valid).toBe(true)
    expect(validateThemeDocument(channels).valid).toBe(true)
  })

  it('has a name that is a directive name and a class name', () => {
    expect(isLabelName('alcove')).toBe(true)
    expect(isLabelName('almanac-com2')).toBe(true)
    const malformed = ['Alcove', '2nd', 'a_b', 'a b', "a'b", 'x'.repeat(33), '']
    expect(malformed.filter(isLabelName)).toEqual([])
    expect(
      malformed.filter(
        (name) => validateThemeDocument(withLabels([{ name, title: 'T', hue: 1 }])).valid,
      ),
    ).toEqual([])
  })

  it('may name the emoji its pill leads with, in an emoji name’s shape (ADR-038)', () => {
    const leading = (emoji: string) =>
      validateThemeDocument(
        withLabels([{ name: 'almanac', title: 'Almanac.org', hue: 255, emoji }]),
      ).valid
    expect(leading('almanac_hub')).toBe(true)
    expect(['Almanac', '_x', 'a b', 'x'.repeat(33)].filter(leading)).toEqual([])
  })

  it('refuses a name a built-in directive or drawing class already has', () => {
    const issues = ['badge', 'ok', 'warning', 'small', 'send', 'box', 'label-zone'].map((name) => {
      const result = validateThemeDocument(withLabels([{ name, title: 'T', hue: 1 }]))
      return result.valid ? [] : result.issues.map(({ path, rule }) => ({ path, rule }))
    })
    expect(issues).toEqual(
      Array.from({ length: 7 }, () => [{ path: '/labels/0/name', rule: 'label-reserved' }]),
    )
  })

  it('refuses two labels of one name', () => {
    const result = validateThemeDocument(
      withLabels([
        { name: 'alcove', title: 'Alcove', hue: 1 },
        { name: 'alcove', title: 'Again', hue: 2 },
      ]),
    )
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.issues).toEqual([
      expect.objectContaining({ path: '/labels/1/name', rule: 'label-unique' }),
    ])
  })

  it('refuses more labels than anybody could tell apart, and a label without a title', () => {
    const many = Array.from({ length: MAX_LABELS + 1 }, (_, index) => ({
      name: `l${index}`,
      title: `L${index}`,
      hue: index,
    }))
    expect(validateThemeDocument(withLabels(many)).valid).toBe(false)
    expect(validateThemeDocument(withLabels(many.slice(1))).valid).toBe(true)
    expect(validateThemeDocument(withLabels([{ name: 'a', title: '', hue: 1 }])).valid).toBe(false)
  })

  it('says what is wrong with a name in words a form can show', () => {
    expect(labelNameProblem('alcove')).toBeUndefined()
    expect(labelNameProblem('Alcove')).toMatch(/lower-case letter/u)
    expect(labelNameProblem('badge')).toMatch(/built-in/u)
    expect(labelNameProblem('alcove', ['alcove'])).toMatch(/already a label/u)
  })
})

describe('a label’s colours', () => {
  const palettes = buildPalettes(channels)

  it('are settled against the status floors in both schemes', () => {
    for (const palette of [palettes.light, palettes.dark]) {
      expect(palette.labels.map((label) => label.name)).toEqual(['alcove', 'almanac', 'nook'])
      const { paper, surface, raised } = palette.colours
      for (const label of palette.labels) {
        for (const background of [paper, surface, raised, label.fill]) {
          expect(contrastRatio(label.ink, background)).toBeGreaterThanOrEqual(
            CONTRAST_FLOORS.secondary.ratio - 0.05,
          )
        }
        expect(contrastRatio(label.stroke, raised)).toBeGreaterThanOrEqual(
          CONTRAST_FLOORS.nonText.ratio - 0.05,
        )
        expect(apcaLc(label.stroke, raised)).toBeGreaterThanOrEqual(CONTRAST_FLOORS.nonText.lc - 1)
      }
    }
  })

  it('keep the label’s hue, and are quieter in dark than in light', () => {
    const [light] = palettes.light.labels
    const [dark] = palettes.dark.labels
    expect(light?.ink.hue).toBeCloseTo(15, 0)
    expect(dark?.ink.chroma ?? 1).toBeLessThan(light?.ink.chroma ?? 0)
  })

  it('are checked by the doctor, which leaves the rule out of a theme with none', () => {
    expect(verdict(instrument)).toBeUndefined()
    expect(verdict(channels)).toMatchObject({ status: 'pass' })
  })

  it('a stored label a newer release made a built-in is flagged by the doctor', () => {
    const shadowed: ThemeDocument = {
      ...instrument,
      labels: [{ name: 'badge', title: 'Old', hue: 10 }],
    }
    expect(verdict(shadowed)).toMatchObject({ status: 'warn', detail: /badge is shadowed/u })
  })
})

describe('a label in the stylesheet', () => {
  const generated = generateTheme(channels)
  const css = toCss(generated, { selector: ".org[data-id='x']" })

  it('is generated with its title and its tokens in both schemes', () => {
    expect(generated.labels.map(({ name, title }) => ({ name, title }))).toEqual([
      { name: 'alcove', title: 'Alcove' },
      { name: 'almanac', title: 'Almanac.org' },
      { name: 'nook', title: 'Nook' },
    ])
    expect(generated.labels[0]?.light.ink).toMatch(/^oklch\(/u)
  })

  it('declares ink, fill and stroke in every scheme block', () => {
    const [alcove] = generated.labels
    expect(css.split(`--label-alcove-ink: ${alcove?.light.ink};`)).toHaveLength(2)
    expect(css.split(`--label-alcove-ink: ${alcove?.dark.ink};`)).toHaveLength(3)
    expect(css.match(/--label-almanac-stroke: /gu)).toHaveLength(3)
    expect(css.match(/--label-nook-fill: /gu)).toHaveLength(3)
  })

  it('dots a pill and colours a drawing from the same name, under the theme’s selector', () => {
    expect(css).toContain(
      ".org[data-id='x'] .badge[data-label='alcove'] {\n  --label-dot: var(--label-alcove-stroke);\n}",
    )
    expect(css).toContain(
      ".org[data-id='x'] .diagram[data-diagram='svg'] :is(.alcove, .alcove *):is(path, line, polyline) {\n  stroke: var(--label-alcove-stroke);\n}",
    )
    expect(css).toContain(
      ':is(.almanac, .almanac *):is(text, tspan) {\n  fill: var(--label-almanac-ink);',
    )
  })

  it('is absent from a theme without labels, which writes what it always wrote', () => {
    const plain = toCss(generateTheme(instrument))
    expect(plain).not.toContain('--label-')
    expect(plain).not.toContain('data-label')
    expect(plain.endsWith('color-scheme: light;\n}\n')).toBe(true)
  })

  it('leaves out a name that never passed validation rather than write it into a selector', () => {
    const tokens = { ink: 'red', fill: 'white', stroke: 'red' }
    const forged = { name: 'x] body {', title: 'X', light: tokens, dark: tokens }
    expect(labelRules([forged], ':root')).toBe('')
  })
})
