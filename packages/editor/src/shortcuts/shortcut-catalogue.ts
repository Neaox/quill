import { DEEP_HEADING_LEVELS } from '../document/keymap.ts'
import { INLINE_MARKS } from '../format/marks.ts'
import { TEXT_STYLES } from '../format/text-styles.ts'

/**
 * The keyboard shortcuts a writer is shown (Ctrl+/).
 *
 * What the toolbar and the menus already know is read from where they know it: the marks and the
 * block styles carry their own names and keys, so a shortcut changed there changes here. What only
 * the keymap knows is written once, below. `shortcut-catalogue.test.ts` holds the list to the
 * keymap in both directions, so a key cannot be bound without a line here, or listed without a
 * binding.
 */

/** A key or chord, written as the keymap writes it (`Mod-Shift-x`), drawn for the platform. */
interface KeyShortcut {
  readonly kind: 'key'
  readonly label: string
  readonly keys: string
  /** Other keys that do the same, drawn after it. */
  readonly alternatives: readonly string[]
}

/** A character typed to open a menu: not a key binding, so it is shown as it is typed. */
interface TypedTrigger {
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

const headings = DEEP_HEADING_LEVELS.map((level) =>
  key(`Heading ${String(level)}`, `Mod-Alt-${String(level)}`),
)

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Formatting',
    shortcuts: [
      ...INLINE_MARKS.map((mark) => key(mark.label, mark.key)),
      key('Clear formatting', 'Mod-\\'),
    ],
  },
  {
    title: 'Blocks',
    shortcuts: [
      ...TEXT_STYLES.flatMap((style) =>
        style.key === undefined ? [] : [key(style.label, style.key)],
      ),
      ...headings,
      key('Line break', 'Shift-Enter'),
    ],
  },
  {
    title: 'Lists',
    shortcuts: [
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
      key('Select the word, then its next occurrence', 'Mod-d'),
    ],
  },
  {
    title: 'Moving',
    shortcuts: [
      key('Move the block up, or the table row', 'Alt-ArrowUp'),
      key('Move the block down, or the table row', 'Alt-ArrowDown'),
      key('Move the table column left', 'Alt-ArrowLeft'),
      key('Move the table column right', 'Alt-ArrowRight'),
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
    ],
  },
  {
    title: 'Find and replace',
    shortcuts: [
      key('Find', 'Mod-f'),
      key('Find and replace', 'Mod-h', 'Mod-Alt-f'),
      key('Next match', 'F3', 'Mod-g'),
      key('Previous match', 'Shift-F3', 'Mod-Shift-g'),
      key('Match case', 'Alt-c'),
      key('Match whole word', 'Alt-w'),
      key('Use regular expression', 'Alt-r'),
      key('Preserve case when replacing', 'Alt-p'),
      key('Find in selection', 'Alt-l'),
      key('Replace all', 'Mod-Alt-Enter'),
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
      key('Keyboard shortcuts', 'Mod-/'),
    ],
  },
]

/** Every key the list names, for holding it to the keymap. */
export function listedKeys(): ReadonlySet<string> {
  return new Set(
    SHORTCUT_GROUPS.flatMap((group) =>
      group.shortcuts.flatMap((shortcut) =>
        shortcut.kind === 'key' ? [shortcut.keys, ...shortcut.alternatives] : [],
      ),
    ),
  )
}
