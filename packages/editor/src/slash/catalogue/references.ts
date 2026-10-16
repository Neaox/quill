import { DEFAULT_CHILD_DEPTH, DEFAULT_TOC_MAX, DEFAULT_TOC_MIN } from '@quill/markdown'
import { DocumentIcon, FootnoteIcon, LinkIcon, OutlineIcon, SmallPrintIcon } from '@quill/ui'

import { insertLink } from '../../document/commands.ts'
import { cardLinkNode, inlineLinkNode, previewableAddress } from '../../link/new-link.ts'
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
      choose: (option) => insertLink({ href: `/d/${option.id}`, text: option.label }),
    },
    (place) => place.state.selection.$from.parent.inlineContent,
  )
}

/**
 * A link that shows the page it goes to, made from an address typed or pasted
 * into the menu's second step (ADR-042: `/link card`, `/link inline`). There is
 * one option, and only once what was typed is an address worth previewing.
 */
function linkPreviewItem(display: 'inline' | 'card'): SlashItem {
  const card = display === 'card'
  return pickerItem(
    {
      id: card ? 'link-card' : 'link-inline',
      label: card ? 'Link card' : 'Link with preview',
      description: card
        ? 'A web page as a card: its title, summary and picture'
        : 'A web page’s icon and title, in the line',
      group: 'References',
      keywords: ['link', 'url', 'web', 'website', 'preview', 'bookmark', 'embed', 'card', 'unfurl'],
      aliases: card ? ['bookmark', 'card'] : ['chip'],
      icon: LinkIcon,
      inline: !card,
    },
    {
      title: card ? 'Link card address' : 'Link address',
      placeholder: 'Paste or type a web address',
      empty: (query) =>
        query.trim() === ''
          ? 'Paste or type a web address'
          : 'That is not a web address (https://…)',
      source: {
        kind: 'list',
        options: (query) => {
          const address = previewableAddress(query)
          return address === null
            ? []
            : [
                {
                  id: address,
                  label: address,
                  description: card ? 'Insert as a card' : 'Insert inline',
                },
              ]
        },
      },
      choose: (option) =>
        card
          ? insertBlock((schema) => cardLinkNode(schema, option.id), { standalone: true })
          : insertInline((schema) => inlineLinkNode(schema, option.id)),
    },
    (place) => (card ? true : place.state.selection.$from.parent.inlineContent),
  )
}

export const referenceItems: SlashContribution = {
  id: 'core.references',
  items: (environment) => [
    ...(environment.searchDocuments === undefined
      ? []
      : [documentLinkItem(environment.searchDocuments)]),
    linkPreviewItem('card'),
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
