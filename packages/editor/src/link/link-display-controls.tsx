import { buttonClassName } from '@quill/ui'
import type { EditorState } from '@tiptap/pm/state'
import { useId } from 'react'
import type { ReactNode } from 'react'
import { tv } from 'tailwind-variants'

import {
  CARD_IMAGE,
  CARD_LAYOUT_CHOICES,
  LINK_DISPLAY_GROUP,
  linkActionState,
  linkActionUnavailable,
} from './link-display-actions.ts'
import type { LinkAction } from './link-display-actions.ts'

/**
 * The pressable rows of link choices (ADR-042, "Authoring surface"): how a
 * link is shown — Link, Inline, Compact, Card, Embed — and, for a card, its
 * layout, its picture and its own words. The link card under a link and the
 * offer after a pasted address draw these; the link popover offers the same
 * choices as a radio group, for the keyboard.
 *
 * A choice that cannot be used here stays in its place, disabled with its
 * reason (`docs/design/feedback.md`, "Disable or hide"): a card in a heading,
 * an embed of a page no allowlisted site serves.
 */

const controls = tv({
  slots: {
    group: 'flex flex-wrap items-center gap-0.5',
    button: [
      'h-7 px-2 text-xs whitespace-nowrap aria-pressed:bg-accent-subtle aria-pressed:text-accent',
      'aria-disabled:cursor-default aria-disabled:opacity-45',
      // Underlined as well as described, so the suggestion is not carried by colour alone.
      'data-suggested:underline data-suggested:decoration-accent data-suggested:decoration-2 data-suggested:underline-offset-4',
    ],
  },
})
const styles = controls()

export interface LinkChoiceButtonProps {
  readonly action: LinkAction
  /** The state the action is read against: the link, with the selection in it. */
  readonly state: EditorState
  onRun(action: LinkAction): void
  /** Whether Tab reaches it; the link card is for the pointer and the eye, so its buttons are not. */
  readonly tabbable?: boolean | undefined
  /** Says why this choice is the one to pick, such as "Your organisation's default". */
  readonly suggested?: string | undefined
  readonly children: ReactNode
}

/** One choice, pressed when it is the one in force. A press never takes the caret out of the words. */
export function LinkChoiceButton({
  action,
  state,
  onRun,
  tabbable = true,
  suggested,
  children,
}: LinkChoiceButtonProps) {
  const { checked } = linkActionState(action, state)
  const unavailable = linkActionUnavailable(action, state)
  const suggestedId = useId()
  const toggles = action.kind === 'radio' || action.kind === 'check'
  return (
    <button
      type="button"
      tabIndex={tabbable ? undefined : -1}
      aria-label={action.label}
      aria-pressed={toggles ? checked : undefined}
      aria-disabled={unavailable === undefined ? undefined : true}
      aria-describedby={suggested === undefined ? undefined : suggestedId}
      data-suggested={suggested === undefined ? undefined : ''}
      title={
        unavailable ??
        (suggested === undefined
          ? action.description
          : `${action.description ?? action.label}. ${suggested}`)
      }
      className={buttonClassName({ variant: 'ghost', size: 'sm', className: styles.button() })}
      onMouseDown={(event) => {
        // A press keeps the selection the choice acts on.
        event.preventDefault()
      }}
      onClick={() => {
        if (unavailable === undefined) onRun(action)
      }}
    >
      {children}
      {suggested === undefined ? null : (
        <span id={suggestedId} className="sr-only">
          {suggested}
        </span>
      )}
    </button>
  )
}

export interface LinkDisplayButtonsProps {
  readonly state: EditorState
  onRun(action: LinkAction): void
  readonly tabbable?: boolean | undefined
  /** The display to point at as the one to pick: the organisation's default. */
  readonly suggest?: string | undefined
}

/** "Show as": every way the link can be shown, the one in force pressed. */
export function LinkDisplayButtons({ state, onRun, tabbable, suggest }: LinkDisplayButtonsProps) {
  return (
    <div role="group" aria-label="Show link as" className={styles.group()}>
      {LINK_DISPLAY_GROUP.actions.map((action) => (
        <LinkChoiceButton
          key={action.id}
          action={action}
          state={state}
          onRun={onRun}
          tabbable={tabbable}
          suggested={
            suggest !== undefined && action.id === `link-show-${suggest}`
              ? 'Your organisation’s default'
              : undefined
          }
        >
          {action.label}
        </LinkChoiceButton>
      ))}
    </div>
  )
}

export interface CardChoiceButtonsProps {
  readonly state: EditorState
  onRun(action: LinkAction): void
  /** Opens the card's own title and description. */
  readonly details: LinkAction
  readonly tabbable?: boolean | undefined
}

/** What a card is made of: its picture beside or above the words, whether it has one, its own words. */
export function CardChoiceButtons({ state, onRun, details, tabbable }: CardChoiceButtonsProps) {
  return (
    <div role="group" aria-label="Card" className={styles.group()}>
      {CARD_LAYOUT_CHOICES.map(({ action, shortWord }) => (
        <LinkChoiceButton
          key={action.id}
          action={action}
          state={state}
          onRun={onRun}
          tabbable={tabbable}
        >
          {shortWord}
        </LinkChoiceButton>
      ))}
      <LinkChoiceButton action={CARD_IMAGE} state={state} onRun={onRun} tabbable={tabbable}>
        {CARD_IMAGE.label}
      </LinkChoiceButton>
      <LinkChoiceButton action={details} state={state} onRun={onRun} tabbable={tabbable}>
        Details
      </LinkChoiceButton>
    </div>
  )
}
