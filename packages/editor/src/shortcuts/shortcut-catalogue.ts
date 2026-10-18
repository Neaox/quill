import { SHORTCUTS } from '../format/shortcuts.ts'
import { TABLE_ACTIONS } from '../table/table-actions.ts'

/**
 * The keyboard shortcuts a writer is shown (Ctrl+/).
 *
 * What the menus and toolbars already name is read from where they name it: the
 * shared bindings (`format/shortcuts.ts`) and the table's actions, which carry
 * their own words and keys, so a key changed there changes here. What only the
 * keymap knows is written once, below. `shortcut-catalogue.test.ts` holds the
 * list to every keymap the editor runs in both directions, so a key cannot be
 * bound without a line here, or listed without a binding.
 */

/** A key or chord, written as the keymap writes it (`Mod-Shift-x`), drawn for the platform. */
export interface KeyShortcut {
  readonly kind: 'key'
  readonly label: string
  readonly keys: string
  /** Other keys that do the same, drawn after it. */
  readonly alternatives: readonly string[]
}

/** A character typed to open a menu: not a key binding, so it is shown as it is typed. */
export interface TypedTrigger {
  readonly kind: 'typed'
  readonly label: string
  readonly text: string
}

export type Shortcut = KeyShortcut | TypedTrigger

export interface ShortcutGroup {
  readonly title: string
  readonly shortcuts: readonly Shortcut[]
}

const key = (label: string, keys: string, ...alternatives: readonly string[]): KeyShortcut => ({
  kind: 'key',
  label,
  keys,
  alternatives,
})
const typed = (label: string, text: string): TypedTrigger => ({ kind: 'typed', label, text })

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const

/** The table's own bound actions, by their toolbar names: inserting, moving and deleting lines. */
const tableActions = TABLE_ACTIONS.flatMap((action) =>
  action.key === undefined ? [] : [key(action.label, action.key)],
)

/**
 * The keys of the find bar's own fields (`find/find-keys.ts`), which reads them
 * from the event rather than a keymap; the test holds each to it.
 */
export const FIND_BAR_SHORTCUTS: readonly KeyShortcut[] = [
  key('Match case', 'Alt-c'),
  key('Match whole word', 'Alt-w'),
  key('Use regular expression', 'Alt-r'),
  key('Preserve case when replacing', 'Alt-p'),
  key('Find in selection', 'Alt-l'),
  key('Replace all', 'Mod-Alt-Enter'),
]

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Formatting',
    shortcuts: [
      key('Bold', SHORTCUTS.bold),
      key('Italic', SHORTCUTS.italic),
      key('Strikethrough', SHORTCUTS.strike),
      key('Inline code', SHORTCUTS.code),
      key('Link', SHORTCUTS.link),
      key('Clear formatting', SHORTCUTS.clearFormatting),
    ],
  },
  {
    title: 'Blocks',
    shortcuts: [
      key('Paragraph', 'Mod-Alt-0'),
      ...HEADING_LEVELS.map((level) => key(`Heading ${String(level)}`, `Mod-Alt-${String(level)}`)),
      key('Code block', 'Mod-Alt-c'),
      key('Line break', 'Shift-Enter'),
    ],
  },
  {
    title: 'Lists',
    shortcuts: [
      key('Bulleted list', 'Mod-Shift-8'),
      key('Numbered list', 'Mod-Shift-7'),
      key('Task list', 'Mod-Shift-9'),
      key('New item', 'Enter'),
      key('Indent an item', 'Tab'),
      key('Outdent an item', 'Shift-Tab'),
      key('Check or uncheck a task', 'Mod-Enter'),
    ],
  },
  {
    title: 'Selecting',
    shortcuts: [
      key('Select the block, then what is around it, then everything', 'Mod-a'),
      key('Select the word, then its next occurrence', SHORTCUTS.selectNextOccurrence),
    ],
  },
  {
    title: 'Moving',
    shortcuts: [
      key(
        'Move the paragraph or list item up within what holds it, or the table row',
        'Alt-ArrowUp',
      ),
      key(
        'Move the paragraph or list item down within what holds it, or the table row',
        'Alt-ArrowDown',
      ),
      key('Move the whole top-level block up', SHORTCUTS.moveUp),
      key('Move the whole top-level block down', SHORTCUTS.moveDown),
    ],
  },
  {
    title: 'Tables',
    shortcuts: [
      key('Next cell, and a new row from the last', 'Tab'),
      key('Previous cell', 'Shift-Tab'),
      key('The cell below, and a new row from the last', 'Enter'),
      key('The cell above', 'Alt-Shift-ArrowUp'),
      key('The cell below', 'Alt-Shift-ArrowDown'),
      key('The cell to the left', 'Alt-Shift-ArrowLeft'),
      key('The cell to the right', 'Alt-Shift-ArrowRight'),
      ...tableActions,
    ],
  },
  {
    title: 'Find and replace',
    shortcuts: [
      key('Find', SHORTCUTS.find),
      key('Find and replace', SHORTCUTS.replace, SHORTCUTS.replaceAlternative),
      key('Next match', SHORTCUTS.findNext, SHORTCUTS.findNextAlternative),
      key('Previous match', SHORTCUTS.findPrevious, SHORTCUTS.findPreviousAlternative),
      ...FIND_BAR_SHORTCUTS,
    ],
  },
  {
    title: 'Menus and toolbars',
    shortcuts: [
      key('Open the context menu', SHORTCUTS.contextMenu, SHORTCUTS.contextMenuKey),
      key('Move to the formatting toolbar', SHORTCUTS.toolbar, SHORTCUTS.toolbarAlternative),
    ],
  },
  {
    title: 'Inserting',
    shortcuts: [typed('Insert a block', '/'), typed('Insert an emoji', ':')],
  },
  {
    title: 'Editing',
    shortcuts: [
      key('Undo', 'Mod-z'),
      key('Redo', 'Mod-Shift-z', 'Mod-y'),
      key('Keyboard shortcuts', SHORTCUTS.shortcuts),
    ],
  },
]

/** Every key the list names, for holding it to the keymaps. */
export function listedKeys(
  groups: readonly ShortcutGroup[] = SHORTCUT_GROUPS,
): ReadonlySet<string> {
  return new Set(
    groups.flatMap((group) =>
      group.shortcuts.flatMap((shortcut) =>
        shortcut.kind === 'key' ? [shortcut.keys, ...shortcut.alternatives] : [],
      ),
    ),
  )
}
