import type { Adjustment } from '../colour/adjustment.ts'
import { buildPalettes, type ThemePalettes } from '../colour/palette.ts'
import type { ThemeDocument } from '../schema/theme-document.ts'
import type { Evidence } from './evidence.ts'
import { applicableRules, ENFORCED_RULE_ID } from './rules/all.ts'
import { DEFAULT_DOCTOR_OPTIONS, type DoctorOptions, type Rule, type RuleStatus } from './rule.ts'

export type RuleResult = {
  readonly id: string
  readonly section: number
  readonly title: string
  readonly status: RuleStatus
  readonly detail: string
  /**
   * True for the one rule ADR-028 enforces by default, on an instance that
   * has not switched that enforcement to advisory. It marks the finding a
   * tenant is expected to act on rather than keep; it does not mean anything
   * refuses to save, because the doctor advises and never blocks.
   */
  readonly enforced: boolean
  /** What was measured, in both schemes; empty for a rule with nothing to show. */
  readonly evidence: readonly Evidence[]
  /** True when the rule warns and the theme document records that the tenant accepted it. */
  readonly acknowledged: boolean
}

export type ThemeReport = {
  readonly themeId: string
  readonly results: readonly RuleResult[]
  readonly summary: Readonly<Record<RuleStatus, number>>
  readonly warnings: readonly RuleResult[]
  /** Every place the generator changed what the seeds asked for. */
  readonly adjustments: readonly Adjustment[]
  /**
   * True when no enforced rule warned.
   *
   * It used to say "so the theme may be saved", which is not what happens:
   * ADR-028 is explicit that the doctor advises and does not block, and
   * `updateOrganisationSettings` saves a theme whether this holds or not. It
   * is what the theme editor puts in front of the administrator — beside the
   * reason, and beside the instance switch that makes the rule advisory.
   */
  readonly enforcedRulesHold: boolean
}

export const resolveDoctorOptions = (
  options: Partial<DoctorOptions> | undefined,
): DoctorOptions => ({
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
    evidence: rule.evidence?.(theme, palettes, options) ?? [],
    acknowledged: outcome.status === 'warn' && (theme.acknowledged ?? []).includes(rule.id),
  }
}

/** Run every rule against palettes that have already been generated. */
export const reportOn = (
  theme: ThemeDocument,
  palettes: ThemePalettes,
  options?: Partial<DoctorOptions>,
): ThemeReport => {
  const resolved = resolveDoctorOptions(options)
  const results = applicableRules(theme).map((rule) =>
    evaluateRule(rule, theme, palettes, resolved),
  )
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
