import { Badge, type BadgeTone } from '@quill/ui'

import type { AutosaveStatus, LockStatus } from '@quill/editor'

/**
 * What the editor says about itself, in one line.
 *
 * Two state machines run behind a writing session — the lock (ADR-021's
 * acquire, heartbeat, escalate, lose) and autosave (buffer, debounce, save,
 * conflict) — and an author needs one answer, not two. This resolves them in
 * order of consequence: anything that means "your next keystroke may not be
 * saved" outranks anything that means "it was".
 */

export interface EditorStatusDescription {
  readonly tone: BadgeTone
  readonly label: string
  /** True while the author should not expect their edits to be reaching the server. */
  readonly atRisk: boolean
}

export interface EditorStatusInput {
  readonly autosave: AutosaveStatus
  readonly lock: LockStatus
  readonly holderName: string | undefined
}

export function describeEditorStatus({
  autosave,
  lock,
  holderName,
}: EditorStatusInput): EditorStatusDescription {
  if (autosave === 'signed_out') {
    return { tone: 'danger', label: 'signed out', atRisk: true }
  }
  if (autosave === 'blocked' || lock === 'lost') {
    return { tone: 'danger', label: 'lock lost', atRisk: true }
  }
  if (lock === 'held_by_other') {
    return {
      tone: 'warning',
      label: `${holderName ?? 'someone else'} is editing`,
      atRisk: true,
    }
  }
  if (autosave === 'stale') {
    return { tone: 'warning', label: 'draft changed elsewhere', atRisk: true }
  }
  if (lock === 'at_risk') {
    return { tone: 'warning', label: 'connection lost', atRisk: true }
  }
  if (lock === 'reconnecting') {
    return { tone: 'neutral', label: 'reconnecting', atRisk: true }
  }
  if (lock === 'idle' || lock === 'acquiring') {
    return { tone: 'neutral', label: 'opening', atRisk: true }
  }
  if (autosave === 'saving') return { tone: 'neutral', label: 'saving', atRisk: false }
  if (autosave === 'pending') return { tone: 'neutral', label: 'unsaved changes', atRisk: false }
  if (autosave === 'saved') return { tone: 'success', label: 'draft saved', atRisk: false }
  return { tone: 'neutral', label: 'editing', atRisk: false }
}

export interface EditorStatusProps extends EditorStatusInput {
  readonly className?: string | undefined
}

/**
 * A live region, because the status changes on its own: an author who has
 * just lost the lock must be told without having to look at the corner of
 * the screen. `polite`, so it never interrupts typing.
 */
export function EditorStatus({ autosave, lock, holderName, className }: EditorStatusProps) {
  const status = describeEditorStatus({ autosave, lock, holderName })

  return (
    <p aria-live="polite" className={className}>
      <Badge tone={status.tone}>{status.label}</Badge>
    </p>
  )
}
