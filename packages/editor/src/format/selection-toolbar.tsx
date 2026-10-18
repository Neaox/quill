import {
  ChevronDownIcon,
  CommentIcon,
  CopyIcon,
  SearchIcon,
  Tooltip,
  TurnIntoIcon,
  buttonClassName,
} from '@quill/ui'
import type { IconProps } from '@quill/ui'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { tv } from 'tailwind-variants'

import type { CommentRequest } from '../block/block-menu.tsx'
import type { ContextMenuEnvironment } from '../context-menu/context-menu-registry.ts'
import { anchorOf } from '../context-menu/overlay-store.ts'
import type { OverlayStore } from '../context-menu/overlay-store.ts'
import { FIND_IN_DOCUMENT, findSelectionUnavailable, openFindFrom } from '../find/find-menu.ts'
import { findStateOf } from '../find/find-plugin.ts'
import { copySectionLink, sectionLinkUnavailable } from '../link/section-link.ts'
import { CLEAR_FORMATTING, FORMAT_ACTIONS, formatUnavailable } from './format-actions.ts'
import type { FormatAction } from './format-actions.ts'
import type { SelectionWatch } from './selection-watch.ts'
import { shortcutFor } from './shortcuts.ts'
import { selectionBox } from './selection-box.ts'
import { placeToolbar, toolbarArea, toolbarRoom } from './toolbar-position.ts'
import { TURN_INTO_LABELS, currentKind } from './turn-into.ts'
import type { TurnIntoTarget } from './turn-into.ts'

/**
 * The selection toolbar (the editor audit's P1-3): formatting for the words a
 * writer has selected, floating above them.
 *
 * It appears once a selection is made — not while the mouse is still making
 * it — and goes when typing starts, on Escape, and when the document loses
 * focus. It never covers the words: above them, or below when there is no
 * room above. In a code block there is nothing to format, and in a table the
 * table's own toolbar is the one in charge, so it does not appear there.
 *
 * One `role="toolbar"`, reached from the text with Alt+F10 (or Ctrl+Shift+\):
 * the arrow keys move along it and Escape goes back to the words. Every button
 * shows whether it is on, and says its shortcut in its tooltip. A control that
 * cannot act now stays where it is, disabled with its reason
 * (`docs/design/feedback.md`, "Disable or hide"), because these are used all
 * the time.
 */

const toolbar = tv({
  slots: {
    root:
      'selection-toolbar fixed z-40 flex items-center gap-0.5 rounded-md border ' +
      'border-border-strong/70 bg-surface-raised p-1 shadow-raised ' +
      // Wider than its area — the main region beside a sidebar, or a phone's
      // screen — it scrolls sideways, quietly.
      'max-w-[min(calc(100vw-1rem),var(--selection-toolbar-room,100vw))] overflow-x-auto [scrollbar-width:none]',
    divider: 'mx-0.5 h-5 w-px shrink-0 bg-border',
    button:
      'size-8 px-0 aria-pressed:bg-accent-subtle aria-pressed:text-foreground ' +
      'aria-disabled:cursor-default aria-disabled:opacity-45 aria-expanded:bg-surface',
    turnInto: 'h-8 gap-1 px-2 text-xs aria-expanded:bg-surface',
  },
})

const styles = toolbar()

/** The toolbar's height, which its placement needs before it has been measured. */
const TOOLBAR_HEIGHT = 42

export interface SelectionToolbarProps {
  readonly editor: Editor
  readonly watch: SelectionWatch
  readonly store: OverlayStore
  readonly environment: ContextMenuEnvironment
  /** The application's comments; absent, Comment says why it cannot be used. */
  readonly onComment?: ((request: CommentRequest) => void) | undefined
  /** Given the toolbar's way of taking focus, for Alt+F10. */
  readonly focusRef: RefObject<() => boolean>
  /** Opens the link popover on the selection. */
  onLink(): void
}

interface ToolbarModel {
  readonly key: string
  readonly from: number
  readonly to: number
  readonly kind: TurnIntoTarget | undefined
  readonly active: Readonly<Record<string, boolean>>
  readonly unavailable: Readonly<Record<string, string | undefined>>
}

const COMMENTS_UNAVAILABLE = 'Comments are not available yet'

function inTableOrCode(state: EditorState): boolean {
  const { $from } = state.selection
  if ($from.parent.type.spec.code === true) return true
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth).type.spec['tableRole']
    if (role === 'cell' || role === 'header_cell') return true
  }
  return false
}

/** What the toolbar shows for the selection, or null where it does not appear. */
export function describeSelection(state: EditorState): ToolbarModel | null {
  const { selection } = state
  if (!(selection instanceof TextSelection) || selection.empty) return null
  if (inTableOrCode(state)) return null
  const actions = [...FORMAT_ACTIONS, CLEAR_FORMATTING]
  const active = Object.fromEntries(actions.map((action) => [action.id, action.active(state)]))
  const unavailable = {
    ...Object.fromEntries(actions.map((action) => [action.id, formatUnavailable(action, state)])),
    // Find is looked for within one line (ADR-051); absent in an editor without find.
    ...(findStateOf(state) === undefined ? {} : { find: findSelectionUnavailable(state) }),
  }
  const kind = currentKind(state)
  const described = { from: selection.from, to: selection.to, kind, active, unavailable }
  return { ...described, key: JSON.stringify(described) }
}

function chromeTop(element: HTMLElement): number {
  const value = getComputedStyle(element).getPropertyValue('--sticky-chrome-top')
  return Number.parseFloat(value) || 0
}

interface ToolbarButtonProps {
  readonly id: string
  readonly label: string
  readonly icon: ComponentType<IconProps>
  readonly shortcut?: string | undefined
  readonly pressed?: boolean | undefined
  readonly disabledReason?: string | undefined
  readonly first: boolean
  onPress(): void
}

function ToolbarButton({
  id,
  label,
  icon: Icon,
  shortcut,
  pressed,
  disabledReason,
  first,
  onPress,
}: ToolbarButtonProps) {
  const tip =
    disabledReason !== undefined
      ? `${label}: ${disabledReason}`
      : shortcut === undefined
        ? label
        : `${label} (${shortcut})`
  return (
    <Tooltip content={tip}>
      <button
        type="button"
        data-control={id}
        tabIndex={first ? 0 : -1}
        aria-label={label}
        aria-pressed={pressed}
        aria-disabled={disabledReason === undefined ? undefined : true}
        className={buttonClassName({ variant: 'ghost', size: 'sm', className: styles.button() })}
        onClick={() => {
          if (disabledReason === undefined) onPress()
        }}
      >
        <Icon />
      </button>
    </Tooltip>
  )
}

export function SelectionToolbar({
  editor,
  watch,
  store,
  environment,
  onComment,
  focusRef,
  onLink,
}: SelectionToolbarProps) {
  const model = useEditorState({
    editor,
    selector: ({ editor: current }) => describeSelection(current.state),
    equalityFn: (a, b) => a?.key === b?.key,
  })
  const facts = useSyncExternalStore(watch.subscribe, watch.getSnapshot)
  const overlay = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const root = useRef<HTMLDivElement | null>(null)

  // Typing over words collapses the selection, which puts the toolbar away
  // by itself; a format applied from it keeps the words selected, and it stays.
  const visible =
    model !== null &&
    facts.focused &&
    !facts.dragging &&
    !facts.dismissed &&
    overlay.kind !== 'link'

  // Places the toolbar against the words — layout the DOM owns — and keeps it
  // there while the page scrolls under it.
  useLayoutEffect(() => {
    const element = root.current
    if (!visible || element === null) return undefined
    const place = (): void => {
      const box = selectionBox(editor.view, model.from, model.to)
      const area = toolbarArea(
        editor.view.dom.closest('main')?.getBoundingClientRect(),
        document.documentElement.clientWidth || globalThis.innerWidth,
      )
      // Held to its area before it is measured, so a narrow one is scrolled, not overrun.
      element.style.setProperty('--selection-toolbar-room', `${String(toolbarRoom(area))}px`)
      const placement = placeToolbar(
        box,
        { width: element.offsetWidth, height: element.offsetHeight || TOOLBAR_HEIGHT },
        area,
        chromeTop(editor.view.dom),
      )
      element.style.top = `${String(placement.top)}px`
      element.style.left = `${String(placement.left)}px`
      element.dataset['side'] = placement.side
    }
    place()
    globalThis.addEventListener('scroll', place, { passive: true, capture: true })
    globalThis.addEventListener('resize', place, { passive: true })
    return () => {
      globalThis.removeEventListener('scroll', place, { capture: true })
      globalThis.removeEventListener('resize', place)
    }
  }, [visible, editor, model])

  // Alt+F10 lands here: on the first button, or nowhere when there is no
  // toolbar. The toolbar lives as long as the editor, so this is never undone;
  // once it is gone, there is no toolbar to land on.
  useLayoutEffect(() => {
    focusRef.current = () => {
      const element = root.current
      const first = element?.hidden === false ? element.querySelector('button') : null
      if (first === null || first === undefined) return false
      first.focus()
      return true
    }
  }, [focusRef])

  // Escape in the words puts the toolbar away until the selection moves:
  // a key ProseMirror does not use, read from the DOM it arrives at.
  useEffect(() => {
    const dom = editor.view.dom
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') watch.dismiss()
    }
    dom.addEventListener('keydown', onKeyDown)
    return () => {
      dom.removeEventListener('keydown', onKeyDown)
    }
  }, [editor, watch])

  // Mounted while there is a selection to format and hidden while it should
  // not show, so a moment of lost focus — a press on one of its own buttons —
  // never pulls the button out from under the press.
  if (model === null) return null

  const backToText = (): void => {
    editor.view.focus()
  }

  const run = (action: FormatAction): void => {
    if (action.command === undefined) {
      onLink()
      return
    }
    action.command(editor.state, editor.view.dispatch, editor.view)
    backToText()
  }

  const openTurnInto = (button: HTMLElement): void => {
    store.open({
      kind: 'context-menu',
      anchor: anchorOf(button.getBoundingClientRect()),
      presentation: 'menu',
      pos: model.from,
      only: ['turn-into'],
      label: 'Turn into',
      returnFocus: backToText,
    })
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const buttons = [...event.currentTarget.querySelectorAll('button')]
    const index = buttons.findIndex((button) => button === document.activeElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      watch.dismiss()
      backToText()
      return
    }
    const step: Readonly<Record<string, number>> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      Home: -index,
      End: buttons.length - 1 - index,
    }
    const by = step[event.key]
    if (by === undefined || index === -1) return
    event.preventDefault()
    buttons[(index + by + buttons.length) % buttons.length]?.focus()
  }

  const sectionUnavailable = sectionLinkUnavailable(editor.state, model.from, environment)
  const kindLabel = model.kind === undefined ? undefined : TURN_INTO_LABELS[model.kind]

  return createPortal(
    <div
      ref={root}
      hidden={!visible}
      role="toolbar"
      tabIndex={-1}
      aria-label="Formatting"
      aria-orientation="horizontal"
      className={styles.root()}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        // A press keeps the selection the button acts on.
        event.preventDefault()
      }}
      onFocus={() => {
        watch.setInside(true)
      }}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          watch.setInside(false)
        }
      }}
    >
      {FORMAT_ACTIONS.map((action, index) => (
        <ToolbarButton
          key={action.id}
          id={action.id}
          label={action.id === 'link' && model.active['link'] === true ? 'Edit link' : action.label}
          icon={action.icon}
          shortcut={action.shortcut === undefined ? undefined : shortcutFor(action.shortcut)}
          pressed={action.id === 'link' ? undefined : model.active[action.id] === true}
          disabledReason={model.unavailable[action.id]}
          first={index === 0}
          onPress={() => {
            run(action)
          }}
        />
      ))}
      <span aria-hidden="true" className={styles.divider()} />
      {kindLabel === undefined ? null : (
        <Tooltip content="Turn into another kind of block">
          <button
            type="button"
            data-control="turn-into"
            tabIndex={-1}
            aria-haspopup="menu"
            aria-expanded={
              overlay.kind === 'context-menu' && overlay.only?.includes('turn-into') === true
            }
            aria-label={`Turn into, now ${kindLabel}`}
            className={buttonClassName({
              variant: 'ghost',
              size: 'sm',
              className: styles.turnInto(),
            })}
            onClick={(event) => {
              openTurnInto(event.currentTarget)
            }}
          >
            <TurnIntoIcon />
            <span aria-hidden="true">{kindLabel}</span>
            <ChevronDownIcon />
          </button>
        </Tooltip>
      )}
      <ToolbarButton
        id={CLEAR_FORMATTING.id}
        label={CLEAR_FORMATTING.label}
        icon={CLEAR_FORMATTING.icon}
        shortcut={shortcutFor('clearFormatting')}
        disabledReason={model.unavailable[CLEAR_FORMATTING.id]}
        first={false}
        onPress={() => {
          run(CLEAR_FORMATTING)
        }}
      />
      {'find' in model.unavailable ? (
        <ToolbarButton
          id="find"
          label={FIND_IN_DOCUMENT}
          icon={SearchIcon}
          shortcut={shortcutFor('find')}
          disabledReason={model.unavailable['find']}
          first={false}
          onPress={() => {
            // The bar takes the keyboard, so the words are not given it back.
            openFindFrom(editor.view, false)
          }}
        />
      ) : null}
      <span aria-hidden="true" className={styles.divider()} />
      <ToolbarButton
        id="section-link"
        label="Copy link to section"
        icon={CopyIcon}
        disabledReason={sectionUnavailable}
        first={false}
        onPress={() => {
          copySectionLink(editor.state, model.from, environment)
          backToText()
        }}
      />
      <ToolbarButton
        id="comment"
        label="Comment"
        icon={CommentIcon}
        disabledReason={onComment === undefined ? COMMENTS_UNAVAILABLE : undefined}
        first={false}
        onPress={() => {
          onComment?.({
            from: model.from,
            to: model.to,
            text: editor.state.doc.textBetween(model.from, model.to, ' '),
          })
        }}
      />
    </div>,
    document.body,
  )
}
