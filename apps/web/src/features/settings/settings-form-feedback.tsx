import type { ReactNode } from 'react'

import { Callout } from '@quill/ui'

import { isLayoutLocked, isSettingsConflict, readSettingsIssues } from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { SettingsConflict } from './settings-conflict.tsx'

export interface SettingsFormFeedbackProps {
  /** The save's failure, or `undefined`/`null` when the last save succeeded. */
  readonly error: unknown
  /** What this screen edits, for the conflict notice's heading. */
  readonly noun: string
  /** The server's current values, shown when a conflict is what happened. */
  readonly conflictSummary: ReactNode
  readonly onReload: () => void
  readonly onReplace: () => void
}

/**
 * What a settings screen says when a save was refused — **once**.
 *
 * Every refusal here has exactly one right shape, and they are mutually
 * exclusive, so the precedence lives in one place rather than four. Before
 * this, each screen rendered its designed state *and* fell through to
 * `FormError`, so a `409` arrived twice: as the warning callout that offers a
 * way forward, and again as an assertive `role="alert"` danger line repeating
 * the same sentence — the error-toast register `docs/design/feedback.md`
 * reserves for a failure somebody must act on, and two announcements of one
 * event for anyone listening rather than looking.
 *
 * The order is the order a person needs:
 *
 * 1. **A conflict** is a decision to make, and the only state that shows the
 *    other person's values.
 * 2. **A lock** is a rule that changed underneath: the organisation took the
 *    layout back while this page was open.
 * 3. **Schema issues** name the field, so they go beside the form.
 * 4. **Anything else** is unexpected, and that is what `FormError` is for.
 *
 * Four screens render this; extracting it is also what makes the rule above
 * one rule instead of four copies that can drift.
 */
export function SettingsFormFeedback({
  error,
  noun,
  conflictSummary,
  onReload,
  onReplace,
}: SettingsFormFeedbackProps) {
  if (isSettingsConflict(error)) {
    return (
      <SettingsConflict
        noun={noun}
        current={conflictSummary}
        onReload={onReload}
        onReplace={onReplace}
      />
    )
  }

  if (isLayoutLocked(error)) {
    return (
      <Callout tone="warning" title="This layout was refused">
        The organisation locked layout while this page was open, so this workspace no longer chooses
        its own. Reload the page to see the arrangement it has now.
      </Callout>
    )
  }

  const issues = readSettingsIssues(error)
  if (issues.length > 0) {
    return (
      <Callout tone="danger" title={`These ${noun} were refused`}>
        <ul>
          {issues.map((issue) => (
            <li key={`${issue.path}-${issue.rule}`}>
              <code>{issue.path === '' ? noun : issue.path}</code>: {issue.message}
            </li>
          ))}
        </ul>
      </Callout>
    )
  }

  return <FormError error={error} />
}
