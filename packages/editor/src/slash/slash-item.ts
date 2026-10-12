import type { CustomEmoji } from '@quill/markdown'
import type { IconProps } from '@quill/ui'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'
import type { ComponentType } from 'react'

/**
 * What the slash menu offers, as data.
 *
 * An item is a name, the words it is found by, an icon and a hint, and one
 * thing to do: a ProseMirror command over the state the menu leaves behind
 * once the typed `/query` is gone. The menu runs it in the same transaction
 * that removes the query, so one undo takes the block away and gives the
 * query back (`slash-run.ts`). Items that need something the editor cannot
 * invent — an address, a document, a tone — open a picker or raise a request
 * instead of guessing.
 */

/** The menu's groups, in the order it shows them. A contribution may add its own after these. */
export const SLASH_GROUPS = [
  'Text',
  'Blocks',
  'Media and diagrams',
  'Code',
  'Data',
  'References',
  'Templates',
] as const

export type SlashGroup = (typeof SLASH_GROUPS)[number]

/** Something only the application can supply, such as an upload. */
export type SlashRequest = { readonly kind: 'image' } | { readonly kind: 'drawing' }

/** A document a link can point at; links are by id (AGENTS.md rule 8). */
export interface DocumentLinkTarget {
  readonly id: string
  readonly title: string
  /** Where it lives, as the reader would say it: `Engineering / Runbooks`. */
  readonly context?: string
}

/**
 * What the application tells the menu about the organisation, read once when
 * the editor is built. Everything is optional: an item whose input is missing
 * is simply not offered.
 */
export interface SlashEnvironment {
  /** The organisation's label names (ADR-037). */
  readonly labels?: readonly string[]
  /** The organisation's own emoji (ADR-038). */
  readonly customEmoji?: ReadonlyMap<string, CustomEmoji>
  /** Finds documents to link to; the application owns the request. */
  searchDocuments?(query: string, signal: AbortSignal): Promise<readonly DocumentLinkTarget[]>
}

/** Where the caret is, for an item deciding whether it can be inserted there. */
export interface SlashPlace {
  readonly state: EditorState
  /** In a table cell, which GFM limits to one line of inline content. */
  readonly inTableCell: boolean
}

/** One choice in a picker. */
export interface SlashPickerOption {
  readonly id: string
  readonly label: string
  readonly description?: string
  /** Other words the option is found by. */
  readonly keywords?: readonly string[]
  /** Other names for it, an exact one of which ranks it first: `ts` for TypeScript. */
  readonly aliases?: readonly string[]
  /** A character drawn before the label, such as the emoji itself. */
  readonly glyph?: string
  /** An image drawn before the label, such as a custom emoji's. */
  readonly image?: string
}

/**
 * Where a picker's options come from: a list it filters as the author types,
 * or a search that answers later, such as the application's document search.
 */
export type SlashPickerSource =
  | { readonly kind: 'list'; options(query: string): readonly SlashPickerOption[] }
  | {
      readonly kind: 'search'
      search(query: string, signal: AbortSignal): Promise<readonly SlashPickerOption[]>
    }

/**
 * A second step inside the menu: the item is chosen, and now something about
 * it is — a language, a tone, a document. Cancelling it inserts nothing.
 */
export interface SlashPicker {
  /** What the list is of, read out as the picker's name: "Code block language". */
  readonly title: string
  readonly placeholder: string
  /** Said when nothing matches, given what was typed. */
  empty(query: string): string
  readonly source: SlashPickerSource
  /** The command the chosen option runs, at the caret the item was chosen at. */
  choose(option: SlashPickerOption): Command
}

export interface SlashRunContext {
  /** The state with the `/query` already removed. */
  readonly state: EditorState
  /** Adds the item's change to the one undoable transaction. Call it at most once. */
  dispatch(transaction: Transaction): void
  request(request: SlashRequest): void
  pick(picker: SlashPicker): void
}

export interface SlashItem {
  /** Unique and stable: recently used items are remembered by it. */
  readonly id: string
  readonly label: string
  /** One line, saying what the block is for. */
  readonly description: string
  readonly group: SlashGroup | (string & {})
  /** Words the item is found by that are not in its label. */
  readonly keywords: readonly string[]
  /** Other names for the same thing, the way a writer from elsewhere would say it: `h2`, `ul`, `hr`. */
  readonly aliases?: readonly string[]
  /**
   * What stands before the label: an icon for a block; for an emoji, its
   * character or its picture, which says what it is without one.
   */
  readonly icon?: ComponentType<IconProps>
  readonly glyph?: string
  readonly image?: string
  /** The Markdown autoformat that makes the same block, shown beside it: `##`, `-`, `[]`. */
  readonly shortcut?: string
  /**
   * `inline` items put something in a line of text and are offered in a table
   * cell; everything else makes a block and is not.
   */
  readonly inline?: boolean
  /** Whether the item can be used where the caret is. Absent, it always can. */
  available?(place: SlashPlace): boolean
  run(context: SlashRunContext): void
}

/** A set of items from one module, built from what the application knows. */
export interface SlashContribution {
  readonly id: string
  items(environment: SlashEnvironment): readonly SlashItem[]
}

/** The fields every item has but the two that make it act. */
export type SlashItemMeta = Omit<SlashItem, 'run' | 'available'>

/**
 * An item that is one command: available wherever the command would apply,
 * which a ProseMirror command answers when it is run without a dispatch.
 */
export function commandItem(meta: SlashItemMeta, command: Command): SlashItem {
  return {
    ...meta,
    available: (place) => command(place.state),
    run: ({ state, dispatch }) => {
      command(state, dispatch)
    },
  }
}

/**
 * An item whose second step is a picker, offered where `available` says the
 * picker's eventual command could apply.
 */
export function pickerItem(
  meta: SlashItemMeta,
  picker: SlashPicker,
  available: (place: SlashPlace) => boolean,
): SlashItem {
  return {
    ...meta,
    available,
    run: ({ pick }) => {
      pick(picker)
    },
  }
}
