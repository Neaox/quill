import { useState, type ReactNode } from 'react'

import { Button, Callout, ChevronRightIcon, tv } from '@quill/ui'

import {
  acknowledgeRule,
  applyThemeChange,
  bySeverity,
  describeColour,
  severityOf,
  verdictOf,
  withdrawAcknowledgement,
  type Severity,
  type Suggestion,
  type ThemeDocument,
} from '@quill/theme'

import { describeChange, STATUS_COPY } from './doctor/doctor-copy.ts'
import { DoctorRule, type DoctorRuleView } from './doctor/doctor-rule.tsx'
import { DoctorSuggestions } from './doctor/doctor-suggestions.tsx'
import { doctorGroupId, DoctorVerdict } from './doctor/doctor-verdict.tsx'

/**
 * The theme doctor's verdict, beside the form that produced it (ADR-028).
 *
 * Every rule in `docs/design/colour-rules.md` reports `pass`, `adjusted` with
 * the adjustment named, or `warn` with the reason, and the report reads in
 * that order of severity: what needs a look first, then what the generator
 * changed, then — folded away — what simply holds, so a clean theme is a
 * one-line all-clear and a problem is never buried under the passes.
 *
 * Each finding opens onto what was measured, drawn in both schemes; a
 * warning also offers fixes the doctor has verified, which **patch the draft
 * and do not save**: the preview updates, the Save button arms, and the last
 * one applied can be undone from here.
 *
 * **None of it blocks a save**: the doctor advises. The one rule enforced by
 * default — AA text contrast — is marked, and when it warns this is where
 * that is put to the administrator: in front of the reason, and in front of
 * the instance switch that makes it advisory.
 *
 * What is shown is the report **this browser generated** from the document in
 * the form, which is what lets it answer before a save rather than after.
 * `PUT /settings/organisation` also returns one, without the evidence; that
 * one is deliberately not rendered, because swapping the report on save would
 * replace a live answer with a stale one the moment the next lever moved.
 */

export interface DoctorReportView {
  readonly results: readonly DoctorRuleView[]
  readonly enforcedRulesHold: boolean
}

/** Warnings open by themselves when there are few enough to read at once. */
const OPEN_WARNINGS_UP_TO = 3

export const themeDoctorStyles = tv({
  slots: {
    root: 'flex flex-col gap-3',
    note: 'text-xs text-muted',
    inlineNote: 'flex flex-wrap items-center gap-x-2 text-xs text-muted',
    groups: 'flex flex-col gap-4',
    group: 'flex flex-col gap-1.5',
    heading: 'focus-ring w-fit rounded-sm text-xs font-medium text-foreground',
    count: 'font-normal text-muted',
    list: 'flex flex-col divide-y divide-border rounded-md border border-border',
    passGroup: 'group',
    passSummary: [
      'focus-ring flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm',
      '[&::-webkit-details-marker]:hidden',
    ],
    passChevron:
      'size-3.5 text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none',
    passList: 'mt-1.5',
  },
})

/** Takes the reader to a group of the report: the phone's sheet uses it to reach "Needs a look". */
export function focusDoctorGroup(severity: Severity): void {
  const heading = document.getElementById(doctorGroupId(severity))
  heading?.scrollIntoView({ block: 'start' })
  heading?.focus()
}

export interface ThemeDoctorProps {
  readonly report: DoctorReportView
  /** The draft the report was generated from; suggestions are searched for against it. */
  readonly theme: ThemeDocument
  /** `advisory` on this instance changes what the enforced rule reports, never the save. */
  readonly contrastEnforcement: 'enforced' | 'advisory'
  /** Turns the instance switch to advisory, from beside the finding it is about. */
  readonly onRelaxEnforcement?: (() => void) | undefined
  /** Patches the draft theme. Without it, warnings show no fixes. */
  readonly onThemeChange?: ((update: (current: ThemeDocument) => ThemeDocument) => void) | undefined
}

interface Applied {
  readonly previous: ThemeDocument
  readonly description: string
}

export function ThemeDoctor({
  report,
  theme,
  contrastEnforcement,
  onRelaxEnforcement,
  onThemeChange,
}: ThemeDoctorProps) {
  const styles = themeDoctorStyles()
  // Both last for this visit to the editor and no longer: a dismissal is "not
  // now", and an undo is for the change just made.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const [applied, setApplied] = useState<Applied>()
  const enforcedWarning = report.results.find(
    (result) => result.enforced && result.status === 'warn',
  )
  const groups = bySeverity(report.results)
  const verdict = verdictOf(report.results)
  const brandColour = describeColour(theme.seeds.accent).toLowerCase()

  function apply(suggestion: Suggestion) {
    onThemeChange?.((current) => applyThemeChange(current, suggestion.change))
    setApplied({ previous: theme, description: describeChange(suggestion.change, brandColour) })
  }

  /** What a tenant can do about a finding: fix or accept a warning, or flag an accepted one again. */
  function actionsFor(result: DoctorRuleView): ReactNode {
    if (onThemeChange === undefined) return undefined
    const severity = severityOf(result)
    if (severity === 'accepted') {
      return (
        <p className={styles.inlineNote()}>
          <span>You accepted this as part of the theme.</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onThemeChange((current) => withdrawAcknowledgement(current, result.id))
            }}
          >
            Flag it again
          </Button>
        </p>
      )
    }
    if (severity !== 'warn') return undefined
    return (
      <DoctorSuggestions
        theme={theme}
        ruleId={result.id}
        evidence={result.evidence ?? []}
        contrastEnforcement={contrastEnforcement}
        brandColour={brandColour}
        dismissed={dismissed}
        onApply={apply}
        onDismiss={(key) => {
          setDismissed(new Set([...dismissed, key]))
        }}
        onAccept={() => {
          onThemeChange((current) => acknowledgeRule(current, result.id))
        }}
      />
    )
  }

  return (
    <div className={styles.root()}>
      <p>
        <DoctorVerdict summary={verdict} linked />
      </p>

      {enforcedWarning === undefined ? undefined : (
        <Callout tone="warning" title="Text contrast does not meet AA">
          <p>{enforcedWarning.detail}</p>
          <p>
            This theme still saves — the doctor advises, it never blocks. Most organisations are
            bound to AA, which is why it is the one rule enforced by default.
          </p>
          {contrastEnforcement === 'enforced' && onRelaxEnforcement !== undefined ? (
            <p>
              <Button size="sm" variant="secondary" onClick={onRelaxEnforcement}>
                Make contrast enforcement advisory
              </Button>
            </p>
          ) : undefined}
        </Callout>
      )}

      {contrastEnforcement === 'advisory' && report.enforcedRulesHold ? (
        <p className={styles.note()}>
          Contrast enforcement is advisory on this instance, so AA text contrast is reported like
          every other rule.
        </p>
      ) : undefined}

      <p role="status" className={styles.inlineNote()}>
        {applied === undefined ? undefined : (
          <>
            <span>Applied: {applied.description}. Not saved yet.</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onThemeChange?.(() => applied.previous)
                setApplied(undefined)
              }}
            >
              Undo
            </Button>
          </>
        )}
      </p>

      <ul aria-label="Theme doctor report" className={styles.groups()}>
        {groups.map(({ severity, results }) => {
          const heading = (
            <>
              {STATUS_COPY[severity].heading}{' '}
              <span className={styles.count()}>· {results.length}</span>
            </>
          )
          const rules = (
            <ul className={styles.list()}>
              {results.map((result) => (
                <DoctorRule
                  key={result.id}
                  result={result}
                  defaultOpen={severity === 'warn' && results.length <= OPEN_WARNINGS_UP_TO}
                >
                  {actionsFor(result)}
                </DoctorRule>
              ))}
            </ul>
          )
          return (
            <li key={severity} className={styles.group()}>
              {severity === 'pass' ? (
                <details id={doctorGroupId(severity)} className={styles.passGroup()}>
                  <summary className={styles.passSummary()}>
                    <ChevronRightIcon className={styles.passChevron()} />
                    <h3 className={styles.heading()}>{heading}</h3>
                  </summary>
                  <div className={styles.passList()}>{rules}</div>
                </details>
              ) : (
                <>
                  <h3 id={doctorGroupId(severity)} tabIndex={-1} className={styles.heading()}>
                    {heading}
                  </h3>
                  {rules}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
