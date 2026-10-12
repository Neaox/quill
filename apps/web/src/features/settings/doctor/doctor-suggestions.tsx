import { useDeferredValue, useId, useMemo } from 'react'

import { Button, tv } from '@quill/ui'

import {
  SCHEMES,
  suggestFixes,
  type Evidence,
  type Suggestion,
  type ThemeChange,
  type ThemeDocument,
} from '@quill/theme'

import { capitalise, describeChange, describeChangeDetail } from './doctor-copy.ts'
import { EvidenceSample, evidenceFails, evidenceKey, evidenceLabel } from './evidence-table.tsx'

/** Identifies a suggestion across regenerations, so a dismissal outlives the next lever move. */
export function suggestionKey(ruleId: string, change: ThemeChange): string {
  return `${ruleId}:${JSON.stringify(change)}`
}

export const suggestionStyles = tv({
  slots: {
    root: 'flex flex-col gap-2',
    heading: 'text-xs font-medium text-foreground',
    note: 'text-xs leading-relaxed text-muted',
    list: 'flex flex-col items-start gap-2',
    card: [
      'flex w-fit max-w-full flex-col gap-2.5 rounded-md border border-border bg-surface',
      'px-3 py-2.5',
    ],
    title: 'text-xs font-medium text-foreground',
    pairs: 'flex flex-col gap-1.5',
    pair: 'flex items-start gap-2',
    scheme: 'w-9 shrink-0 pt-3.5 text-2xs text-muted',
    arrow: 'pt-3.5 text-2xs text-muted',
    footer: 'flex flex-wrap items-center gap-x-3 gap-y-1',
    actions: 'flex gap-2',
    details: 'text-2xs text-muted',
    detailsSummary: 'focus-ring w-fit cursor-pointer rounded-sm',
    unfixable: 'flex flex-col items-start gap-2',
  },
})

interface ComparisonProps {
  readonly before: readonly Evidence[]
  readonly after: readonly Evidence[]
}

/**
 * The first thing that failed, now and with the change, in each scheme it
 * failed in — drawn as the specimen itself, side by side, which is how a
 * reader judges whether the fix still feels like their brand: the colour
 * that stayed, and the room around it that moved.
 */
function Comparison({ before, after }: ComparisonProps) {
  const styles = suggestionStyles()
  // The first thing that failed is the example; every row is that thing, in
  // each scheme it failed in, so the scheme is all a row needs to say.
  const rows = before
    .filter(evidenceFails)
    .slice(0, 1)
    .flatMap((entry) => {
      const changed = after.find((candidate) => evidenceKey(candidate) === evidenceKey(entry))
      if (changed === undefined) return []
      return SCHEMES.filter((scheme) => entry.kind !== 'adjustment' && !entry[scheme].holds).map(
        (scheme) => ({ entry, changed, scheme }),
      )
    })
  if (rows.length === 0) return undefined

  return (
    <ul className={styles.pairs()}>
      {rows.map(({ entry, changed, scheme }) => (
        <li key={`${evidenceKey(entry)} ${scheme}`} className={styles.pair()}>
          <span className={styles.scheme()}>{capitalise(scheme)}</span>
          <span className="sr-only">{evidenceLabel(entry)}, now:</span>
          <EvidenceSample entry={entry} scheme={scheme} stacked />
          <span aria-hidden="true" className={styles.arrow()}>
            →
          </span>
          <span className="sr-only">with this change:</span>
          <EvidenceSample entry={changed} scheme={scheme} stacked />
        </li>
      ))}
    </ul>
  )
}

interface SuggestionCardProps {
  readonly suggestion: Suggestion
  readonly brandColour: string
  readonly before: readonly Evidence[]
  readonly onApply: () => void
  readonly onDismiss: () => void
}

function SuggestionCard({
  suggestion,
  brandColour,
  before,
  onApply,
  onDismiss,
}: SuggestionCardProps) {
  const titleId = useId()
  const styles = suggestionStyles()

  return (
    <li className={styles.card()}>
      <p id={titleId} className={styles.title()}>
        {describeChange(suggestion.change, brandColour)}
      </p>
      <Comparison before={before} after={suggestion.result.evidence} />
      <div className={styles.footer()}>
        <div className={styles.actions()}>
          <Button size="sm" variant="secondary" aria-describedby={titleId} onClick={onApply}>
            Apply
          </Button>
          <Button size="sm" variant="ghost" aria-describedby={titleId} onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
        <details className={styles.details()}>
          <summary className={styles.detailsSummary()}>Details</summary>
          <p>{describeChangeDetail(suggestion.change)}</p>
        </details>
      </div>
    </li>
  )
}

export interface DoctorSuggestionsProps {
  readonly theme: ThemeDocument
  readonly ruleId: string
  readonly evidence: readonly Evidence[]
  readonly contrastEnforcement: 'enforced' | 'advisory'
  /** The brand colour in words — "teal" — for when no fix can keep it. */
  readonly brandColour: string
  readonly dismissed: ReadonlySet<string>
  readonly onApply: (suggestion: Suggestion) => void
  readonly onDismiss: (key: string) => void
  /** Records that the tenant accepts this warning as part of the brand. */
  readonly onAccept: () => void
}

/**
 * The doctor's suggested fixes for one warning, each verified by `@quill/theme`
 * — clearing the rule, worsening nothing, and keeping the brand's hue and
 * colour — and the closest to what the tenant had first.
 *
 * When nothing can be fixed without losing the brand, that is said plainly
 * and the warning can be accepted as it is, rather than a grey offered.
 *
 * Finding fixes means generating the theme a few dozen times, so they are
 * looked for only once a warning is opened, behind a deferred value: the row
 * opens at once and the fixes follow a moment later.
 */
export function DoctorSuggestions({
  theme,
  ruleId,
  evidence,
  contrastEnforcement,
  brandColour,
  dismissed,
  onApply,
  onDismiss,
  onAccept,
}: DoctorSuggestionsProps) {
  const styles = suggestionStyles()
  const searched = useDeferredValue<ThemeDocument | null>(theme, null)
  const suggestions = useMemo(
    () =>
      searched === null
        ? undefined
        : suggestFixes(searched, ruleId, { textContrast: contrastEnforcement }),
    [searched, ruleId, contrastEnforcement],
  )

  if (suggestions === undefined) {
    return (
      <p role="status" className={styles.note()}>
        Looking for fixes…
      </p>
    )
  }

  const offered = suggestions.filter(
    (suggestion) => !dismissed.has(suggestionKey(ruleId, suggestion.change)),
  )

  if (offered.length === 0) {
    const failing = evidence.find(evidenceFails)
    const subject = failing === undefined ? 'This' : evidenceLabel(failing)
    return (
      <div className={styles.unfixable()}>
        <p className={styles.note()}>
          {suggestions.length === 0
            ? `Can’t fix this without losing your ${brandColour}. ${subject} stays as set; the doctor will keep flagging it.`
            : `No other suggestions. ${subject} stays as set; the doctor will keep flagging it.`}
        </p>
        <Button size="sm" variant="secondary" onClick={onAccept}>
          Accept as is
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.root()}>
      <p className={styles.heading()}>Suggested fixes</p>
      <ul className={styles.list()}>
        {offered.map((suggestion) => {
          const key = suggestionKey(ruleId, suggestion.change)
          return (
            <SuggestionCard
              key={key}
              suggestion={suggestion}
              brandColour={brandColour}
              before={evidence}
              onApply={() => {
                onApply(suggestion)
              }}
              onDismiss={() => {
                onDismiss(key)
              }}
            />
          )
        })}
      </ul>
    </div>
  )
}
