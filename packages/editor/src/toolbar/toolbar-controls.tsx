import type { EditorState } from '@tiptap/pm/state'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { tv } from 'tailwind-variants'

import { actionState } from '../actions/editor-action.ts'
import type { ActionGroup, EditorAction } from '../actions/editor-action.ts'
import { describeShortcut } from '../format/marks.ts'
import { ActionMenu } from '../menu/action-menu.tsx'

/**
 * The parts a toolbar is made of.
 *
 * Every control carries `data-toolbar-item`, which is what the toolbar's arrow
 * keys move between. Their state is real attributes — `aria-pressed` for a
 * toggle, `aria-expanded` for a menu button, `disabled` — and the styling follows
 * the attribute, so what a screen reader is told and what a sighted author sees
 * are one fact (docs/architecture/styling.md).
 */

export const toolbarStyles = tv({
  slots: {
    root: [
      'formatting-toolbar fixed top-0 left-0 z-20 flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-1',
      'rounded-md border border-border-strong/70 bg-surface-raised p-1 shadow-raised',
    ],
    group: 'flex items-center gap-0.5',
    separator: 'mx-0.5 h-5 w-px shrink-0 border-0 bg-border',
    button: [
      'inline-flex h-8 min-w-8 cursor-pointer items-center justify-center gap-1 rounded-sm px-2 whitespace-nowrap',
      'text-sm text-foreground transition-colors ease-standard hover:bg-surface',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
      'disabled:pointer-events-none disabled:opacity-40',
      'aria-pressed:bg-accent-subtle aria-pressed:text-accent aria-expanded:bg-surface',
      'data-destructive:text-danger data-destructive:hover:bg-danger-subtle',
      // Underlined as well as described, so the suggestion is not carried by colour alone.
      'data-suggested:underline data-suggested:decoration-accent data-suggested:decoration-2 data-suggested:underline-offset-4',
    ],
    caret: 'text-2xs text-muted',
    swatch: 'size-2.5 rounded-full',
  },
  variants: {
    tone: {
      neutral: { swatch: 'bg-muted' },
      accent: { swatch: 'bg-accent' },
      success: { swatch: 'bg-success' },
      warning: { swatch: 'bg-warning' },
      danger: { swatch: 'bg-danger' },
    },
  },
})

const styles = toolbarStyles()

/** The name a control is read as: its label, and its key binding when it has one. */
function describeAction(action: EditorAction): string {
  return action.keys === undefined
    ? action.label
    : `${action.label} (${describeShortcut(action.keys)})`
}

export function ToolbarGroup({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div role="group" aria-label={label} className={styles.group()}>
      {children}
    </div>
  )
}

export function ToolbarSeparator() {
  return <hr aria-orientation="vertical" className={styles.separator()} />
}

export interface ToolbarButtonProps {
  readonly action: EditorAction
  readonly state: EditorState
  readonly onRun: (action: EditorAction) => void
  /** What is drawn on the button; the action's label is its accessible name. */
  readonly children: ReactNode
  /** Says why this choice is the one to pick, such as "Your organisation's default"; the button is marked and described. */
  readonly suggested?: string | undefined
}

/**
 * One action as a button. `onMouseDown` keeps the editor's selection: a button
 * that took focus on press would collapse what the author selected before the
 * click that acts on it.
 */
export function ToolbarButton({ action, state, onRun, children, suggested }: ToolbarButtonProps) {
  const { enabled, checked } = actionState(action, state)
  const suggestedId = useId()
  // A radio choice on a toolbar is a pressed button, the way a row of alignments is read.
  const toggles = action.kind === 'check' || action.kind === 'radio'
  return (
    <button
      type="button"
      data-toolbar-item=""
      className={styles.button()}
      title={
        enabled
          ? describeAction(action) + (suggested === undefined ? '' : `. ${suggested}`)
          : (action.whyUnavailable?.(state) ?? describeAction(action))
      }
      aria-describedby={suggested === undefined ? undefined : suggestedId}
      data-suggested={suggested === undefined ? undefined : ''}
      aria-label={action.label}
      aria-keyshortcuts={action.keys}
      aria-pressed={toggles ? checked : undefined}
      data-destructive={action.destructive === true ? '' : undefined}
      disabled={!enabled}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onClick={() => {
        onRun(action)
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

export interface ToolbarMenuButtonProps {
  /** Names the menu it opens; the button itself is named by what it shows. */
  readonly label: string
  readonly groups: readonly ActionGroup[]
  readonly state: EditorState
  readonly onRun: (action: EditorAction) => void
  /** What is drawn on the button, beside the caret that says it opens a menu. */
  readonly children: ReactNode
  /** A button that is only an icon is named by the menu's label, and has no caret to say it is a menu. */
  readonly iconOnly?: boolean
  /** The button's name, when what it shows would be taken for another control's: a menu showing a choice. */
  readonly accessibleName?: string
}

/** A button that opens a menu of actions beneath it. */
export function ToolbarMenuButton({
  label,
  groups,
  state,
  onRun,
  children,
  iconOnly = false,
  accessibleName,
}: ToolbarMenuButtonProps) {
  // The button the menu hangs from, kept while the menu is open: its position is
  // where the menu goes, and it is where focus returns to on Escape.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const menuId = useId()

  return (
    <>
      <button
        type="button"
        data-toolbar-item=""
        className={styles.button()}
        aria-haspopup="menu"
        aria-label={accessibleName ?? (iconOnly ? label : undefined)}
        aria-expanded={anchor !== null}
        aria-controls={anchor === null ? undefined : menuId}
        onMouseDown={(event) => {
          event.preventDefault()
        }}
        onClick={(event) => {
          const button = event.currentTarget
          setAnchor((current) => (current === null ? button : null))
        }}
      >
        {children}
        {iconOnly ? null : (
          <span aria-hidden="true" className={styles.caret()}>
            ▾
          </span>
        )}
      </button>
      {anchor === null ? null : (
        <ActionMenu
          label={`${label} options`}
          groups={groups}
          state={state}
          locate={() => anchor.getBoundingClientRect()}
          trigger={anchor}
          onChoose={onRun}
          // Escape returns to the button that opened the menu; a choice returns to
          // the document (`onRun` does that), and a click elsewhere keeps its own focus.
          onClose={(reason) => {
            setAnchor(null)
            if (reason === 'escape') anchor.focus()
          }}
        />
      )}
    </>
  )
}

/** A colour dot for a variant, drawn from the action's tone. */
export function ToneSwatch({ tone }: { readonly tone: NonNullable<EditorAction['tone']> }) {
  return <span aria-hidden="true" className={toolbarStyles({ tone }).swatch()} />
}
