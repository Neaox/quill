import { DEFAULT_CHILD_DEPTH, DEFAULT_TOC_MAX, DEFAULT_TOC_MIN } from '@quill/markdown'
import { DocumentIcon, FootnoteIcon, LinkIcon, OutlineIcon, SmallPrintIcon } from '@quill/ui'

import { insertLink } from '../../document/commands.ts'
import { blockLinkNode, inlineLinkNode, previewableAddress } from '../../link/new-link.ts'
import {
  insertBlock,
  insertFootnote,
  insertInline,
  leafDirective,
  textDirective,
} from '../slash-commands.ts'
import { commandItem, pickerItem } from '../slash-item.ts'
import type { SlashContribution, SlashEnvironment, SlashItem } from '../slash-item.ts'

/**
 * References: what a page points at. A link to another document is written
 * by the document's id (`/d/<id>`, AGENTS.md rule 8), so it survives the
 * document being renamed or moved; finding the document is the
 * application's, which owns search.
 *
 * It is an inline `:link` whose words are its address, which the reader draws as
 * the document's *live* title, for what that reader may see (ADR-042, "Internal
 * links"). Words typed in beside it would be the author's, and so would never
 * follow a rename.
 */

function documentLinkItem(
  searchDocuments: NonNullable<SlashEnvironment['searchDocuments']>,
): SlashItem {
  return pickerItem(
    {
      id: 'document-link',
      label: 'Link to document',
      description: 'Another page in this organisation, by name',
      group: 'References',
      keywords: ['link', 'page', 'document', 'reference', 'mention'],
      aliases: ['page'],
      icon: DocumentIcon,
      inline: true,
    },
    {
      title: 'Link to document',
      placeholder: 'Search documents',
      empty: (query) =>
        query.trim() === '' ? 'Type to search documents' : `No document matches “${query}”`,
      source: {
        kind: 'search',
        search: async (query, signal) => {
          if (query.trim() === '') return []
          const found = await searchDocuments(query, signal)
          return found.map((target) => ({
            id: target.id,
            label: target.title,
            ...(target.context === undefined ? {} : { description: target.context }),
          }))
        },
      },
      choose: (option) => insertInline((schema) => inlineLinkNode(schema, `/d/${option.id}`)),
    },
    (place) => place.state.selection.$from.parent.inlineContent,
  )
}

/** What each way of making a link with a preview says about itself in the slash menu. */
const LINK_PREVIEW_ITEMS = {
  card: {
    id: 'link-card',
    label: 'Link card',
    description: 'A web page as a card: its title, summary and picture',
    aliases: ['bookmark', 'card'],
    title: 'Link card address',
    offer: 'Insert as a card',
  },
  compact: {
    id: 'link-compact',
    label: 'Compact link',
    description: 'A web page’s icon, title and site on one line, for lists of references',
    aliases: ['reference', 'compact'],
    title: 'Compact link address',
    offer: 'Insert as a compact line',
  },
  inline: {
    id: 'link-inline',
    label: 'Link with preview',
    description: 'A web page’s icon and title, in the line',
    aliases: ['chip'],
    title: 'Link address',
    offer: 'Insert inline',
  },
} as const

/**
 * A link that shows the page it goes to, made from an address typed or pasted
 * into the menu's second step (ADR-042: `/link card`, `/link compact`,
 * `/link inline`). There is one option, and only once what was typed is an
 * address worth previewing.
 */
function linkPreviewItem(display: 'inline' | 'compact' | 'card'): SlashItem {
  const words = LINK_PREVIEW_ITEMS[display]
  const block = display !== 'inline'
  return pickerItem(
    {
      id: words.id,
      label: words.label,
      description: words.description,
      group: 'References',
      keywords: [
        'link',
        'url',
        'web',
        'website',
        'preview',
        'bookmark',
        'embed',
        'unfurl',
        display,
      ],
      aliases: words.aliases,
      icon: LinkIcon,
      inline: !block,
    },
    {
      title: words.title,
      placeholder: 'Paste or type a web address',
      empty: (query) =>
        query.trim() === ''
          ? 'Paste or type a web address'
          : 'That is not a web address (https://…)',
      source: {
        kind: 'list',
        options: (query) => {
          const address = previewableAddress(query)
          return address === null ? [] : [{ id: address, label: address, description: words.offer }]
        },
      },
      choose: (option) =>
        display === 'inline'
          ? insertInline((schema) => inlineLinkNode(schema, option.id))
          : insertBlock((schema) => blockLinkNode(schema, option.id, display), {
              standalone: true,
            }),
    },
    (place) => (block ? true : place.state.selection.$from.parent.inlineContent),
  )
}

export const referenceItems: SlashContribution = {
  id: 'core.references',
  items: (environment) => [
    ...(environment.searchDocuments === undefined
      ? []
      : [documentLinkItem(environment.searchDocuments)]),
    linkPreviewItem('card'),
    linkPreviewItem('compact'),
    linkPreviewItem('inline'),
    commandItem(
      {
        id: 'table-of-contents',
        label: 'Table of contents',
        description: 'Links to the headings of this page',
        group: 'References',
        keywords: ['toc', 'contents', 'outline', 'navigation', 'sections'],
        icon: OutlineIcon,
      },
      insertBlock(
        leafDirective('toc', { min: String(DEFAULT_TOC_MIN), max: String(DEFAULT_TOC_MAX) }),
        { standalone: true },
      ),
    ),
    commandItem(
      {
        id: 'child-documents',
        label: 'Child documents',
        description: 'The documents beneath this one, to the depth you choose',
        group: 'References',
        keywords: ['children', 'child', 'pages', 'subpages', 'documents', 'tree', 'index'],
        aliases: ['subpages'],
        icon: DocumentIcon,
      },
      insertBlock(leafDirective('children', { depth: String(DEFAULT_CHILD_DEPTH) }), {
        standalone: true,
      }),
    ),
    commandItem(
      {
        id: 'footnote',
        label: 'Footnote',
        description: 'A numbered note at the end of the page',
        group: 'References',
        keywords: ['footnote', 'note', 'citation', 'source'],
        icon: FootnoteIcon,
        inline: true,
      },
      insertFootnote('Footnote text'),
    ),
    commandItem(
      {
        id: 'small-print',
        label: 'Small print',
        description: 'A side comment, such as where a fact came from',
        group: 'References',
        keywords: ['small', 'aside', 'fine print', 'source'],
        icon: SmallPrintIcon,
        inline: true,
      },
      insertInline(textDirective('small', 'Small print')),
    ),
  ],
}
