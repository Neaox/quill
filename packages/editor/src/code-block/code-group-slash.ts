import { CodeGroupIcon } from '@quill/ui'

import { insertBlock } from '../slash/slash-commands.ts'
import { commandItem } from '../slash/slash-item.ts'
import type { SlashContribution } from '../slash/slash-item.ts'
import { createCodeGroupNode } from './code-group-commands.ts'

/**
 * The slash menu's way into a code group (ADR-041), contributed to the
 * registry the way any feature's items are. It opens with two empty tabs and
 * the caret in the first; each tab takes its language's name until it is
 * given one of its own.
 */
export const codeGroupItems: SlashContribution = {
  id: 'core.code-group',
  items: () => [
    commandItem(
      {
        id: 'code-group',
        label: 'Code group',
        description: 'The same code in several languages, as tabs',
        group: 'Code',
        keywords: ['code', 'tabs', 'languages', 'examples', 'group', 'snippet'],
        aliases: ['tabs', 'code tabs'],
        icon: CodeGroupIcon,
      },
      insertBlock(createCodeGroupNode),
    ),
  ],
}
