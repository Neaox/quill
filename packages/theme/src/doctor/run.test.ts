import { describe, expect, it } from 'vitest'
import { instrument } from '../builtin/instrument.ts'
import { buildPalettes } from '../colour/palette.ts'
import type { ThemeDocument } from '../schema/theme-document.ts'
import { ALL_RULES, applicableRules, ENFORCED_RULE_ID } from './rules/all.ts'
import { reportOn, runThemeDoctor } from './run.ts'

/** A tenant who drags the ink almost onto the paper. */
const unreadable: ThemeDocument = {
  ...instrument,
  id: 'unreadable',
  overrides: { light: { '--palette-foreground': 'oklch(95% 0.006 250)' } },
}

/** The rules a report on this theme names, in order. */
const ids = (theme: ThemeDocument) => runThemeDoctor(theme).results.map((result) => result.id)

describe('runThemeDoctor', () => {
  it('reports on every rule that applies, once', () => {
    const report = runThemeDoctor(instrument)
    const applicable = applicableRules(instrument)
    expect(report.results).toHaveLength(applicable.length)
    expect(new Set(report.results.map((result) => result.id)).size).toBe(applicable.length)
    expect(report.themeId).toBe('instrument')
  })

  it('leaves out a rule with nothing to judge, rather than counting it a pass', () => {
    expect(ids(instrument)).not.toContain('legibility/labels')
    const labelled = { ...instrument, labels: [{ name: 'airbnb', title: 'Airbnb', hue: 15 }] }
    expect(ids(labelled)).toEqual(ALL_RULES.map((rule) => rule.id))
  })

  it('summarises the statuses and lists the warnings', () => {
    const report = runThemeDoctor(unreadable)
    const total = report.summary.pass + report.summary.adjusted + report.summary.warn
    expect(total).toBe(applicableRules(unreadable).length)
    expect(report.warnings.map((result) => result.id)).toContain(ENFORCED_RULE_ID)
  })

  it('carries the generator adjustments alongside the rules', () => {
    const report = runThemeDoctor(instrument)
    expect(report.adjustments.length).toBeGreaterThan(0)
    expect(report.adjustments.every((entry) => entry.role !== '')).toBe(true)
  })

  it('enforces AA text contrast by default, and lets an administrator make it advisory', () => {
    expect(runThemeDoctor(unreadable).enforcedRulesHold).toBe(false)
    const advisory = runThemeDoctor(unreadable, { textContrast: 'advisory' })
    expect(advisory.enforcedRulesHold).toBe(true)
    expect(advisory.results.every((result) => !result.enforced)).toBe(true)
    expect(advisory.warnings.map((result) => result.id)).toContain(ENFORCED_RULE_ID)
  })

  it('holds when nothing is enforced against it', () => {
    expect(runThemeDoctor(instrument).enforcedRulesHold).toBe(true)
  })
})

describe('reportOn', () => {
  it('grades palettes that were generated elsewhere, so nothing is generated twice', () => {
    const palettes = buildPalettes(instrument)
    expect(reportOn(instrument, palettes)).toEqual(runThemeDoctor(instrument))
  })
})
