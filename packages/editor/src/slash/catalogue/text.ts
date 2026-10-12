import {
  BulletListIcon,
  DividerIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  KeyboardIcon,
  NumberedListIcon,
  ParagraphIcon,
  QuoteIcon,
  TaskListIcon,
} from '@quill/ui'
import type { IconProps } from '@quill/ui'
import { setBlockType, wrapIn } from '@tiptap/pm/commands'
import type { Schema } from '@tiptap/pm/model'
import { wrapInList } from '@tiptap/pm/schema-list'
import type { Command } from '@tiptap/pm/state'
import type { ComponentType } from 'react'

import { AUTOFORMAT_HINTS } from '../../document/autoformat.ts'
import { nodeType } from '../../schema/node-type.ts'
import { insertBlock, insertInline, textDirective } from '../slash-commands.ts'
import { commandItem } from '../slash-item.ts'
import type { SlashContribution, SlashItem } from '../slash-item.ts'

/**
 * Text: the line the slash was typed on becomes something else. These turn
 * the current block rather than adding one, which is what a writer means by
 * "/h2" halfway down a page.
 */

/** A command over the state's own schema, built when it runs. */
function withSchema(make: (schema: Schema) => Command): Command {
  return (state, dispatch, view) => make(state.schema)(state, dispatch, view)
}

interface Heading {
  readonly level: number
  readonly description: string
  readonly icon: ComponentType<IconProps>
}

const HEADINGS: readonly Heading[] = [
  { level: 1, description: 'A section title', icon: Heading1Icon },
  { level: 2, description: 'A section heading', icon: Heading2Icon },
  { level: 3, description: 'A subsection heading', icon: Heading3Icon },
  { level: 4, description: 'A small heading', icon: Heading4Icon },
]

function headingItem({ level, description, icon }: Heading): SlashItem {
  return commandItem(
    {
      id: `heading-${String(level)}`,
      label: `Heading ${String(level)}`,
      description,
      group: 'Text',
      keywords: ['heading', 'title', 'section'],
      aliases: [`h${String(level)}`],
      icon,
      shortcut: AUTOFORMAT_HINTS.heading(level),
    },
    withSchema((schema) => setBlockType(nodeType(schema, 'heading'), { level })),
  )
}

export const textItems: SlashContribution = {
  id: 'core.text',
  items: () => [
    commandItem(
      {
        id: 'paragraph',
        label: 'Text',
        description: 'A plain paragraph',
        group: 'Text',
        keywords: ['paragraph', 'plain', 'body'],
        aliases: ['p'],
        icon: ParagraphIcon,
      },
      withSchema((schema) => setBlockType(nodeType(schema, 'paragraph'))),
    ),
    ...HEADINGS.map(headingItem),
    commandItem(
      {
        id: 'bullet-list',
        label: 'Bulleted list',
        description: 'A list where order does not matter',
        group: 'Text',
        keywords: ['list', 'bullet', 'unordered'],
        aliases: ['ul'],
        icon: BulletListIcon,
        shortcut: AUTOFORMAT_HINTS.bulletList,
      },
      withSchema((schema) => wrapInList(nodeType(schema, 'bulletList'))),
    ),
    commandItem(
      {
        id: 'numbered-list',
        label: 'Numbered list',
        description: 'Steps, in order',
        group: 'Text',
        keywords: ['list', 'ordered', 'steps', 'number'],
        aliases: ['ol'],
        icon: NumberedListIcon,
        shortcut: AUTOFORMAT_HINTS.orderedList,
      },
      withSchema((schema) => wrapInList(nodeType(schema, 'orderedList'))),
    ),
    commandItem(
      {
        id: 'task-list',
        label: 'Task list',
        description: 'Things to do, with checkboxes',
        group: 'Text',
        keywords: ['todo', 'checkbox', 'checklist', 'list'],
        aliases: ['todo'],
        icon: TaskListIcon,
        shortcut: AUTOFORMAT_HINTS.taskList,
      },
      withSchema((schema) => wrapInList(nodeType(schema, 'taskList'))),
    ),
    commandItem(
      {
        id: 'quote',
        label: 'Quote',
        description: 'Words from somewhere else',
        group: 'Text',
        keywords: ['blockquote', 'citation'],
        aliases: ['blockquote'],
        icon: QuoteIcon,
        shortcut: AUTOFORMAT_HINTS.quote,
      },
      withSchema((schema) => wrapIn(nodeType(schema, 'blockquote'))),
    ),
    commandItem(
      {
        id: 'divider',
        label: 'Divider',
        description: 'A rule between two parts of the page',
        group: 'Text',
        keywords: ['rule', 'separator', 'line', 'break'],
        aliases: ['hr'],
        icon: DividerIcon,
        shortcut: AUTOFORMAT_HINTS.divider,
      },
      insertBlock((schema) => nodeType(schema, 'horizontalRule').create()),
    ),
    commandItem(
      {
        id: 'keyboard',
        label: 'Keyboard keys',
        description: 'Keys the reader presses, such as Ctrl+C',
        group: 'Text',
        keywords: ['kbd', 'shortcut', 'key'],
        aliases: ['kbd'],
        icon: KeyboardIcon,
        inline: true,
      },
      insertInline(textDirective('kbd', 'Ctrl+C')),
    ),
  ],
}
