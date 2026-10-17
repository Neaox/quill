import type { RuleStatus } from './rule.ts'

/**
 * How much a finding asks of the reader: a warning to look at, an adjustment
 * the generator made for them, a warning they have already accepted, or
 * nothing. A rule's own status says what it found; its severity also says
 * whether the tenant has answered it.
 */
export type Severity = RuleStatus | 'accepted'

/**
 * The order a reader needs the doctor's findings in, so a problem is never
 * buried under the passes, and one already accepted no longer competes with
 * one that has not been looked at.
 */
export const SEVERITY_ORDER: readonly Severity[] = ['warn', 'adjusted', 'accepted', 'pass']

type Graded = { readonly status: RuleStatus; readonly acknowledged?: boolean | undefined }

/** A warning the tenant accepted is "accepted"; an acceptance of anything else means nothing. */
export const severityOf = (result: Graded): Severity =>
  result.status === 'warn' && result.acknowledged === true ? 'accepted' : result.status

export type SeverityGroup<Result> = {
  readonly severity: Severity
  readonly results: readonly Result[]
}

/** Results grouped by severity, most severe first, each in the rules' own order; no empty groups. */
export const bySeverity = <Result extends Graded>(
  results: readonly Result[],
): readonly SeverityGroup<Result>[] =>
  SEVERITY_ORDER.map((severity) => ({
    severity,
    results: results.filter((result) => severityOf(result) === severity),
  })).filter((group) => group.results.length > 0)

/** How many findings fall at each severity: what the verdict is drawn from. */
export type Verdict = Readonly<Record<Severity, number>>

export const verdictOf = (results: readonly Graded[]): Verdict => {
  const count = (severity: Severity) =>
    results.filter((result) => severityOf(result) === severity).length
  return {
    warn: count('warn'),
    adjusted: count('adjusted'),
    accepted: count('accepted'),
    pass: count('pass'),
  }
}

export type SeverityCount = { readonly severity: Severity; readonly count: number }

/** A verdict in severity order, without the severities nothing fell at. */
export const severityCounts = (verdict: Verdict): readonly SeverityCount[] =>
  SEVERITY_ORDER.map((severity) => ({ severity, count: verdict[severity] })).filter(
    (entry) => entry.count > 0,
  )
