import { Badge, Button, type BadgeTone } from '@quill/ui'

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
  if (autosave === 'conflict') {
    return { tone: 'warning', label: 'draft changed elsewhere', atRisk: true }
  }
  if (autosave === 'failed') {
    return { tone: 'danger', label: 'couldn’t save', atRisk: true }
  }
  if (autosave === 'offline') {
    return { tone: 'warning', label: 'offline — will retry', atRisk: true }
  }
  if (lock === 'at_risk') {
    return { tone: 'warning', label: 'connection lost', atRisk: true }
  }
  if (lock === 'reconnecting') {
    return { tone: 'neutral', label: 'reconnecting', atRisk: true }
  }
  if (autosave === 'retrying') {
    return { tone: 'warning', label: 'not saved — retrying', atRisk: true }
  }
  if (lock === 'idle' || lock === 'acquiring') {
    return { tone: 'neutral', label: 'opening', atRisk: true }
  }
  if (autosave === 'saving') return { tone: 'neutral', label: 'saving…', atRisk: false }
  if (autosave === 'dirty') return { tone: 'neutral', label: 'unsaved changes', atRisk: false }
  if (autosave === 'saved') return { tone: 'success', label: 'draft saved', atRisk: false }
  return { tone: 'neutral', label: 'editing', atRisk: false }
}

export interface EditorStatusProps extends EditorStatusInput {
  readonly className?: string | undefined
  /** Offered only while a save has failed for good (audit 2026-10-11, P0-1). */
  readonly onRetry?: (() => void) | undefined
}

/**
 * A live region, because the status changes on its own: an author who has
 * just lost the lock must be told without having to look at the corner of
 * the screen. `polite`, so it never interrupts typing.
 */
export function EditorStatus({
  autosave,
  lock,
  holderName,
  className,
  onRetry,
}: EditorStatusProps) {
  const status = describeEditorStatus({ autosave, lock, holderName })

  return (
    <div className={className}>
      <p aria-live="polite" className="inline">
        <Badge tone={status.tone}>{status.label}</Badge>
      </p>
      {autosave === 'failed' && onRetry !== undefined ? (
        <Button size="sm" variant="secondary" className="ms-2" onClick={onRetry}>
          Retry
        </Button>
      ) : undefined}
    </div>
  )
}
