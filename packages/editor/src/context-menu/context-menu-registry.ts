import type { IconProps } from '@quill/ui'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { ComponentType } from 'react'

/**
 * The writing surface's context menu, as a registry (docs/architecture/patterns.md,
 * "Registry"), the same shape as the slash menu's (`slash/slash-registry.ts`).
 *
 * What the menu offers depends on what is under the pointer or the caret —
 * words, a link, a table cell, a picture, a code block, a callout — and each
 * of those is a feature's business, so each feature contributes the entries
 * it owns, and the menu is assembled from whichever contributions have
 * something to say about the place. Adding to the menu is adding a
 * contribution, never editing the menu.
 */

export interface MenuAction {
  readonly kind: 'action'
  readonly id: string
  readonly label: string
  readonly icon?: ComponentType<IconProps>
  /** The shortcut that does the same, as a person reads it. */
  readonly shortcut?: string
  /** Why it cannot be used here and now; absent when it can (`docs/design/feedback.md`). */
  readonly disabledReason?: string | undefined
  readonly tone?: 'danger'
  /** A setting that is on or off, shown with a check. */
  readonly checked?: boolean
  run(): void
}

export interface MenuChoice {
  readonly kind: 'choice'
  readonly id: string
  readonly label: string
  readonly value: string
  readonly options: readonly {
    readonly value: string
    readonly label: string
    readonly icon?: ComponentType<IconProps>
    readonly disabledReason?: string | undefined
  }[]
  choose(value: string): void
}

export interface MenuSubmenu {
  readonly kind: 'submenu'
  readonly id: string
  readonly label: string
  readonly icon?: ComponentType<IconProps>
  readonly entries: readonly (MenuAction | MenuChoice)[]
}

export type MenuEntry = MenuAction | MenuChoice | MenuSubmenu

/**
 * What the application lets the menu do that the editor cannot do alone.
 * Everything is optional: an entry whose capability is missing says so.
 */
export interface ContextMenuEnvironment {
  /** Opens a link the way the application opens links (a new tab, or the router for `/d/<id>`). */
  openLink?(href: string): void
  /** The address of this document at a fragment, for "Copy link to section". */
  linkTo?(fragment: string): string | undefined
  /** Puts text on the clipboard. */
  copyText?(text: string): Promise<void>
  /** What the browser lets a page read of the clipboard, for Paste. */
  readonly clipboard?: ClipboardReader | undefined
  /** Asks for something only the application can supply: a picture to replace one with. */
  requestImage?(): void
}

/** The part of the browser's Clipboard API a paste reads, each method only where the browser has it. */
export interface ClipboardReader {
  read?(): Promise<readonly ClipboardItemLike[]>
  readText?(): Promise<string>
}

export interface ClipboardItemLike {
  readonly types: readonly string[]
  getType(type: string): Promise<Blob>
}

/** The place the menu was opened at, and what can be done there. */
export interface MenuPlace {
  readonly view: EditorView
  readonly state: EditorState
  /** The document position under the pointer or at the caret. */
  readonly pos: number
  readonly environment: ContextMenuEnvironment
  /** Hands the editor's features something to show: the link popover, say. */
  readonly editor: MenuEditorBridge
}

/** The editor's own surfaces a menu entry can open. */
export interface MenuEditorBridge {
  /** Opens the link popover on the selection. */
  editLink(): void
  /** Opens the alternative text field for the image at `pos`. */
  editAltText(pos: number): void
}

export interface ContextMenuSection {
  readonly id: string
  readonly label?: string
  readonly entries: readonly MenuEntry[]
}

/** A feature's part of the menu: nothing, where it has nothing to say about the place. */
export interface ContextMenuContribution {
  readonly id: string
  /** Where its section goes: lower first. */
  readonly order: number
  /** A heading for its section, where the entries need one. */
  readonly label?: string
  entries(place: MenuPlace): readonly MenuEntry[]
}

export interface ContextMenuRegistry {
  readonly contributions: readonly ContextMenuContribution[]
  /** The sections for a place, in order; `only` limits them to some contributions. */
  sectionsFor(place: MenuPlace, only?: readonly string[]): readonly ContextMenuSection[]
}

export function createContextMenuRegistry(
  contributions: readonly ContextMenuContribution[],
): ContextMenuRegistry {
  const ids = new Set<string>()
  for (const contribution of contributions) {
    if (ids.has(contribution.id)) {
      throw new Error(`Two context menu contributions are called "${contribution.id}".`)
    }
    ids.add(contribution.id)
  }
  const ordered = contributions.toSorted((a, b) => a.order - b.order)
  return {
    contributions: ordered,
    sectionsFor: (place, only) =>
      ordered
        .filter((contribution) => only === undefined || only.includes(contribution.id))
        .map((contribution) => ({
          id: contribution.id,
          ...(contribution.label === undefined ? {} : { label: contribution.label }),
          entries: contribution.entries(place),
        }))
        .filter((section) => section.entries.length > 0),
  }
}
