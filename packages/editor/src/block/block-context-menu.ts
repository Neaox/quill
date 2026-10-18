import { ArrowDownIcon, ArrowUpIcon, CopyIcon, PlusIcon, TrashIcon } from '@quill/ui'
import type { Command } from '@tiptap/pm/state'

import type {
  ContextMenuContribution,
  MenuAction,
  MenuPlace,
} from '../context-menu/context-menu-registry.ts'
import { shortcutFor } from '../format/shortcuts.ts'
import { copySectionLink, sectionLinkUnavailable } from '../link/section-link.ts'
import { deleteBlock, duplicateBlock, moveBlock, topLevelBlock } from './commands.ts'
import { blockLabel } from './block-state.ts'

/**
 * The context menu's block section: what the block the pointer is on can do
 * as a whole — move, duplicate, link to, delete — whatever kind it is. The
 * same commands as the block menu (`commands.ts`), so the two never disagree.
 */

function blockAction(
  place: MenuPlace,
  entry: Omit<MenuAction, 'kind' | 'run' | 'disabledReason'>,
  command: Command,
  reason: string,
): MenuAction {
  const { view } = place
  return {
    kind: 'action',
    ...entry,
    disabledReason: command(place.state) ? undefined : reason,
    run: () => {
      command(view.state, view.dispatch, view)
      view.focus()
    },
  }
}

export const blockMenu: ContextMenuContribution = {
  id: 'block',
  order: 60,
  entries: (place) => {
    const block = topLevelBlock(place.state)
    if (block === null) return []
    const name = blockLabel(block.node).toLowerCase()
    return [
      blockAction(
        place,
        { id: 'move-up', label: 'Move up', icon: ArrowUpIcon, shortcut: shortcutFor('moveUp') },
        moveBlock(-1),
        `The ${name} is already first`,
      ),
      blockAction(
        place,
        {
          id: 'move-down',
          label: 'Move down',
          icon: ArrowDownIcon,
          shortcut: shortcutFor('moveDown'),
        },
        moveBlock(1),
        `The ${name} is already last`,
      ),
      blockAction(
        place,
        { id: 'duplicate', label: 'Duplicate', icon: PlusIcon },
        duplicateBlock,
        'This block cannot be duplicated',
      ),
      {
        kind: 'action',
        id: 'copy-section-link',
        label: 'Copy link to section',
        icon: CopyIcon,
        disabledReason: sectionLinkUnavailable(place.state, place.pos, place.environment),
        run: () => {
          copySectionLink(place.state, place.pos, place.environment)
        },
      },
      blockAction(
        place,
        { id: 'delete', label: `Delete ${name}`, icon: TrashIcon, tone: 'danger' },
        deleteBlock,
        'A document keeps at least one block',
      ),
    ]
  },
}
