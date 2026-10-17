import type { EditorState } from '@tiptap/pm/state'

import { codeGroupItems } from '../code-block/code-group-slash.ts'
import { detailsItems } from '../details/details-slash.ts'
import { navigationItems } from '../navigation/navigation-slash.ts'
import { blockItems } from './catalogue/blocks.ts'
import { dataItems } from './catalogue/data.ts'
import { mediaItems } from './catalogue/media.ts'
import { referenceItems } from './catalogue/references.ts'
import { templateItems } from './catalogue/templates.ts'
import { textItems } from './catalogue/text.ts'
import { SLASH_GROUPS } from './slash-item.ts'
import type { SlashContribution, SlashEnvironment, SlashItem, SlashPlace } from './slash-item.ts'

/**
 * The slash menu's registry (docs/architecture/patterns.md, "Registry").
 *
 * The catalogue is assembled from contributions — Quill's own, one per
 * group, and any a feature or a Markdown extension adds (ADR-039: an
 * extension's editor binding has an `insert` entry, and this is where it
 * lands). Adding something to the menu is adding a contribution, never
 * editing the menu.
 *
 * Built once per editor, from what the application knows when the editor
 * is built: an item that needs the organisation's labels is only there when
 * there are labels.
 */

/** Quill's own items, in the order their groups are shown. */
export const BUILT_IN_SLASH_CONTRIBUTIONS: readonly SlashContribution[] = [
  textItems,
  blockItems,
  detailsItems,
  navigationItems,
  mediaItems,
  codeGroupItems,
  dataItems,
  referenceItems,
  templateItems,
]

export interface SlashRegistry {
  /** Every item, grouped in the menu's order, catalogue order within a group. */
  readonly items: readonly SlashItem[]
  /** The items that can be used where the caret is. */
  available(state: EditorState): readonly SlashItem[]
  findSlashItem(id: string): SlashItem | undefined
}

export interface SlashRegistryOptions {
  /** Added after Quill's own; a feature's or an extension's items. */
  readonly contributions?: readonly SlashContribution[]
  readonly environment?: SlashEnvironment
}

function groupRank(group: string): number {
  const index = (SLASH_GROUPS as readonly string[]).indexOf(group)
  return index < 0 ? SLASH_GROUPS.length : index
}

/** Where the caret is, in the terms an item's `available` asks about. */
export function describePlace(state: EditorState): SlashPlace {
  const { $from } = state.selection
  let inTableCell = false
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth).type.spec['tableRole']
    if (role === 'cell' || role === 'header_cell') inTableCell = true
  }
  return { state, inTableCell }
}

function usable(item: SlashItem, place: SlashPlace): boolean {
  if (place.inTableCell && item.inline !== true) return false
  return item.available?.(place) ?? true
}

export function createSlashRegistry(options: SlashRegistryOptions = {}): SlashRegistry {
  const environment = options.environment ?? {}
  const contributions = [...BUILT_IN_SLASH_CONTRIBUTIONS, ...(options.contributions ?? [])]
  const contributed = contributions.flatMap((contribution) => contribution.items(environment))

  const byId = new Map<string, SlashItem>()
  for (const item of contributed) {
    if (byId.has(item.id)) {
      throw new Error(`Two slash items are called "${item.id}"; an id names one item.`)
    }
    byId.set(item.id, item)
  }

  // A stable sort, so catalogue order holds within each group.
  const items = contributed.toSorted((a, b) => groupRank(a.group) - groupRank(b.group))

  // The suggestion plugin asks twice per keystroke, of the same state.
  const answered = new WeakMap<EditorState, readonly SlashItem[]>()

  return {
    items,
    available: (state) => {
      const known = answered.get(state)
      if (known !== undefined) return known
      const place = describePlace(state)
      const found = items.filter((item) => usable(item, place))
      answered.set(state, found)
      return found
    },
    findSlashItem: (id) => byId.get(id),
  }
}
