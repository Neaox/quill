import { CodeIcon, DiagramIcon, DrawingIcon, ImageIcon } from '@quill/ui'

import { LANGUAGES } from '../../code-block/languages.ts'
import { AUTOFORMAT_HINTS } from '../../document/autoformat.ts'
import { nodeType } from '../../schema/node-type.ts'
import { insertBlock } from '../slash-commands.ts'
import { commandItem, pickerItem } from '../slash-item.ts'
import type { SlashContribution, SlashPickerOption, SlashPlace } from '../slash-item.ts'
import { rankMatches } from '../slash-rank.ts'

/**
 * Media, diagrams and code. A picture and a drawing are files the
 * application uploads, so choosing one raises a request; a Mermaid diagram
 * is a fence the reader draws (ADR-036), so it is inserted with a small
 * diagram in it to edit; a code block asks for its language first.
 */

const STARTER_DIAGRAM = 'flowchart LR\n  start[Start] --> finish[Finish]'

/** A code block, with a language or without one. */
function codeBlock(language: string | null, text?: string) {
  return insertBlock((schema) =>
    nodeType(schema, 'codeBlock').create(
      { language },
      text === undefined ? null : schema.text(text),
    ),
  )
}

/** Where a block can go, asked of a code block because every block item fits where one does. */
function blockFits(place: SlashPlace): boolean {
  return codeBlock(null)(place.state)
}

const LANGUAGE_OPTIONS: readonly SlashPickerOption[] = [
  { id: '', label: 'Plain text', description: 'No highlighting' },
  ...LANGUAGES.map((language) => ({
    id: language.id,
    label: language.label,
    aliases: [language.id, ...language.aliases],
  })),
]

export const mediaItems: SlashContribution = {
  id: 'core.media',
  items: () => [
    {
      id: 'image',
      label: 'Image',
      description: 'Upload a picture, or use one by its address',
      group: 'Media and diagrams',
      keywords: ['image', 'picture', 'photo', 'upload', 'screenshot'],
      aliases: ['img'],
      icon: ImageIcon,
      inline: true,
      run: ({ request }) => {
        request({ kind: 'image' })
      },
    },
    commandItem(
      {
        id: 'mermaid',
        label: 'Mermaid diagram',
        description: 'A flowchart or sequence, written as text',
        group: 'Media and diagrams',
        keywords: ['diagram', 'flowchart', 'sequence', 'chart', 'graph'],
        icon: DiagramIcon,
      },
      codeBlock('mermaid', STARTER_DIAGRAM),
    ),
    {
      id: 'drawing',
      label: 'SVG drawing',
      description: 'Upload a drawing that takes the page’s colours',
      group: 'Media and diagrams',
      keywords: ['svg', 'drawing', 'diagram', 'vector', 'upload'],
      icon: DrawingIcon,
      available: blockFits,
      run: ({ request }) => {
        request({ kind: 'drawing' })
      },
    },
    pickerItem(
      {
        id: 'code-block',
        label: 'Code block',
        description: 'Code, with a language and syntax colour',
        group: 'Code',
        keywords: ['code', 'fence', 'snippet', 'pre'],
        aliases: ['pre'],
        icon: CodeIcon,
        shortcut: AUTOFORMAT_HINTS.codeBlock,
      },
      {
        title: 'Code block language',
        placeholder: 'Search languages',
        empty: (query) => `No language matches “${query}”`,
        source: {
          kind: 'list',
          options: (query) => rankMatches(query, LANGUAGE_OPTIONS).map(({ item }) => item),
        },
        choose: (option) => codeBlock(option.id === '' ? null : option.id),
      },
      blockFits,
    ),
  ],
}
