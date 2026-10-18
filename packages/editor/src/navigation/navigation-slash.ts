import { ChildPagesIcon, TableOfContentsIcon } from '@quill/ui'

import { commandItem } from '../slash/slash-item.ts'
import type { SlashContribution } from '../slash/slash-item.ts'
import { insertNavigationBlock } from './navigation-commands.ts'

/**
 * The slash menu's way into the navigation blocks (ADR-058), contributed to
 * the registry as any feature's items are. Confluence's names find them
 * first: "toc" and "contents", "children" and "subpages".
 */
export const navigationItems: SlashContribution = {
  id: 'core.navigation',
  items: () => [
    commandItem(
      {
        id: 'table-of-contents',
        label: 'Table of contents',
        description: 'The headings of this page, as links',
        group: 'Navigation',
        keywords: ['contents', 'toc', 'outline', 'navigation', 'index'],
        aliases: ['toc', 'contents'],
        icon: TableOfContentsIcon,
      },
      insertNavigationBlock('toc'),
    ),
    commandItem(
      {
        id: 'child-pages',
        label: 'Child pages',
        description: 'The pages under this one, as links',
        group: 'Navigation',
        keywords: ['children', 'subpages', 'pages', 'tree', 'navigation', 'list', 'descendants'],
        aliases: ['children', 'subpages'],
        icon: ChildPagesIcon,
      },
      insertNavigationBlock('children'),
    ),
  ],
}
