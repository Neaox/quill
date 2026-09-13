import type { ThemePalettes } from '../colour/palette.ts'
import type { ThemeDocument } from '../schema/theme-document.ts'

export type RuleStatus = 'pass' | 'adjusted' | 'warn'

export type RuleOutcome = {
  readonly status: RuleStatus
  readonly detail: string
}

export type DoctorOptions = {
  /**
   * ADR-028: AA text contrast is the one rule enforced by default, and an
   * instance administrator may switch it to advisory.
   */
  readonly textContrast: 'enforced' | 'advisory'
  /** Accent coverage measured in the live preview, 0 to 1, when it is known. */
  readonly accentCoverage?: number | undefined
}

export const DEFAULT_DOCTOR_OPTIONS: DoctorOptions = { textContrast: 'enforced' }

export type Rule = {
  readonly id: string
  /** The section of `docs/design/colour-rules.md` this rule comes from. */
  readonly section: number
  readonly title: string
  readonly evaluate: (
    theme: ThemeDocument,
    palettes: ThemePalettes,
    options: DoctorOptions,
  ) => RuleOutcome
}

export const pass = (detail: string): RuleOutcome => ({ status: 'pass', detail })
export const adjusted = (detail: string): RuleOutcome => ({ status: 'adjusted', detail })
export const warn = (detail: string): RuleOutcome => ({ status: 'warn', detail })

export type Check = { readonly label: string; readonly ok: boolean }

export const check = (label: string, ok: boolean): Check => ({ label, ok })

/** Most rules are a list of measurements that either hold or do not. */
export const fromChecks = (checks: readonly Check[], whenAllHold: string): RuleOutcome => {
  const failures = checks.filter((entry) => !entry.ok)
  return failures.length === 0
    ? pass(whenAllHold)
    : warn(failures.map((entry) => entry.label).join('; '))
}

export const round = (value: number, places = 2): string => {
  const factor = 10 ** places
  return String(Math.round(value * factor) / factor)
}
