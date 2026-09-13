import { CALLOUT_TYPES, LAYOUT_WIDTHS } from '@quill/markdown'
import type { CalloutType, LayoutWidth } from '@quill/markdown'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'

import { setBlockWidth } from '../block/commands.ts'
import { insertNode } from '../document/commands.ts'
import { nodeType } from '../schema/node-type.ts'
import { createTable } from '../schema/tables.ts'

/**
 * What the slash menu can insert.
 *
 * Each item is a label and a thing to do with the editor, so the catalogue is
 * data and the menu is a list of it. Items that need something the editor cannot
 * invent — the address of an image — raise a request instead of guessing, because
 * an image with no source is not a document, it is a broken one.
 */

export type SlashRequest = { readonly kind: 'image' }

export interface SlashContext {
  readonly editor: Editor
  request(request: SlashRequest): void
}

export interface SlashItem {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly group: string
  readonly keywords: readonly string[]
  run(context: SlashContext): void
}

function paragraph(schema: Schema, text?: string): PMNode {
  const type = nodeType(schema, 'paragraph')
  return text === undefined || text.length === 0
    ? type.create()
    : type.create(null, schema.text(text))
}

/** A directive block with one paragraph of body, which every template block is. */
export function directiveBlock(
  schema: Schema,
  name: string,
  attributes: Readonly<Record<string, string>>,
  text?: string,
): PMNode {
  return nodeType(schema, 'containerDirective').create(
    { name, attributes },
    paragraph(schema, text),
  )
}

function runCommand(
  editor: Editor,
  command: (state: Editor['state'], dispatch: Editor['view']['dispatch']) => boolean,
): void {
  command(editor.state, editor.view.dispatch)
}

function calloutItem(type: CalloutType): SlashItem {
  const label = type.charAt(0).toUpperCase() + type.slice(1)
  return {
    id: `callout-${type}`,
    label: `Callout: ${label}`,
    description: `An aside the reader should notice, in the ${type} tone`,
    group: 'Insert',
    keywords: ['callout', 'aside', 'admonition', type],
    run: ({ editor }) => {
      runCommand(editor, insertNode(directiveBlock(editor.schema, 'callout', { type })))
    },
  }
}

function widthItem(width: LayoutWidth): SlashItem {
  const label = width.charAt(0).toUpperCase() + width.slice(1)
  return {
    id: `width-${width}`,
    label: `Width: ${label}`,
    description: `Lay this block out at the ${width} width`,
    group: 'Layout',
    keywords: ['width', 'layout', 'breakout', width],
    run: ({ editor }) => {
      runCommand(editor, setBlockWidth(width))
    },
  }
}

function templateItem(
  name: string,
  label: string,
  description: string,
  attributes: Readonly<Record<string, string>>,
  text: string,
): SlashItem {
  return {
    id: `template-${name}`,
    label,
    description,
    group: 'Template',
    keywords: ['template', name],
    run: ({ editor }) => {
      runCommand(editor, insertNode(directiveBlock(editor.schema, name, attributes, text)))
    },
  }
}

export const SLASH_ITEMS: readonly SlashItem[] = [
  {
    id: 'table',
    label: 'Table',
    description: 'A table with a header row',
    group: 'Insert',
    keywords: ['table', 'grid', 'rows'],
    run: ({ editor }) => {
      runCommand(editor, insertNode(createTable(editor.schema, 2, 3)))
    },
  },
  {
    id: 'code-block',
    label: 'Code block',
    description: 'Code, with a language and syntax colour',
    group: 'Insert',
    keywords: ['code', 'fence', 'snippet'],
    run: ({ editor }) => {
      runCommand(editor, insertNode(nodeType(editor.schema, 'codeBlock').create()))
    },
  },
  {
    id: 'image',
    label: 'Image',
    description: 'An image, by address',
    group: 'Insert',
    keywords: ['image', 'picture', 'figure'],
    run: ({ request }) => {
      request({ kind: 'image' })
    },
  },
  ...CALLOUT_TYPES.map(calloutItem),
  ...LAYOUT_WIDTHS.map(widthItem),
  templateItem(
    'placeholder',
    'Placeholder',
    'A prompt the author replaces; never published',
    {},
    'Say what belongs here',
  ),
  templateItem(
    'guidance',
    'Guidance',
    'Advice to the author; removed at publish',
    {},
    'Explain how to fill this section in',
  ),
  templateItem(
    'optional',
    'Optional section',
    'A section offered to the author, published only once added',
    { title: 'Optional section' },
    'What this section is for',
  ),
  templateItem(
    'repeat',
    'Repeating section',
    'A section the author may add again',
    { title: 'Another item' },
    'What one item looks like',
  ),
]

function matches(item: SlashItem, needle: string): boolean {
  return (
    item.label.toLowerCase().includes(needle) ||
    item.keywords.some((keyword) => keyword.includes(needle))
  )
}

/** Filters the catalogue by what the author has typed after the slash. */
export function filterSlashItems(
  query: string,
  items: readonly SlashItem[] = SLASH_ITEMS,
): readonly SlashItem[] {
  const needle = query.trim().toLowerCase()
  return needle.length === 0 ? items : items.filter((item) => matches(item, needle))
}
