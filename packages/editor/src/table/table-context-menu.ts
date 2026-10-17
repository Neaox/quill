import { CopyIcon, TrashIcon } from '@quill/ui'
import { CellSelection, deleteCellSelection } from 'prosemirror-tables'

import type {
  ContextMenuContribution,
  MenuAction,
  MenuEntry,
  MenuPlace,
} from '../context-menu/context-menu-registry.ts'
import { shortcutLabel } from '../format/shortcuts.ts'
import { tableActions } from './table-actions.ts'
import { markdownOfTable, tableOfSlice } from './table-copy.ts'
import { selectTable } from './table-commands.ts'
import { tableContext } from './table-context.ts'
import type { ResolvedTableAction, TableActionSection } from './table-actions.ts'

/**
 * The table cell's part of the context menu: the table editor's own catalogue
 * of actions (ADR-040, `table-actions.ts`), with the words, shortcuts and
 * reasons its toolbar shows, so the menu and the toolbar never disagree.
 * Inserting and deleting rows and columns come first, where a right-click
 * on a cell is usually going; the rest are grouped in submenus by what they
 * change. Over selected cells it also copies them as the Markdown they are
 * written as, and clears their words while keeping the cells (ADR-040); cut,
 * copy and paste of the cells themselves are the text menu's.
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

/**
 * Every cell of the table, so it can be copied, cut or cleared whole: offered
 * until the whole table is what is selected.
 */
function selectTableEntry(place: MenuPlace): MenuAction[] {
  const { view, state } = place
  const context = tableContext(state)
  if (context === undefined) return []
  const { rect, map } = context
  const whole =
    state.selection instanceof CellSelection &&
    rect.left === 0 &&
    rect.top === 0 &&
    rect.right === map.width &&
    rect.bottom === map.height
  if (whole) return []
  return [
    {
      kind: 'action',
      id: 'table-select',
      label: 'Select table',
      run: () => {
        selectTable(context.tablePos)(view.state, view.dispatch)
        view.focus()
      },
    },
  ]
}

/** Copying selected cells as Markdown, and clearing them: only over a selection of cells. */
function cellEntries(place: MenuPlace): MenuAction[] {
  const { view, state, environment } = place
  if (!(state.selection instanceof CellSelection)) return []
  const table = tableOfSlice(state.selection.content())
  const copyText = environment.copyText
  return [
    {
      kind: 'action',
      id: 'table-copy-markdown',
      label: 'Copy as Markdown',
      icon: CopyIcon,
      disabledReason: copyText === undefined ? 'The clipboard is not available here' : undefined,
      run: () => {
        if (table !== undefined) void copyText?.(markdownOfTable(table))
      },
    },
    {
      kind: 'action',
      id: 'table-clear-cells',
      label: 'Clear cells',
      run: () => {
        deleteCellSelection(view.state, view.dispatch)
        view.focus()
      },
    },
  ]
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
      ...selectTableEntry(place),
      ...cellEntries(place),
      ...inSection('insert').map((action) => entryOf(place, action)),
      ...inSection('delete').map((action) => entryOf(place, action)),
      ...submenus,
      ...inSection('table').map((action) => destructive(entryOf(place, action))),
    ]
  },
}
