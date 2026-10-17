import { EditorView } from '@tiptap/pm/view'
import { afterEach, describe, expect, it } from 'vitest'

import { editorSchema } from '../schema/editor-schema.ts'
import { nodeType } from '../schema/node-type.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { TableBlockView, TableView } from './table-view.ts'

const harness = createEditorTestHarness()
const NL = String.fromCharCode(10)

const TABLE = ['| a | b |', '| - | - |', '| c | d |', ''].join(NL)

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

/** A view over `source`, for a node view that is handed one. */
function viewOver(source: string): EditorView {
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView(host, { state: harness.state(source) })
  views.push(view)
  return view
}

function wrapperWith(attributes: Record<string, string>, name = 'table') {
  const table = harness.state(TABLE).doc.child(0)
  return nodeType(editorSchema, 'containerDirective').create({ name, attributes }, table)
}

describe('the card round a table with options', () => {
  it('shows its options as data, and takes away what is no longer set', () => {
    const view = new TableBlockView(wrapperWith({ sort: 'off' }))
    expect(view.dom).toHaveAttribute('data-sort', 'off')

    expect(view.update(wrapperWith({}))).toBe(true)

    expect(view.dom).not.toHaveAttribute('data-sort')
    expect(view.dom).toHaveAttribute('data-editor', 'true')
  })

  it('is not the card of a directive that is no longer a table, or of another node', () => {
    const view = new TableBlockView(wrapperWith({}))
    expect(view.update(wrapperWith({}, 'note'))).toBe(false)
    expect(view.update(nodeType(editorSchema, 'paragraph').create())).toBe(false)
  })
})

describe('a table in the editor', () => {
  it('is its own card when it is not in a wrapper, even where it has no position', () => {
    const view = viewOver(TABLE)
    const table = new TableView(view.state.doc.child(0), view, () => undefined)

    expect(table.dom).toHaveClass('table-block', 'table-block-editor')
    table.destroy()
  })

  it('draws a column for each share the wrapper gives it', () => {
    const view = viewOver(TABLE)
    const table = new TableView(view.state.doc.child(0), view, () => 0)

    table.setAttributes({ columns: '1fr 3fr' })

    const widths = [...table.dom.querySelectorAll<HTMLElement>('col')].map((col) => col.style.width)
    expect(widths).toEqual(['25%', '75%'])
    table.destroy()
  })

  it('stays the view of a table, and of nothing else', () => {
    const view = viewOver(TABLE)
    const table = new TableView(view.state.doc.child(0), view, () => 0)

    expect(table.update(view.state.doc.child(0))).toBe(true)
    expect(table.update(nodeType(editorSchema, 'paragraph').create())).toBe(false)
    table.destroy()
  })
})
