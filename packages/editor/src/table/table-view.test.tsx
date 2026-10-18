import { parseDocument } from '@quill/markdown'
import { act, render } from '@testing-library/react'
import { TextSelection } from '@tiptap/pm/state'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { createEditorTestHarness } from '../testing/harness.ts'
import { tableAction } from './table-actions.ts'
import { tableContext, wrapperAttributes } from './table-context.ts'
import { sharesOf, TableBlockView, TableView } from './table-view.ts'

const harness = createEditorTestHarness()

function open(source: string) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const editor = ref.current?.editor
  if (editor == null) throw new Error('The editor did not start.')
  return { ...result, editor }
}

const ROWS = ['| A | B |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |', '| 5 | 6 |'].join('\n')

describe('the table views', () => {
  it('read a wrapper’s proportions as shares of the table, when there is one for each column', () => {
    expect(sharesOf({ columns: '1fr 3fr' }, 2)).toEqual([25, 75])
    expect(sharesOf({ columns: '1fr 3fr' }, 3)).toBeUndefined()
    expect(sharesOf({}, 2)).toBeUndefined()
  })

  it('draw a wrapped table’s proportions as its column group', () => {
    const { container } = open(`:::table{columns="1fr 3fr"}\n${ROWS}\n:::\n`)
    const cols = [...container.querySelectorAll<HTMLElement>('colgroup > col')]

    expect(cols.map((col) => col.style.width)).toEqual(['25%', '75%'])
    expect(container.querySelector('table')).toHaveClass('table-proportional')
  })

  it('keep the column group as it is while words are typed into a cell', () => {
    // Drawn again, the table is laid out again from nothing on every keystroke.
    const { editor, container } = open(`:::table{columns="1fr 3fr"}\n${ROWS}\n:::\n`)
    const cols = [...container.querySelectorAll('colgroup > col')]
    let at = -1
    editor.state.doc.descendants((node, pos) => {
      if (at === -1 && node.isText && node.text === '3') at = pos
    })
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText('x', at + 1))
    })
    expect([...container.querySelectorAll('colgroup > col')]).toEqual(cols)
    expect(cols.every((col) => col.isConnected)).toBe(true)
  })

  it('keep the card’s data attributes in step with the wrapper, dropping what it no longer says', () => {
    const { editor, container } = open(`:::table{freeze=header footer=1}\n${ROWS}\n:::\n`)
    const card = container.querySelector('.table-block-editor')
    expect(card).toHaveAttribute('data-freeze', 'header')

    let at = -1
    editor.state.doc.descendants((node, pos) => {
      if (at === -1 && node.isText && node.text === '3') at = pos
    })
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)))
    })
    act(() => {
      tableAction(editor.state, 'freeze-header')?.command(editor.state, editor.view.dispatch)
    })

    expect(card).not.toHaveAttribute('data-freeze')
    expect(card).toHaveAttribute('data-editor', 'true')
  })

  it('give way to another node, and keep their handles’ events from the editor', () => {
    const { editor } = open(`:::table{footer=1}\n${ROWS}\n:::\n`)
    const wrapper = editor.state.doc.firstChild
    const table = wrapper?.child(0)
    const paragraph = editor.schema.nodes['paragraph']?.create()
    if (wrapper == null || table === undefined || paragraph === undefined)
      throw new Error('no nodes')

    const card = new TableBlockView(wrapper)
    expect(card.update(paragraph)).toBe(false)
    // Its own data attributes are not the document's; what is inside it is.
    const watcher = new MutationObserver(() => undefined)
    watcher.observe(card.dom, { attributes: true, childList: true })
    card.dom.setAttribute('data-width', 'full')
    card.dom.append(document.createElement('p'))
    const [attribute, child] = watcher.takeRecords()
    watcher.disconnect()
    if (attribute === undefined || child === undefined) throw new Error('no mutations')
    expect(card.ignoreMutation(attribute)).toBe(true)
    expect(card.ignoreMutation(child)).toBe(false)
    const view = new TableView(table, editor.view, () => 1)
    expect(view.update(paragraph)).toBe(false)
    const onHandles = new Event('pointerdown')
    Object.defineProperty(onHandles, 'target', { value: view.dom.querySelector('.table-grip') })
    expect(view.stopEvent(onHandles)).toBe(true)
    expect(view.stopEvent(new Event('pointerdown'))).toBe(false)
    view.destroy()
  })
})

describe('the table the selection is in', () => {
  it('reads a wrapper’s attributes as strings, an empty value as empty', () => {
    const state = harness.state(`:::table{footer=1}\n${ROWS}\n:::\n`)
    const wrapper = state.doc.firstChild
    if (wrapper === null) throw new Error('no wrapper')
    const node = wrapper.type.create({ ...wrapper.attrs, attributes: { sort: null, footer: 1 } })

    expect(wrapperAttributes(node)).toEqual({ sort: '', footer: '1' })
    expect(wrapperAttributes(undefined)).toEqual({})
  })

  it('is none from a caption whose table has gone', () => {
    const state = harness.state(`:::table[Caption]{footer=1}\n${ROWS}\n:::\n`)
    const wrapper = state.doc.firstChild
    const caption = wrapper?.firstChild
    if (wrapper == null || caption == null) throw new Error('no caption')
    const tr = state.tr.delete(1 + caption.nodeSize, wrapper.nodeSize - 1)
    const inCaption = state.apply(tr.setSelection(TextSelection.create(tr.doc, 2)))

    expect(tableContext(inCaption)).toBeUndefined()
  })
})
