import { useId, useState } from 'react'

import { Button, RestoreIcon, toast, tv } from '@quill/ui'

import {
  ApiError,
  DRAFT_SIDE,
  useDraft,
  usePutBackChanges,
  useUndoPutBack,
  type ComparisonChange,
  type ComparisonRange,
} from '../../../lib/api/index.ts'
import {
  broadcastRevertTransport,
  createRevertChannel,
  revertChannelName,
  type RevertChannel,
} from '../../../lib/documents/revert-channel.ts'
import { counted } from '../../../lib/text/plural.ts'
import { blockName, changeName } from './comparison-words.ts'

/**
 * Reverting changes from the comparison of the published page with the draft: one, or
 * several picked from the list, put back as they are published in one draft write.
 *
 * Where the draft goes depends on who holds it. An editor of this document open in another
 * tab of this browser holds it, so the request is handed to that editor
 * (`revert-channel.ts`), which applies it as one transaction of its own: Undo there brings
 * the changes back, and its next save is not a stale version to be merged. With no editor
 * open, the page writes the draft itself, and the toast's Undo puts back what it held
 * (`POST /draft/revert`, then `/draft/revert/undo`). Somebody else's session holding the
 * lock refuses either way (ADR-021).
 *
 * A change that cannot be reverted keeps its button, disabled, with the reason beside it
 * (`docs/design/feedback.md`, "Disable or hide"): the list is where people look for it.
 */

export const revertStyles = tv({
  slots: {
    bar: 'flex flex-wrap items-center justify-between gap-2 pb-2 text-xs text-muted',
    selectAll: 'flex items-center gap-1.5',
    pick: 'mt-2 size-4 shrink-0 accent-[var(--color-accent)]',
    side: 'flex shrink-0 flex-col items-end',
    button: 'mt-1 px-2 aria-disabled:cursor-default aria-disabled:opacity-50',
    reason: 'max-w-28 text-end text-2xs text-muted',
  },
})

export interface Revert {
  /** A revert is under way, or the draft is still being read. */
  readonly busy: boolean
  readonly picked: ReadonlySet<string>
  readonly toggle: (id: string) => void
  readonly pickAll: (ids: readonly string[]) => void
  readonly run: (changes: readonly ComparisonChange[]) => void
}

/** Why a change cannot be reverted here, in the words of what is true of it. */
export function whyNot(change: ComparisonChange): {
  readonly short: string
  readonly full: string
} {
  return change.change === 'moved'
    ? {
        short: 'A move can’t be reverted',
        full: 'A move can’t be reverted from here: the block is the same, and only its place differs. Move it back in the editor.',
      }
    : {
        short: 'Written differently in your draft',
        full: 'This block is written differently in your draft than it will be published (a template part, say), so reverting it here could change the wrong thing. Edit it in the editor instead.',
      }
}

/** A refusal at press time, in words that say what to do. */
export function revertRefusal(error: unknown): string {
  if (error instanceof RevertRefused) return error.message
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'lock_lost':
        return 'This document is being edited in another session. Revert from that editor, or try again when it is closed.'
      case 'stale_version':
        return 'The draft changed while you were looking. The changes shown are the latest; try again.'
      case 'not_revertible':
        return 'That change is written differently in the draft. Edit it in the editor instead.'
    }
  }
  return 'Couldn’t revert that. Your draft is as it was.'
}

/** An open editor's refusal, which says itself what to do. */
export class RevertRefused extends Error {}

export type PutBackResult =
  | { readonly kind: 'in-editor' }
  | {
      readonly kind: 'written'
      readonly draftVersion: number
      readonly previous: Record<string, unknown>
    }

/**
 * The changes put back: by the editor that holds the draft in this browser when there is
 * one, else by writing the draft. Throws the refusal when either says no.
 */
export async function putBack(input: {
  readonly channel: RevertChannel
  readonly from: string | null
  readonly draftVersion: number
  readonly changes: readonly string[]
  readonly write: () => Promise<{
    readonly draftVersion: number
    readonly previous: Record<string, unknown>
  }>
}): Promise<PutBackResult> {
  const answer = await input.channel.ask({
    from: input.from,
    draftVersion: input.draftVersion,
    changes: input.changes,
  })
  if (answer.ok === true) return { kind: 'in-editor' }
  if (answer.ok === false) throw new RevertRefused(answer.message)
  const written = await input.write()
  return { kind: 'written', ...written }
}

export function useRevert(
  documentId: string,
  range: ComparisonRange,
  canEdit: boolean,
): Revert | undefined {
  const offered = canEdit && range.to === DRAFT_SIDE
  const draft = useDraft(offered ? documentId : undefined)
  const write = usePutBackChanges()
  const undo = useUndoPutBack()
  const [channel] = useState(() =>
    createRevertChannel(broadcastRevertTransport(revertChannelName(documentId))),
  )
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [asking, setAsking] = useState(false)
  if (!offered) return undefined

  function undoing(draftVersion: number, ast: Record<string, unknown>) {
    undo.mutate(
      { documentId, draftVersion, ast },
      {
        onSuccess: () => toast.success('Restored to your draft'),
        onError: (error) => toast.danger(revertRefusal(error)),
      },
    )
  }

  function run(changes: readonly ComparisonChange[]) {
    const version = draft.data?.draftVersion
    if (version === undefined || changes.length === 0) return
    const ids = changes.map(({ id }) => id)
    const what = changes.length === 1 ? 'Change' : counted(changes.length, CHANGE)
    setAsking(true)
    putBack({
      channel,
      from: range.from,
      draftVersion: version,
      changes: ids,
      write: () =>
        write.mutateAsync({ documentId, from: range.from, draftVersion: version, changes: ids }),
    })
      .then((result) => {
        // The comparison renumbers its changes for the new draft, so a pick names nothing now.
        setPicked(new Set())
        if (result.kind === 'in-editor') {
          void draft.refetch()
          toast.success(`${what} reverted in the editor you have open`, {
            description: 'Undo it there to bring it back.',
          })
          return
        }
        toast.success(`${what} reverted in your draft`, {
          ...(changes.length === 1 && changes[0]?.excerpt !== ''
            ? { description: changes[0]?.excerpt }
            : {}),
          action: {
            label: 'Undo',
            onClick: () => {
              undoing(result.draftVersion, result.previous)
            },
          },
        })
      })
      .catch((error: unknown) => {
        toast.danger(revertRefusal(error))
      })
      .finally(() => {
        setAsking(false)
      })
  }

  return {
    busy: draft.data === undefined || asking || write.isPending || undo.isPending,
    picked,
    toggle: (id) => {
      setPicked((already) => {
        const next = new Set(already)
        if (!next.delete(id)) next.add(id)
        return next
      })
    },
    pickAll: (ids) => {
      setPicked(new Set(ids))
    },
    run,
  }
}

const CHANGE = { one: 'change', other: 'changes' }

/** What a change is called, for a control that acts on it. */
export function changeLabel(change: ComparisonChange): string {
  return `${changeName(change.change)} ${blockName(change.block)}${change.excerpt === '' ? '' : `, ${change.excerpt}`}`
}

/** Above the list: pick every change that can be reverted, and revert the ones picked. */
export function RevertBar({
  revert,
  changes,
}: {
  readonly revert: Revert
  readonly changes: readonly ComparisonChange[]
}) {
  const styles = revertStyles()
  const reasonId = useId()
  const revertible = changes.filter(({ revertible: can }) => can === true)
  // A pick from an earlier answer may name a change this one does not have.
  const chosen = revertible.filter(({ id }) => revert.picked.has(id))
  const all = revertible.length > 0 && chosen.length === revertible.length
  const reason =
    revertible.length === 0
      ? 'None of these changes can be reverted from here'
      : chosen.length === 0
        ? 'Select the changes to revert'
        : undefined
  return (
    <div className={styles.bar()}>
      <label className={styles.selectAll()}>
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-accent)]"
          checked={all}
          disabled={revertible.length === 0}
          onChange={() => {
            revert.pickAll(all ? [] : revertible.map(({ id }) => id))
          }}
        />
        Select all revertible
      </label>
      <Button
        variant="secondary"
        size="sm"
        iconStart={<RestoreIcon />}
        loading={revert.busy && chosen.length > 0}
        aria-disabled={reason !== undefined || revert.busy || undefined}
        aria-describedby={reason === undefined ? undefined : reasonId}
        title={reason}
        className={styles.button()}
        onClick={() => {
          if (reason === undefined && !revert.busy) revert.run(chosen)
        }}
      >
        {chosen.length === 0 ? 'Revert selected' : `Revert ${String(chosen.length)} selected`}
      </Button>
      {reason === undefined ? undefined : (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
    </div>
  )
}

/** A change's own pick, for reverting several at once. */
export function RevertPick({
  revert,
  change,
}: {
  readonly revert: Revert
  readonly change: ComparisonChange
}) {
  const styles = revertStyles()
  return (
    <input
      type="checkbox"
      className={styles.pick()}
      aria-label={`Select: ${changeLabel(change)}`}
      disabled={change.revertible !== true}
      checked={change.revertible === true && revert.picked.has(change.id)}
      onChange={() => {
        revert.toggle(change.id)
      }}
    />
  )
}

/** A change's own Revert, or the same button disabled with why it cannot. */
export function RevertOne({
  revert,
  change,
}: {
  readonly revert: Revert
  readonly change: ComparisonChange
}) {
  const styles = revertStyles()
  const reasonId = useId()
  const refused = change.revertible === true ? undefined : whyNot(change)
  return (
    <div className={styles.side()}>
      <Button
        variant="ghost"
        size="sm"
        className={styles.button()}
        aria-label={`Revert: ${changeLabel(change)}`}
        aria-disabled={refused !== undefined || revert.busy || undefined}
        aria-describedby={refused === undefined ? undefined : reasonId}
        title={refused?.full ?? 'Put this back as it is published'}
        onClick={() => {
          if (refused === undefined && !revert.busy) revert.run([change])
        }}
      >
        Revert
      </Button>
      {refused === undefined ? undefined : (
        <span id={reasonId} className={styles.reason()}>
          {refused.short}
          <span className="sr-only">. {refused.full}</span>
        </span>
      )}
    </div>
  )
}
