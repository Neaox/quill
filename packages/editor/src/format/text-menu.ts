import { BoldIcon, CopyIcon, CutIcon, PasteIcon, TurnIntoIcon } from '@quill/ui'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import type {
  ClipboardItemLike,
  ClipboardReader,
  ContextMenuContribution,
  MenuAction,
  MenuEntry,
  MenuPlace,
} from '../context-menu/context-menu-registry.ts'
import {
  CLEAR_FORMATTING,
  FORMAT_ACTIONS,
  LINK_ACTION,
  formatUnavailable,
} from './format-actions.ts'
import type { FormatAction } from './format-actions.ts'
import { shortcutFor, shortcutLabel } from './shortcuts.ts'
import { TURN_INTO, TURN_INTO_ICONS, TURN_INTO_LABELS, currentKind, turnInto } from './turn-into.ts'

/**
 * The context menu over words: the clipboard, the formatting toggles, a
 * link, and "Turn into" for the block the words are in.
 *
 * Cut and copy are the browser's own commands on the selection, so what
 * lands on the clipboard is exactly what Ctrl+C would put there. Paste reads
 * the clipboard where the browser allows a page to (it asks the person the
 * first time), and goes through the editor's own paste handling, so pasted
 * Markdown, tables and pictures arrive as they do from the keyboard. "Paste as
 * plain text" inserts the words and nothing else.
 */

const NOTHING_SELECTED = 'Select something first'
const NO_CLIPBOARD = 'This browser keeps the clipboard from pages: use Ctrl+V'

/** What the clipboard holds, as the editor's paste reads it. */
export interface ClipboardContent {
  readonly html?: string
  readonly text?: string
}

/** The first thing on the clipboard the editor reads: its HTML where it has some, else its text. */
async function htmlOrText(items: readonly ClipboardItemLike[]): Promise<ClipboardContent> {
  const html = items.find((item) => item.types.includes('text/html'))
  if (html !== undefined) return { html: await (await html.getType('text/html')).text() }
  const text = items.find((item) => item.types.includes('text/plain'))
  return text === undefined ? {} : { text: await (await text.getType('text/plain')).text() }
}

/**
 * How Paste reads the clipboard: everything it holds where the browser lets
 * a page, its text where only that, and nothing — Paste disabled — where the
 * browser keeps the clipboard to itself.
 */
export function pasteSource(
  reader: ClipboardReader | undefined,
): (() => Promise<ClipboardContent>) | undefined {
  const read = reader?.read?.bind(reader)
  if (read !== undefined) return async () => htmlOrText(await read())
  const readText = reader?.readText?.bind(reader)
  return readText === undefined ? undefined : async () => ({ text: await readText() })
}

/** How "Paste as plain text" reads the clipboard: its text, or nothing where it cannot. */
export function plainSource(
  reader: ClipboardReader | undefined,
): (() => Promise<string>) | undefined {
  return reader?.readText?.bind(reader)
}

/** Pastes clipboard content through the editor's own paste handling. */
export function pasteInto(view: EditorView, { html, text }: ClipboardContent): void {
  view.focus()
  if (html !== undefined) view.pasteHTML(html)
  else if (text !== undefined) view.pasteText(text)
}

function clipboardEntries(place: MenuPlace): MenuAction[] {
  const { view, state } = place
  const empty = state.selection.empty
  const readAll = pasteSource(place.environment.clipboard)
  const readText = plainSource(place.environment.clipboard)
  const command = (name: 'cut' | 'copy'): void => {
    view.focus()
    // The browser's own command, on the editor's selection.
    document.execCommand(name)
  }
  return [
    {
      kind: 'action',
      id: 'cut',
      label: 'Cut',
      icon: CutIcon,
      shortcut: shortcutLabel('Mod-x'),
      disabledReason: empty ? NOTHING_SELECTED : undefined,
      run: () => {
        command('cut')
      },
    },
    {
      kind: 'action',
      id: 'copy',
      label: 'Copy',
      icon: CopyIcon,
      shortcut: shortcutLabel('Mod-c'),
      disabledReason: empty ? NOTHING_SELECTED : undefined,
      run: () => {
        command('copy')
      },
    },
    {
      kind: 'action',
      id: 'paste',
      label: 'Paste',
      icon: PasteIcon,
      shortcut: shortcutLabel('Mod-v'),
      disabledReason: readAll === undefined ? NO_CLIPBOARD : undefined,
      run: () => {
        void readAll?.().then((content) => {
          pasteInto(view, content)
        })
      },
    },
    {
      kind: 'action',
      id: 'paste-plain',
      label: 'Paste as plain text',
      shortcut: shortcutLabel('Mod-Shift-v'),
      disabledReason: readText === undefined ? NO_CLIPBOARD : undefined,
      run: () => {
        // Words as words: no formatting, no Markdown.
        void readText?.().then((text) => {
          view.focus()
          view.dispatch(view.state.tr.insertText(text).scrollIntoView())
        })
      },
    },
  ]
}

function formatAction(place: MenuPlace, action: FormatAction): MenuAction {
  const { view, state, editor } = place
  const label = action.id === 'link' && action.active(state) ? 'Edit link' : action.label
  return {
    kind: 'action',
    id: action.id,
    label,
    icon: action.icon,
    ...(action.shortcut === undefined ? {} : { shortcut: shortcutFor(action.shortcut) }),
    disabledReason: formatUnavailable(action, state),
    run: () => {
      if (action.command === undefined) {
        editor.editLink()
        return
      }
      action.command(view.state, view.dispatch, view)
      view.focus()
    },
  }
}

/** The formatting toggles in a submenu of their own, and the link beside it, where it is found. */
function formatEntries(place: MenuPlace): MenuEntry[] {
  const toggles = [...FORMAT_ACTIONS, CLEAR_FORMATTING].filter((action) => action !== LINK_ACTION)
  return [
    {
      kind: 'submenu',
      id: 'format',
      label: 'Format',
      icon: BoldIcon,
      entries: toggles.map((action) => formatAction(place, action)),
    },
    formatAction(place, LINK_ACTION),
  ]
}

/** "Turn into", as a submenu of every kind the block can become. */
export function turnIntoEntry(place: MenuPlace): MenuEntry[] {
  const { view, state } = place
  const kind = currentKind(state)
  if (kind === undefined) return []
  return [
    {
      kind: 'submenu',
      id: 'turn-into',
      label: 'Turn into',
      icon: TurnIntoIcon,
      entries: [
        {
          kind: 'choice',
          id: 'turn-into-kind',
          label: 'Block type',
          value: kind,
          options: TURN_INTO.map((target) => ({
            value: target,
            label: TURN_INTO_LABELS[target],
            icon: TURN_INTO_ICONS[target],
          })),
          choose: (value) => {
            const target = TURN_INTO.find((each) => each === value)
            if (target === undefined) return
            turnInto(target)(view.state, view.dispatch, view)
            view.focus()
          },
        },
      ],
    },
  ]
}

/** Whether the place is in words that can be formatted: not code, not a picture. */
function inWords(place: MenuPlace): boolean {
  const { selection } = place.state
  return (
    selection instanceof TextSelection &&
    selection.$from.parent.inlineContent &&
    selection.$from.parent.type.spec.code !== true
  )
}

export const textMenu: ContextMenuContribution = {
  id: 'text',
  order: 20,
  entries: (place) => (inWords(place) ? [...clipboardEntries(place), ...formatEntries(place)] : []),
}

/** Whether the place is in a table cell, which holds one line: no headings, lists or quotes. */
export function inTableCell(place: MenuPlace): boolean {
  const { $from } = place.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth).type.spec['tableRole']
    if (role === 'cell' || role === 'header_cell') return true
  }
  return false
}

export const turnIntoMenu: ContextMenuContribution = {
  id: 'turn-into',
  order: 30,
  entries: (place) => (inWords(place) && !inTableCell(place) ? turnIntoEntry(place) : []),
}
