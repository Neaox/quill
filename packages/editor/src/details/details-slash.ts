import { AccordionIcon, DetailsIcon } from '@quill/ui'

import { insertBlock } from '../slash/slash-commands.ts'
import { commandItem } from '../slash/slash-item.ts'
import type { SlashContribution } from '../slash/slash-item.ts'
import { createAccordionNode, createDetailsNode } from './details-commands.ts'
import { DETAILS_AUTOFORMAT } from './details-extension.ts'

/**
 * The slash menu's way into details and accordions (ADR-048), contributed to
 * the registry the way any feature's items are. Each opens with the caret in
 * the summary, ready for its words. Confluence calls a details an expand and
 * Notion a toggle, so both names find it first.
 */
export const detailsItems: SlashContribution = {
  id: 'core.details',
  items: () => [
    commandItem(
      {
        id: 'details',
        label: 'Details',
        description: 'A section the reader opens when they want it',
        group: 'Blocks',
        keywords: [
          'details',
          'collapse',
          'collapsible',
          'fold',
          'summary',
          'disclosure',
          'hide',
          'spoiler',
        ],
        aliases: ['expand', 'toggle'],
        icon: DetailsIcon,
        shortcut: DETAILS_AUTOFORMAT,
      },
      insertBlock(createDetailsNode),
    ),
    commandItem(
      {
        id: 'accordion',
        label: 'Accordion',
        description: 'Details where opening one closes the others',
        group: 'Blocks',
        keywords: ['accordion', 'faq', 'questions', 'expand', 'collapse', 'group'],
        aliases: ['faq'],
        icon: AccordionIcon,
      },
      insertBlock(createAccordionNode),
    ),
  ],
}
