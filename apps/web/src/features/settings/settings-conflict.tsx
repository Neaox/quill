import type { ReactNode } from 'react'

import { Button, Callout } from '@quill/ui'

export interface SettingsConflictProps {
  /** What is on the server now, in words: the values the other person saved. */
  readonly current: ReactNode
  /** Replaces the form with the server's values and clears this notice. */
  readonly onReload: () => void
  /** Keeps the form as it is and takes the server's revision, so the next save wins. */
  readonly onReplace: () => void
  /** "settings" by default; a screen may name what it edits. */
  readonly noun?: string
}

/**
 * Somebody else saved while this form was open (`409 settings_conflict`).
 *
 * The server refuses such a write rather than merging it, because blending
 * two administrators' versions of a policy produces one neither of them chose
 * (`docs/architecture/api-contract-settings.md`). So the screen has exactly
 * two honest things to offer, and offers both as **named actions**: take their
 * version, which replaces what is in the form, or replace theirs, which keeps
 * the form and adopts their revision so the next save is accepted.
 *
 * Replacing is a button rather than "just press Save again" on purpose. The
 * revision a draft saves with never moves on its own (`use-settings-draft.ts`),
 * so overwriting somebody is something a person does deliberately, having read
 * what they are overwriting — which is why their values are shown here rather
 * than a warning about them.
 *
 * It is a `warning`, not a `danger`: nothing has been lost. The edits are
 * still in the form, and so is the other person's revision, in the history.
 */
export function SettingsConflict({
  current,
  onReload,
  onReplace,
  noun = 'settings',
}: SettingsConflictProps) {
  return (
    <Callout tone="warning" title={`Somebody else changed these ${noun}`}>
      <p>Their version is on the server now:</p>
      {current}
      <p>
        Start again from theirs, or keep what is in this form and replace it. Either way their
        version stays in the history.
      </p>
      <p className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onReload}>
          Load their version
        </Button>
        <Button size="sm" variant="secondary" onClick={onReplace}>
          Replace theirs with mine
        </Button>
      </p>
    </Callout>
  )
}
