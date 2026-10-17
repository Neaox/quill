import { TrashIcon } from '@quill/ui'

import type {
  ContextMenuContribution,
  MenuAction,
  MenuEntry,
  MenuPlace,
} from '../context-menu/context-menu-registry.ts'
import { shortcutLabel } from '../format/shortcuts.ts'
import { tableActions } from './table-actions.ts'
import type { ResolvedTableAction, TableActionSection } from './table-actions.ts'

/**
 * The table cell's part of the context menu: the table editor's own catalogue
 * of actions (ADR-040, `table-actions.ts`), with the words, shortcuts and
 * reasons its toolbar shows, so the menu and the toolbar never disagree.
 * Inserting and deleting rows and columns come first, where a right-click
 * on a cell is usually going; the rest are grouped in submenus by what they
 * change.
 */

const SUBMENUS: readonly { readonly section: TableActionSection; readonly label: string }[] = [
  { section: 'move', label: 'Move' },
  { section: 'align', label: 'Align column' },
  { section: 'parts', label: 'Headers, footer and caption' },
  { section: 'width', label: 'Width' },
  { section: 'reading', label: 'For readers' },
]

function entryOf(place: MenuPlace, action: ResolvedTableAction): MenuAction {
  const { view } = place
  return {
    kind: 'action',
    id: `table-${action.id}`,
    label: action.label,
    ...(action.key === undefined ? {} : { shortcut: shortcutLabel(action.key) }),
    ...(action.pressed === undefined ? {} : { checked: action.pressed }),
    disabledReason: action.unavailable,
    run: () => {
      action.command(view.state, view.dispatch, view)
      view.focus()
    },
  }
}

/** Deleting the table, said in words and in colour. */
function destructive(entry: MenuAction): MenuAction {
  return { ...entry, icon: TrashIcon, tone: 'danger' }
}

export const tableMenu: ContextMenuContribution = {
  id: 'table',
  order: 35,
  label: 'Table',
  entries: (place) => {
    const actions = tableActions(place.state)
    if (actions.length === 0) return []
    const inSection = (section: TableActionSection): ResolvedTableAction[] =>
      actions.filter((action) => action.section === section)
    const submenus: MenuEntry[] = SUBMENUS.map(({ section, label }) => ({
      kind: 'submenu',
      id: `table-${section}`,
      label,
      entries: inSection(section).map((action) => entryOf(place, action)),
    }))
    return [
      ...inSection('insert').map((action) => entryOf(place, action)),
      ...inSection('delete').map((action) => entryOf(place, action)),
      ...submenus,
      ...inSection('table').map((action) => destructive(entryOf(place, action))),
    ]
  },
}
