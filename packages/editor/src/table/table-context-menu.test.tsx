import { parseDocument } from '@quill/markdown'
import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type {
  ContextMenuEnvironment,
  MenuAction,
  MenuPlace,
} from '../context-menu/context-menu-registry.ts'
import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { selectLine, selectTable } from './table-commands.ts'
import { tableMenu } from './table-context-menu.ts'

/** The table menu's entries for selected cells: copying them as Markdown, and clearing them. */

const TABLE = '| Region | Owner |\n| :- | -: |\n| eu | Platform |\n| us | Data, ops |\n'

function mount(markdown = TABLE) {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(markdown).ast} ref={ref} />)
  const editor = ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('No editor.')
  return { editor }
}

type Editor = ReturnType<typeof mount>['editor']

function placeIn(editor: Editor, environment: ContextMenuEnvironment = {}): MenuPlace {
  return {
    view: editor.view,
    state: editor.state,
    pos: editor.state.selection.from,
    environment,
    editor: { editLink: vi.fn<() => void>(), editAltText: vi.fn<(pos: number) => void>() },
  }
}

function entry(
  editor: Editor,
  id: string,
  environment?: ContextMenuEnvironment,
): MenuAction | undefined {
  const found = tableMenu.entries(placeIn(editor, environment)).find((each) => each.id === id)
  return found?.kind === 'action' ? found : undefined
}

function run(editor: Editor, command: ReturnType<typeof selectTable>): void {
  act(() => {
    command(editor.state, editor.view.dispatch)
  })
}

describe('the table menu over selected cells', () => {
  it('copies the whole table as the Markdown it is written as', () => {
    const { editor } = mount()
    run(editor, selectTable(0))
    const copyText = vi.fn<(text: string) => Promise<void>>(async () => {})

    act(() => {
      entry(editor, 'table-copy-markdown', { copyText })?.run()
    })

    expect(copyText).toHaveBeenCalledWith(TABLE)
  })

  it('says why it cannot copy where there is no clipboard', () => {
    const { editor } = mount()
    run(editor, selectTable(0))

    expect(entry(editor, 'table-copy-markdown')?.disabledReason).toBe(
      'The clipboard is not available here',
    )
  })

  it('clears the words from the cells and keeps the cells', () => {
    const { editor } = mount()
    run(editor, selectLine('row', 2, 0))

    act(() => {
      entry(editor, 'table-clear-cells')?.run()
    })

    const table = editor.state.doc.child(0)
    expect(table.childCount).toBe(3)
    expect(table.child(2).textContent).toBe('')
    expect(table.child(1).textContent).toBe('euPlatform')
  })

  it('offers neither with the caret in one cell, where copying and deleting are the text’s', () => {
    const { editor } = mount()
    act(() => {
      editor.commands.setTextSelection(4)
    })

    expect(entry(editor, 'table-copy-markdown')).toBeUndefined()
    expect(entry(editor, 'table-clear-cells')).toBeUndefined()
  })
})

describe('a copy of selected cells, in the editor', () => {
  it('carries tabs between cells and lines between rows as its plain text', () => {
    const { editor } = mount()
    run(editor, selectTable(0))
    const { view } = editor

    const text = view.someProp('clipboardTextSerializer', (serialize) =>
      serialize(view.state.selection.content(), view),
    )

    expect(text).toBe('Region\tOwner\neu\tPlatform\nus\tData, ops')
  })
})

describe('Select table, from the menu', () => {
  it('selects every cell, so the table can be copied, cut or cleared whole', () => {
    const { editor } = mount()
    act(() => {
      editor.commands.setTextSelection(4)
    })

    act(() => {
      entry(editor, 'table-select')?.run()
    })

    const content = editor.state.selection.content()
    expect(content.content.firstChild?.type.name).toBe('table')
    expect(content.content.firstChild?.childCount).toBe(3)
  })

  it('is not offered once the whole table is selected', () => {
    const { editor } = mount()
    run(editor, selectTable(0))

    expect(entry(editor, 'table-select')).toBeUndefined()
  })
})
