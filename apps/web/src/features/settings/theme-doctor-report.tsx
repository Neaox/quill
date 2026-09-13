import { Badge, Button, Callout, tv, type BadgeTone } from '@quill/ui'

/**
 * The theme doctor's verdict, beside the form that produced it (ADR-028).
 *
 * Every rule in `docs/design/colour-rules.md` reports `pass`, `adjusted` with
 * the adjustment named, or `warn` with the reason. **None of it blocks a
 * save**: the doctor advises. The one rule enforced by default — AA text
 * contrast — is marked `enforced`, and when it warns, this is where that is
 * put to the administrator: in front of the reason, and in front of the
 * instance switch that makes it advisory. Turning that switch to advisory
 * changes what is reported here and nothing about whether the theme saves.
 *
 * What is shown is the report **this browser generated** from the document in
 * the form, which is what lets it answer before a save rather than after.
 * `PUT /settings/organisation` also returns one, and the two describe the same
 * rules over the same palettes; that one is deliberately not rendered, because
 * swapping the report on save would replace a live answer with a stale one the
 * moment the next lever moved. The shape below is therefore only what both
 * carry, so the server's could be shown if a generator version skew ever made
 * the difference worth seeing.
 */

export interface DoctorRuleView {
  readonly id: string
  readonly section: number
  readonly title: string
  readonly status: 'pass' | 'adjusted' | 'warn'
  readonly detail: string
  readonly enforced: boolean
}

export interface DoctorAdjustmentView {
  readonly role: string
  readonly property: string
  readonly reason: string
  readonly from: number
  readonly to: number
}

export interface DoctorReportView {
  readonly results: readonly DoctorRuleView[]
  readonly summary: { readonly pass: number; readonly adjusted: number; readonly warn: number }
  readonly adjustments: readonly DoctorAdjustmentView[]
  readonly enforcedRulesHold: boolean
}

const STATUS_TONE: Readonly<Record<DoctorRuleView['status'], BadgeTone>> = {
  pass: 'success',
  adjusted: 'accent',
  warn: 'warning',
}

const STATUS_LABEL: Readonly<Record<DoctorRuleView['status'], string>> = {
  pass: 'Pass',
  adjusted: 'Adjusted',
  warn: 'Warn',
}

export const doctorReportStyles = tv({
  slots: {
    root: 'flex flex-col gap-3',
    summary: 'meta text-muted',
    list: 'flex flex-col divide-y divide-border rounded-md border border-border',
    row: 'flex items-start gap-2.5 px-3 py-2',
    badge: 'mt-px shrink-0',
    text: 'min-w-0',
    title: 'block text-xs font-medium text-foreground',
    detail: 'mt-0.5 block text-2xs leading-normal break-words text-muted',
    adjustments: 'mt-2 flex flex-col gap-1 text-2xs leading-normal text-muted',
    disclosure: 'rounded-md border border-border px-3 py-2',
    disclosureSummary: 'focus-ring cursor-pointer rounded-sm text-xs font-medium text-foreground',
  },
})

/** How many decimal places each adjusted property is worth reading at. */
const PLACES: Readonly<Record<string, number>> = { lightness: 1, chroma: 4, hue: 1 }

function round(value: number, places: number): string {
  const factor = 10 ** places
  return String(Math.round(value * factor) / factor)
}

export function describeAdjustmentView(adjustment: DoctorAdjustmentView): string {
  const places = PLACES[adjustment.property] ?? 2
  return `${adjustment.role} ${adjustment.property} ${round(adjustment.from, places)} to ${round(
    adjustment.to,
    places,
  )} (${adjustment.reason})`
}

export interface ThemeDoctorReportProps {
  readonly report: DoctorReportView
  /** `advisory` on this instance changes what the enforced rule reports, never the save. */
  readonly contrastEnforcement: 'enforced' | 'advisory'
  /** Turns the instance switch to advisory, from beside the finding it is about. */
  readonly onRelaxEnforcement?: (() => void) | undefined
}

export function ThemeDoctorReport({
  report,
  contrastEnforcement,
  onRelaxEnforcement,
}: ThemeDoctorReportProps) {
  const styles = doctorReportStyles()
  const enforcedWarning = report.results.find(
    (result) => result.enforced && result.status === 'warn',
  )

  return (
    <div className={styles.root()}>
      <p className={styles.summary()}>
        {report.summary.pass} pass · {report.summary.adjusted} adjusted · {report.summary.warn} warn
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
        <p className="text-xs text-muted">
          Contrast enforcement is advisory on this instance, so AA text contrast is reported like
          every other rule.
        </p>
      ) : undefined}

      <ul aria-label="Theme doctor report" className={styles.list()}>
        {report.results.map((result) => (
          <li key={result.id} className={styles.row()}>
            <Badge tone={STATUS_TONE[result.status]} className={styles.badge()}>
              {STATUS_LABEL[result.status]}
            </Badge>
            <span className={styles.text()}>
              <span className={styles.title()}>
                {result.title}
                {result.enforced ? ' (enforced)' : ''}
              </span>
              <span className={styles.detail()}>{result.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {report.adjustments.length === 0 ? undefined : (
        // Every adjustment is worth being able to read and worth not having to:
        // it is the answer to "why is my accent not the colour I chose", and it
        // is thirty lines long. `details` is the element for exactly that, and
        // the disclosure is the browser's rather than ours.
        <details className={styles.disclosure()}>
          <summary className={styles.disclosureSummary()}>
            What the generator changed from the seeds ({report.adjustments.length})
          </summary>
          <ul aria-label="Generator adjustments" className={styles.adjustments()}>
            {/*
             * The position is the identity. An adjustment has no id and is not
             * unique by its own fields: `report.adjustments` is the light
             * palette's log followed by the dark one's, and the two regularly
             * make the *same* correction — "accent chroma, gamut" appears once
             * per scheme — so keying by role, property and reason gave React
             * duplicate keys and licence to drop one of the pair. This is an
             * ordered log that is replaced wholesale on every regeneration,
             * which is exactly the shape an index key is right for.
             */}
            {report.adjustments.map((adjustment, index) => (
              <li key={index}>{describeAdjustmentView(adjustment)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
