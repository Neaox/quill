import { parseDocument } from '@quill/markdown'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentFromMdast } from '../document/ast.ts'
import { editorSchema } from '../schema/editor-schema.ts'
import { SLASH_GROUPS } from './slash-item.ts'
import type { SlashContribution, SlashItem } from './slash-item.ts'
import { createSlashRegistry, describePlace } from './slash-registry.ts'

function stateAt(markdown: string, position: number): EditorState {
  const state = EditorState.create({
    schema: editorSchema,
    doc: documentFromMdast(parseDocument(markdown).ast).doc,
  })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, position)))
}

function item(id: string, group: string, extra: Partial<SlashItem> = {}): SlashItem {
  return {
    id,
    label: id,
    description: id,
    group,
    keywords: [],
    icon: () => null,
    run: () => {},
    ...extra,
  }
}

function contribution(...items: readonly SlashItem[]): SlashContribution {
  return { id: 'test', items: () => items }
}

describe('the slash registry', () => {
  it('holds Quill’s catalogue, grouped in the menu’s order', () => {
    const { items } = createSlashRegistry()
    const groups = [...new Set(items.map((entry) => entry.group))]
    expect(groups).toEqual(SLASH_GROUPS)
    expect(items.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'paragraph',
        'heading-1',
        'heading-4',
        'bullet-list',
        'numbered-list',
        'task-list',
        'quote',
        'divider',
        'callout-warning',
        'figure',
        'cards',
        'width-wide',
        'image',
        'mermaid',
        'drawing',
        'code-block',
        'table',
        'badge',
        'emoji',
        'footnote',
        'small-print',
        'template-guidance',
      ]),
    )
  })

  it('adds a contribution’s items, in a group of its own after Quill’s, or in one of Quill’s', () => {
    const registry = createSlashRegistry({
      contributions: [
        contribution(item('decision', 'Acme'), item('code-sample', 'Code'), item('note', 'Acme')),
      ],
    })
    const ids = registry.items.map((entry) => entry.id)
    expect(ids.slice(-2)).toEqual(['decision', 'note'])
    expect(ids.indexOf('code-sample')).toBe(ids.indexOf('code-group') + 1)
    expect(registry.findSlashItem('decision')?.group).toBe('Acme')
    expect(registry.findSlashItem('nothing')).toBeUndefined()
  })

  it('refuses two items with one id', () => {
    expect(() =>
      createSlashRegistry({ contributions: [contribution(item('table', 'Data'))] }),
    ).toThrow('Two slash items are called "table"')
  })

  it('builds items from what the application knows', () => {
    expect(createSlashRegistry().findSlashItem('label')).toBeUndefined()
    expect(
      createSlashRegistry({ environment: { labels: [] } }).findSlashItem('label'),
    ).toBeUndefined()
    expect(
      createSlashRegistry({ environment: { labels: ['airbnb'] } }).findSlashItem('label'),
    ).toBeDefined()
    expect(createSlashRegistry().findSlashItem('document-link')).toBeUndefined()
    expect(
      createSlashRegistry({ environment: { searchDocuments: async () => [] } }).findSlashItem(
        'document-link',
      ),
    ).toBeDefined()
  })

  it('offers what fits where the caret is, and answers once per state', () => {
    const registry = createSlashRegistry({
      contributions: [contribution(item('never', 'Acme', { available: () => false }))],
    })
    const paragraph = stateAt('Words\n', 1)
    const offered = registry.available(paragraph)
    expect(offered).toBe(registry.available(paragraph))
    expect(offered.map((entry) => entry.id)).not.toContain('never')
    expect(offered.map((entry) => entry.id)).toContain('table')
    // A paragraph is already a paragraph.
    expect(offered.map((entry) => entry.id)).not.toContain('paragraph')

    const heading = registry.available(stateAt('# Title\n', 1)).map((entry) => entry.id)
    expect(heading).toContain('paragraph')
  })

  it('offers only inline items in a table cell', () => {
    const cell = stateAt('| A |\n| - |\n| 1 |\n', 4)
    expect(describePlace(cell).inTableCell).toBe(true)
    const offered = createSlashRegistry().available(cell)
    expect(offered.every((entry) => entry.inline === true)).toBe(true)
    expect(offered.map((entry) => entry.id)).toContain('badge')
    expect(describePlace(stateAt('Words\n', 1)).inTableCell).toBe(false)
  })
})
