import { lift, setBlockType, wrapIn } from '@tiptap/pm/commands'
import type { Node as PMNode } from '@tiptap/pm/model'
import { liftListItem, wrapInList } from '@tiptap/pm/schema-list'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'

import { nodeType } from '../schema/node-type.ts'
import { inSequence } from './transactions.ts'

/**
 * What a block of text can be turned into.
 *
 * "Heading 2", "Bulleted list", "Quote" and the rest are one idea — the kind of
 * text block the caret is in — so they are one registry. The slash menu inserts
 * from it, the formatting toolbar's style menu switches with it, and the context
 * menu offers it again, and none of them carries its own list of what exists.
 *
 * Every style's command *sets* the style and never toggles it, so choosing what
 * is already chosen changes nothing; "Text" is the way back, out of any list or
 * quote as well as out of a heading. Each style also reports whether it is the
 * current one, which is how a menu shows a check beside it.
 */

export interface TextStyle {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly group: 'Text' | 'Lists'
  readonly keywords: readonly string[]
  /** In ProseMirror's key syntax, when the keyboard map binds one. */
  readonly key?: string
  readonly command: Command
  isActive(state: EditorState): boolean
}

const LISTS = ['bulletList', 'orderedList', 'taskList'] as const
type ListName = (typeof LISTS)[number]

const ITEM_OF: Readonly<Record<ListName, string>> = {
  bulletList: 'listItem',
  orderedList: 'listItem',
  taskList: 'taskItem',
}

/** The nearest ancestor of the selection that satisfies `matches`. */
function ancestor(state: EditorState, matches: (node: PMNode) => boolean): PMNode | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (matches(node)) return node
  }
  return null
}

function enclosingList(state: EditorState): ListName | null {
  const name = ancestor(state, (node) => (LISTS as readonly string[]).includes(node.type.name))
    ?.type.name
  return LISTS.find((list) => list === name) ?? null
}

const inQuote = (state: EditorState): boolean =>
  ancestor(state, (node) => node.type.name === 'blockquote') !== null

/**
 * One step out of whatever list or quote the selection is in, as many times as
 * there are. `liftListItem` takes a single step, and an author who asked to stop
 * making a list did not mean "one level shallower".
 */
function stepOut(state: EditorState): Transaction | null {
  const attempts = Array.from(
    { length: state.selection.$from.depth },
    () =>
      (current: EditorState): Command => {
        const list = enclosingList(current)
        if (list !== null) return liftListItem(nodeType(current.schema, ITEM_OF[list]))
        return inQuote(current) ? lift : () => false
      },
  )
  return inSequence(state, attempts)
}

/**
 * Leaves every enclosing list and quote, then runs `command`, as one
 * transaction. A heading cannot live in a list item, so turning a list item into
 * one has to leave the list first.
 */
function afterStepping(command: (state: EditorState) => Command): Command {
  return (state, dispatch) => {
    const joined = followedBy(state, stepOut(state), command)
    if (joined === null) return false
    dispatch?.(joined.scrollIntoView())
    return true
  }
}

/**
 * `first` (if it did anything) and then `command` on the document it left, as
 * one transaction. `null` when neither changed anything.
 */
function followedBy(
  state: EditorState,
  first: Transaction | null,
  command: (state: EditorState) => Command,
): Transaction | null {
  const next = inSequence(first === null ? state : state.apply(first), [command])
  if (next === null) return first
  const joined = first ?? state.tr
  for (const step of next.steps) joined.step(step)
  return joined
}

function textblockIs(name: string, attrs: Readonly<Record<string, unknown>> = {}) {
  return (state: EditorState): boolean => {
    const { parent } = state.selection.$from
    return (
      parent.type.name === name &&
      Object.entries(attrs).every(([key, value]) => parent.attrs[key] === value)
    )
  }
}

function block(
  name: string,
  attrs?: Readonly<Record<string, unknown>>,
): Pick<TextStyle, 'command' | 'isActive'> {
  return {
    isActive: textblockIs(name, attrs),
    command: afterStepping((state) => setBlockType(nodeType(state.schema, name), attrs)),
  }
}

function listStyle(name: ListName): Pick<TextStyle, 'command' | 'isActive'> {
  return {
    isActive: (state) => enclosingList(state) === name,
    command: (state, dispatch) => {
      const current = enclosingList(state)
      if (current === name) return false
      // A task list is not a bulleted one: leave the list the block is in, then make the new one.
      const joined = followedBy(state, current === null ? null : stepOut(state), (now) =>
        wrapInList(nodeType(now.schema, name)),
      )
      if (joined === null) return false
      dispatch?.(joined.scrollIntoView())
      return true
    },
  }
}

type HeadingLevel = 1 | 2 | 3 | 4

const HEADING_KIND: Readonly<Record<HeadingLevel, string>> = {
  1: 'top-level',
  2: 'section',
  3: 'subsection',
  4: 'minor',
}

function heading(level: HeadingLevel): TextStyle {
  return {
    id: `heading-${String(level)}`,
    label: `Heading ${String(level)}`,
    description: `A ${HEADING_KIND[level]} heading`,
    group: 'Text',
    keywords: ['heading', 'title', `h${String(level)}`],
    key: `Mod-Alt-${String(level)}`,
    ...block('heading', { level }),
  }
}

export const TEXT_STYLES: readonly TextStyle[] = [
  {
    id: 'paragraph',
    label: 'Text',
    description: 'Plain paragraph text',
    group: 'Text',
    keywords: ['paragraph', 'plain', 'normal', 'text'],
    key: 'Mod-Alt-0',
    ...block('paragraph'),
  },
  heading(1),
  heading(2),
  heading(3),
  heading(4),
  {
    id: 'blockquote',
    label: 'Quote',
    description: 'Set a passage apart as a quotation',
    group: 'Text',
    keywords: ['quote', 'blockquote', 'citation'],
    isActive: inQuote,
    command: (state, dispatch, view) =>
      !inQuote(state) && wrapIn(nodeType(state.schema, 'blockquote'))(state, dispatch, view),
  },
  {
    id: 'code-block',
    label: 'Code block',
    description: 'Code, with a language and syntax colour',
    group: 'Text',
    keywords: ['code', 'fence', 'snippet'],
    key: 'Mod-Alt-c',
    ...block('codeBlock'),
  },
  {
    id: 'bullet-list',
    label: 'Bulleted list',
    description: 'A list of items in no particular order',
    group: 'Lists',
    keywords: ['list', 'bullet', 'unordered', 'ul'],
    key: 'Mod-Shift-8',
    ...listStyle('bulletList'),
  },
  {
    id: 'ordered-list',
    label: 'Numbered list',
    description: 'A list of items in sequence',
    group: 'Lists',
    keywords: ['list', 'number', 'ordered', 'ol'],
    key: 'Mod-Shift-7',
    ...listStyle('orderedList'),
  },
  {
    id: 'task-list',
    label: 'Task list',
    description: 'A checklist of things to do',
    group: 'Lists',
    keywords: ['task', 'todo', 'checkbox', 'checklist', 'action'],
    key: 'Mod-Shift-9',
    ...listStyle('taskList'),
  },
]

/** The styles that are switches: pressed again, they put the text back as it was. */
const SWITCHES: ReadonlySet<string> = new Set([
  'blockquote',
  'bullet-list',
  'ordered-list',
  'task-list',
])

/**
 * A style as a button or key that turns it on and off, which is what a list or a
 * quote is in every editor: its own button is pressed to make one and pressed again
 * to be rid of it. Every other style is a choice, and stays one: a heading is
 * made another with another, and "Text" is the way back from it.
 */
export function toggleTextStyle(style: TextStyle): Command {
  if (!SWITCHES.has(style.id)) return style.command
  const text = TEXT_STYLES.find((candidate) => candidate.id === 'paragraph')
  /* v8 ignore next -- the registry above holds "Text". */
  if (text === undefined) return style.command
  return (state, dispatch, view) =>
    (style.isActive(state) ? text.command : style.command)(state, dispatch, view)
}

/** How far outside the text a style is, so the innermost one is first. */
function precedence(style: TextStyle): number {
  if (style.id === 'paragraph') return 3
  if (style.id === 'blockquote') return 2
  return style.group === 'Lists' ? 1 : 0
}

/**
 * The style the caret is in, for a menu that shows which one is current.
 *
 * A heading or code block is what the text *is*; a list or quote is what it is
 * *inside*; plain text is what is left. The first that applies in that order is
 * the answer.
 */
export function activeTextStyle(state: EditorState): TextStyle | undefined {
  return TEXT_STYLES.filter((style) => style.isActive(state)).toSorted(
    (a, b) => precedence(a) - precedence(b),
  )[0]
}
