import type { Adjustment } from '../colour/adjustment.ts'
import { buildPalettes, type ThemePalettes } from '../colour/palette.ts'
import type { ThemeDocument } from '../schema/theme-document.ts'
import { ALL_RULES, ENFORCED_RULE_ID } from './rules/all.ts'
import { DEFAULT_DOCTOR_OPTIONS, type DoctorOptions, type Rule, type RuleStatus } from './rule.ts'

export type RuleResult = {
  readonly id: string
  readonly section: number
  readonly title: string
  readonly status: RuleStatus
  readonly detail: string
  /**
   * True for the one rule ADR-028 enforces by default. An enforced rule that
   * fails is a blocking problem; everything else is advice a tenant may keep.
   */
  readonly enforced: boolean
}

export type ThemeReport = {
  readonly themeId: string
  readonly results: readonly RuleResult[]
  readonly summary: Readonly<Record<RuleStatus, number>>
  readonly warnings: readonly RuleResult[]
  /** Every place the generator changed what the seeds asked for. */
  readonly adjustments: readonly Adjustment[]
  /** True when no enforced rule failed, so the theme may be saved. */
  readonly enforcedRulesHold: boolean
}

const resolve = (options: Partial<DoctorOptions> | undefined): DoctorOptions => ({
  ...DEFAULT_DOCTOR_OPTIONS,
  ...options,
})

const evaluateRule = (
  rule: Rule,
  theme: ThemeDocument,
  palettes: ThemePalettes,
  options: DoctorOptions,
): RuleResult => {
  const outcome = rule.evaluate(theme, palettes, options)
  return {
    id: rule.id,
    section: rule.section,
    title: rule.title,
    status: outcome.status,
    detail: outcome.detail,
    enforced: rule.id === ENFORCED_RULE_ID && options.textContrast === 'enforced',
  }
}

/** Run every rule against palettes that have already been generated. */
export const reportOn = (
  theme: ThemeDocument,
  palettes: ThemePalettes,
  options?: Partial<DoctorOptions>,
): ThemeReport => {
  const resolved = resolve(options)
  const results = ALL_RULES.map((rule) => evaluateRule(rule, theme, palettes, resolved))
  const summary = {
    pass: results.filter((result) => result.status === 'pass').length,
    adjusted: results.filter((result) => result.status === 'adjusted').length,
    warn: results.filter((result) => result.status === 'warn').length,
  }
  const warnings = results.filter((result) => result.status === 'warn')
  return {
    themeId: theme.id,
    results,
    summary,
    warnings,
    adjustments: [...palettes.light.adjustments, ...palettes.dark.adjustments],
    enforcedRulesHold: !warnings.some((result) => result.enforced),
  }
}

/**
 * The theme doctor: every rule in `docs/design/colour-rules.md` reported as
 * pass, adjusted, or warn, with the reason (ADR-028).
 */
export const runThemeDoctor = (
  theme: ThemeDocument,
  options?: Partial<DoctorOptions>,
): ThemeReport => reportOn(theme, buildPalettes(theme), options)
