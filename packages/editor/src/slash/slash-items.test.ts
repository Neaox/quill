import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { describe, expect, it, vi } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { editorSchema } from '../schema/editor-schema.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { SLASH_ITEMS, directiveBlock, filterSlashItems } from './slash-items.ts'
import type { SlashItem, SlashRequest } from './slash-items.ts'

const harness = createEditorTestHarness()

/**
 * The items act on an editor, but only ever through `state`, `schema` and
 * `view.dispatch`, so a state with a dispatch is the whole of what one needs.
 * Running them against the real schema is what makes the test worth having.
 */
function runItem(item: SlashItem, markdown = 'Start here.\n') {
  const start = harness.state(markdown)
  let state = start.apply(start.tr.setSelection(TextSelection.create(start.doc, 1)))
  const request = vi.fn<(request: SlashRequest) => void>()
  const editor = {
    get state() {
      return state
    },
    schema: editorSchema,
    view: {
      dispatch: (tr: ReturnType<typeof state.tr.setMeta>) => {
        state = state.apply(tr)
      },
    },
  } as unknown as Editor

  item.run({ editor, request })
  return { request, markdown: harness.read(documentToMdast(state.doc).tree), doc: state.doc }
}

function itemById(id: string): SlashItem {
  const item = SLASH_ITEMS.find((candidate) => candidate.id === id)
  if (item === undefined) throw new Error(`The catalogue has no "${id}" item.`)
  return item
}

describe('the slash catalogue', () => {
  it('offers a table, a code block, an image, callouts, widths and the template blocks', () => {
    const ids = SLASH_ITEMS.map((item) => item.id)
    expect(ids).toContain('table')
    expect(ids).toContain('code-block')
    expect(ids).toContain('image')
    expect(ids).toContain('callout-warning')
    expect(ids).toContain('width-full')
    expect(ids).toContain('template-guidance')
    expect(ids).toContain('template-optional')
    expect(ids).toContain('template-placeholder')
    expect(ids).toContain('template-repeat')
  })

  it('filters by label and by keyword, and by nothing at all', () => {
    expect(filterSlashItems('')).toHaveLength(SLASH_ITEMS.length)
    expect(filterSlashItems('  ')).toHaveLength(SLASH_ITEMS.length)
    expect(filterSlashItems('tab').map((item) => item.id)).toEqual(['table'])
    expect(filterSlashItems('admonition').every((item) => item.id.startsWith('callout'))).toBe(true)
    expect(filterSlashItems('nothing at all')).toEqual([])
  })

  it('filters a catalogue it is given rather than the built-in one', () => {
    expect(filterSlashItems('table', [itemById('image')])).toEqual([])
  })

  it('inserts a table as GFM', () => {
    expect(runItem(itemById('table')).markdown).toContain('| - | - | - |')
  })

  it('inserts a code block', () => {
    expect(runItem(itemById('code-block')).doc.children.map((c) => c.type.name)).toContain(
      'codeBlock',
    )
  })

  it('asks for an address rather than inserting a broken image', () => {
    const { request, markdown } = runItem(itemById('image'))
    expect(request).toHaveBeenCalledWith({ kind: 'image' })
    expect(markdown).not.toContain('![')
  })

  it('inserts a callout carrying its type', () => {
    expect(runItem(itemById('callout-warning')).markdown).toContain(':::callout{type="warning"}')
  })

  it('sets the width of the block the caret is in', () => {
    expect(runItem(itemById('width-wide')).markdown).toContain(':::wide')
  })

  it('inserts each template block with a prompt in it', () => {
    expect(runItem(itemById('template-guidance')).markdown).toContain(':::guidance')
    expect(runItem(itemById('template-placeholder')).markdown).toContain(':::placeholder')
    expect(runItem(itemById('template-optional')).markdown).toContain('title="Optional section"')
    expect(runItem(itemById('template-repeat')).markdown).toContain(':::repeat')
  })

  it('builds a directive block with an empty body when given no text', () => {
    const block = directiveBlock(editorSchema, 'guidance', {})
    expect(block.textContent).toBe('')
    expect(directiveBlock(editorSchema, 'guidance', {}, '').textContent).toBe('')
  })
})
