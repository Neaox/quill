import { Button, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, CloseIcon, tv } from '@quill/ui'
import type { Command } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useEffect, useEffectEvent, useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import { describeShortcut } from '../format/marks.ts'
import {
  closeFind,
  editFind,
  findNext,
  findPrevious,
  replaceAll,
  replaceCurrent,
  showFind,
} from './find-commands.ts'
import { barCommandFor } from './find-keys.ts'
import type { FindBarCommand } from './find-keys.ts'
import { findStateOf } from './find-plugin.ts'
import type { FindSettings, FindState } from './find-state.ts'
import { matchSummary } from './find-summary.ts'
import { revealPosition } from './reveal.ts'

/**
 * The find and replace bar (Ctrl+F, Ctrl+H), laid out as VS Code's is: the query with its three
 * toggles inside the field, how many were found and which one is current, the step and close
 * buttons, and below it, when asked for, the replacement with its own toggle and its two buttons.
 *
 * It is a view of the plugin's state and nothing more: every field is controlled by it and every
 * button runs one of its commands, so what the bar shows cannot drift from what the document does.
 * It floats at the top of the editor, below the application's header, and stays there as the page
 * scrolls.
 */

const styles = tv({
  slots: {
    // Hangs below the application's fixed header (`--sticky-chrome-top`), not at the top of the viewport it would slide under.
    root: 'sticky top-[calc(var(--sticky-chrome-top)+var(--spacing)*3)] z-20 h-0',
    panel: [
      'absolute top-0 right-2 flex w-[min(28rem,calc(100%-1rem))] flex-col gap-1 rounded-lg border',
      'border-border bg-surface-raised p-1.5 shadow-overlay',
    ],
    row: 'flex items-center gap-1',
    // Lines up the replace row's field under the find row's, past the chevron.
    gutter: 'size-7 shrink-0',
    field: [
      'flex min-w-0 grow items-center gap-0.5 rounded-md border border-border bg-background pe-0.5',
      'focus-within:outline-2 focus-within:outline-focus-ring',
      'has-[input[aria-invalid=true]]:border-danger',
    ],
    input: [
      'min-w-0 grow bg-transparent px-2 py-1 text-xs text-foreground outline-hidden',
      'placeholder:text-muted/75',
    ],
    // As wide as what it says, so the field takes the room; a long reason is cut short, and whole in its title.
    summary: 'max-w-40 shrink-0 truncate px-1 text-2xs text-muted tabular-nums',
    // A button that is a switch says so by `aria-pressed`, and the colour follows the attribute.
    toggle: 'aria-pressed:bg-selection aria-pressed:text-foreground',
    glyph: 'font-mono text-2xs leading-none',
  },
})

/** The options each toggle command switches. */
const OPTION_OF = {
  'toggle-case': 'caseSensitive',
  'toggle-word': 'wholeWord',
  'toggle-regex': 'regex',
  'toggle-preserve-case': 'preserveCase',
  'toggle-selection': 'inSelection',
} as const satisfies Partial<Record<FindBarCommand, keyof FindSettings>>

interface ToggleProps {
  readonly label: string
  /** The key that toggles it, in the keymap's notation. */
  readonly keys: string
  readonly pressed: boolean
  onPress(): void
  readonly children: ReactNode
}

function Toggle({ label, keys, pressed, onPress, children }: ToggleProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={styles().toggle()}
      aria-pressed={pressed}
      aria-label={label}
      title={`${label} (${describeShortcut(keys)})`}
      onClick={onPress}
    >
      {children}
    </Button>
  )
}

export interface FindBarProps {
  readonly editor: Editor | null
}

export function FindBar({ editor }: FindBarProps) {
  const find = useEditorState({
    editor,
    selector: ({ editor: current }) => (current === null ? undefined : findStateOf(current.state)),
  })
  if (editor === null || find === null || find === undefined || !find.open) return null
  return <OpenFindBar key={find.asked} editor={editor} find={find} />
}

interface OpenFindBarProps {
  readonly editor: Editor
  readonly find: FindState
}

function OpenFindBar({ editor, find }: OpenFindBarProps) {
  const classes = styles()
  const summaryId = useId()
  const replaceRowId = useId()
  const findInput = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const { settings } = find
  const invalid = find.pattern.kind === 'invalid'
  const nothing = find.found.matches.length === 0

  // The bar takes the keyboard when it opens, and when it is asked for again (it is then a new
  // bar: `FindBar` keys it by how often it was asked): in the field the state names, with its text
  // selected to type over.
  const takeFocus = useEffectEvent(() => {
    const field = find.focus === 'replace' ? replaceInput.current : findInput.current
    field?.focus()
    field?.select()
  })
  // Synchronises with the document's focus, an external system, as the bar appears.
  useEffect(() => {
    takeFocus()
  }, [])

  const perform = (command: Command) => {
    command(editor.state, editor.view.dispatch, editor.view)
  }
  // Steps, and shows where it got to: with the keyboard here the editor will not scroll to it itself.
  const step = (command: Command) => {
    perform(command)
    // The bar is mounted whenever it can be used, so its box is there to measure.
    /* v8 ignore next 6 */
    revealPosition(
      editor.view,
      editor.state.selection.from,
      panel.current?.getBoundingClientRect().bottom ?? 0,
      window.innerHeight,
    )
  }
  const close = () => {
    perform(closeFind)
    editor.commands.focus()
  }
  const toggleOption = (option: keyof FindSettings) => {
    perform(editFind({ options: { [option]: !settings[option] } }))
  }

  const execute = (command: FindBarCommand) => {
    switch (command) {
      case 'next':
        return step(findNext)
      case 'previous':
        return step(findPrevious)
      case 'replace':
        return step(replaceCurrent)
      case 'replace-all':
        return perform(replaceAll)
      case 'close':
        return close()
      case 'show-find':
        return perform(showFind('find'))
      case 'show-replace':
        return perform(showFind('replace'))
      default:
        return toggleOption(OPTION_OF[command])
    }
  }

  // One handler for the whole bar, so the keys that work in its fields work from its buttons too.
  // Enter is the exception: on a button it is that button's, not a step through the matches.
  const onKeyDown = (event: KeyboardEvent) => {
    const field =
      event.target === replaceInput.current
        ? 'replace'
        : event.target === findInput.current
          ? 'find'
          : undefined
    if (field === undefined && event.key === 'Enter') return
    const command = barCommandFor(event, field ?? 'find')
    if (command === undefined) return
    event.preventDefault()
    execute(command)
  }

  return (
    <div className={classes.root()}>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keys bubble up from the fields and buttons inside, which are the interactive elements; the landmark only collects them. */}
      <div
        role="search"
        aria-label="Find and replace"
        ref={panel}
        className={classes.panel()}
        onKeyDown={onKeyDown}
      >
        <div className={classes.row()}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 shrink-0 px-0"
            aria-label="Toggle replace"
            aria-expanded={find.replacing}
            aria-controls={replaceRowId}
            onClick={() => {
              perform(editFind({ replacing: !find.replacing }))
            }}
          >
            {find.replacing ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </Button>
          <div className={classes.field()}>
            <input
              ref={findInput}
              type="text"
              aria-label="Find"
              aria-invalid={invalid}
              aria-describedby={summaryId}
              placeholder="Find"
              spellCheck={false}
              autoComplete="off"
              className={classes.input()}
              value={find.query}
              onChange={(event) => {
                perform(editFind({ query: event.target.value }))
              }}
            />
            <Toggle
              label="Match case"
              keys="Alt-c"
              pressed={settings.caseSensitive}
              onPress={() => {
                toggleOption('caseSensitive')
              }}
            >
              <span className={classes.glyph()}>Aa</span>
            </Toggle>
            <Toggle
              label="Match whole word"
              keys="Alt-w"
              pressed={settings.wholeWord}
              onPress={() => {
                toggleOption('wholeWord')
              }}
            >
              <span className={classes.glyph()}>ab</span>
            </Toggle>
            <Toggle
              label="Use regular expression"
              keys="Alt-r"
              pressed={settings.regex}
              onPress={() => {
                toggleOption('regex')
              }}
            >
              <span className={classes.glyph()}>.*</span>
            </Toggle>
          </div>
          <span
            id={summaryId}
            role="status"
            className={classes.summary()}
            title={matchSummary(find)}
          >
            {matchSummary(find)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 shrink-0 px-0"
            aria-label="Previous match"
            title={`Previous match (${describeShortcut('Shift-Enter')})`}
            disabled={nothing}
            onClick={() => {
              step(findPrevious)
            }}
          >
            <ChevronUpIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 shrink-0 px-0"
            aria-label="Next match"
            title={`Next match (${describeShortcut('Enter')})`}
            disabled={nothing}
            onClick={() => {
              step(findNext)
            }}
          >
            <ChevronDownIcon />
          </Button>
          <Toggle
            label="Find in selection"
            keys="Alt-l"
            pressed={settings.inSelection}
            onPress={() => {
              toggleOption('inSelection')
            }}
          >
            <span className={classes.glyph()}>⬚</span>
          </Toggle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 shrink-0 px-0"
            aria-label="Close"
            title={`Close (${describeShortcut('Escape')})`}
            onClick={close}
          >
            <CloseIcon />
          </Button>
        </div>
        {find.replacing ? (
          <div id={replaceRowId} className={classes.row()}>
            <span className={classes.gutter()} aria-hidden="true" />
            <div className={classes.field()}>
              <input
                ref={replaceInput}
                type="text"
                aria-label="Replace"
                placeholder="Replace"
                spellCheck={false}
                autoComplete="off"
                className={classes.input()}
                value={find.replacement}
                onChange={(event) => {
                  perform(editFind({ replacement: event.target.value }))
                }}
              />
              <Toggle
                label="Preserve case"
                keys="Alt-p"
                pressed={settings.preserveCase}
                onPress={() => {
                  toggleOption('preserveCase')
                }}
              >
                <span className={classes.glyph()}>AB</span>
              </Toggle>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={nothing}
              title={`Replace (${describeShortcut('Enter')})`}
              onClick={() => {
                step(replaceCurrent)
              }}
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={nothing}
              title={`Replace all (${describeShortcut('Mod-Alt-Enter')})`}
              onClick={() => {
                perform(replaceAll)
              }}
            >
              Replace all
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
