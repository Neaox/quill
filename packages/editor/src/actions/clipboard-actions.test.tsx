import { parseDocument, serializeDocument } from '@quill/markdown'
import { toast } from '@quill/ui'
import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { selectLine, selectTable } from '../table/table-commands.ts'
import { actionState } from './editor-action.ts'
import { COPY, COPY_AS_MARKDOWN, CUT, PASTE } from './clipboard-actions.ts'

const TABLE = '| Region | Owner |\n| - | - |\n| eu | Platform |\n| us | Data |\n'

function open(source: string) {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const editor = ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
  return {
    editor,
    markdown: () =>
      serializeDocument({
        frontMatter: {},
        ast: ref.current?.toMdast() ?? { type: 'root', children: [] },
      }),
  }
}

type Opened = ReturnType<typeof open>

/** Selects the first occurrence of `text`. */
function selectText(opened: Opened, text: string): void {
  const { editor } = opened
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText && node.text?.includes(text) === true) {
      from = pos + (node.text?.indexOf(text) ?? 0)
    }
  })
  act(() => {
    editor.view.focus()
    editor
      .chain()
      .setTextSelection({ from, to: from + text.length })
      .run()
  })
}

/** Runs a ProseMirror command that selects cells. */
function selectCells(opened: Opened, command: ReturnType<typeof selectTable>): void {
  act(() => {
    command(opened.editor.state, opened.editor.view.dispatch)
  })
}

/** Runs an action as the menu does, and lets what it started finish. */
async function run(opened: Opened, action: typeof COPY): Promise<void> {
  await act(async () => {
    action.command(opened.editor.state, opened.editor.view.dispatch, opened.editor.view)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

interface Written {
  html: string
  text: string
}

/** The clipboard, which jsdom does not implement, and what a script may do with it. */
function withClipboard({
  refuse = false,
  reads,
  withItems = true,
}: {
  refuse?: boolean
  reads?: { html?: string; text?: string }
  withItems?: boolean
} = {}) {
  const written: Written[] = []
  const texts: string[] = []
  class FakeItem {
    readonly data: Record<string, Blob>
    constructor(data: Record<string, Blob>) {
      this.data = data
    }
  }
  if (withItems) vi.stubGlobal('ClipboardItem', FakeItem)
  else vi.stubGlobal('ClipboardItem', undefined)
  const read = async () => [
    {
      types: [...(reads?.html === undefined ? [] : ['text/html']), 'text/plain'],
      getType: async (type: string) =>
        new Blob([type === 'text/html' ? (reads?.html ?? '') : (reads?.text ?? '')]),
    },
  ]
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      write: async (items: FakeItem[]) => {
        if (refuse) throw new Error('refused')
        const [item] = items
        const data = item?.data ?? {}
        written.push({
          html: (await data['text/html']?.text()) ?? '',
          text: (await data['text/plain']?.text()) ?? '',
        })
      },
      writeText: async (text: string) => {
        if (refuse) throw new Error('refused')
        texts.push(text)
      },
      read,
      readText: async () => reads?.text ?? '',
    },
  })
  return { written, texts }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('whether the clipboard actions can act', () => {
  it('needs something selected to cut or copy, and nothing to paste', () => {
    withClipboard()
    const opened = open('Some text.\n')
    const state = opened.editor.state

    expect(actionState(COPY, state).enabled).toBe(false)
    expect(actionState(CUT, state).enabled).toBe(false)
    expect(actionState(PASTE, state).enabled).toBe(true)

    selectText(opened, 'text')
    expect(actionState(COPY, opened.editor.state).enabled).toBe(true)
    expect(actionState(CUT, opened.editor.state).enabled).toBe(true)
  })

  it('cannot paste where the browser lets a page read nothing', () => {
    const opened = open('Some text.\n')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {} })

    expect(actionState(PASTE, opened.editor.state).enabled).toBe(false)
  })
})

describe('copying', () => {
  it('puts the selection on the clipboard as formatted text and as plain text', async () => {
    const clipboard = withClipboard()
    const opened = open('Some **bold** text.\n')
    selectText(opened, 'bold')

    await run(opened, COPY)

    expect(clipboard.written).toHaveLength(1)
    expect(clipboard.written[0]?.html).toContain('bold')
    expect(clipboard.written[0]?.text).toBe('bold')
  })

  it('puts plain text alone where the browser has no formatted clipboard', async () => {
    const clipboard = withClipboard({ withItems: false })
    const opened = open('Some text.\n')
    selectText(opened, 'text')

    await run(opened, COPY)

    expect(clipboard.texts).toEqual(['text'])
  })

  it('copies selected cells as an HTML table and as tabs and lines', async () => {
    const clipboard = withClipboard()
    const opened = open(TABLE)
    selectCells(opened, selectTable(0))

    await run(opened, COPY)

    expect(clipboard.written[0]?.html).toContain('<table')
    expect(clipboard.written[0]?.text).toBe('Region\tOwner\neu\tPlatform\nus\tData')
  })

  it('copies a row’s cells and no others', async () => {
    const clipboard = withClipboard()
    const opened = open(TABLE)
    selectCells(opened, selectLine('row', 2, 0))

    await run(opened, COPY)

    expect(clipboard.written[0]?.text).toBe('us\tData')
  })

  it('tells the author when the browser would not, and where the keys are', async () => {
    withClipboard({ refuse: true })
    const warn = vi.spyOn(toast, 'warning').mockReturnValue('id')
    const opened = open('Some text.\n')
    selectText(opened, 'text')

    await run(opened, COPY)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('clipboard'))
  })
})

describe('cutting', () => {
  it('copies, then removes what was copied', async () => {
    const clipboard = withClipboard()
    const opened = open('Some text here.\n')
    selectText(opened, 'text ')

    await run(opened, CUT)

    expect(clipboard.written[0]?.text).toBe('text ')
    expect(opened.markdown()).toBe('Some here.\n')
  })

  it('clears selected cells, keeping the table', async () => {
    withClipboard()
    const opened = open(TABLE)
    selectCells(opened, selectLine('row', 1, 0))

    await run(opened, CUT)

    expect(opened.markdown()).toContain('| Region | Owner |')
    expect(opened.markdown()).not.toContain('Platform')
    expect(opened.markdown()).toContain('| us | Data |')
  })

  it('removes nothing when the browser refused to copy it first', async () => {
    withClipboard({ refuse: true })
    vi.spyOn(toast, 'warning').mockReturnValue('id')
    const opened = open('Some text here.\n')
    selectText(opened, 'text ')

    await run(opened, CUT)

    expect(opened.markdown()).toBe('Some text here.\n')
  })

  it('removes nothing when the selection moved while it was being copied', async () => {
    withClipboard()
    const opened = open('Some text here.\n')
    selectText(opened, 'text ')

    await act(async () => {
      CUT.command(opened.editor.state, opened.editor.view.dispatch, opened.editor.view)
      opened.editor.chain().setTextSelection(2).run()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(opened.markdown()).toBe('Some text here.\n')
  })
})

describe('pasting', () => {
  it('puts the clipboard’s text where the caret is', async () => {
    withClipboard({ reads: { text: 'pasted ' } })
    const opened = open('Some text.\n')
    act(() => {
      opened.editor.view.focus()
      opened.editor.chain().setTextSelection(6).run()
    })

    await run(opened, PASTE)

    expect(opened.markdown()).toBe('Some pasted text.\n')
  })

  it('puts a spreadsheet’s cells in a table, as pasting from the keyboard does', async () => {
    withClipboard({
      reads: {
        html: '<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>',
        text: 'a\tb\n1\t2',
      },
    })
    const opened = open('Before.\n')
    act(() => {
      opened.editor.view.focus()
      opened.editor.chain().setTextSelection(3).run()
    })

    await run(opened, PASTE)

    expect(opened.markdown()).toContain('| a | b |')
    expect(opened.markdown()).toContain('| 1 | 2 |')
  })

  it('puts formatted text from the clipboard in as formatted text', async () => {
    withClipboard({ reads: { html: '<p>a <strong>bold</strong> word</p>', text: 'a bold word' } })
    const opened = open('Start.\n')
    act(() => {
      opened.editor.view.focus()
      opened.editor.chain().setTextSelection(7).run()
    })

    await run(opened, PASTE)

    expect(opened.markdown()).toContain('**bold**')
  })

  it('does nothing, and says so, when the browser would not let it read the clipboard', async () => {
    withClipboard()
    Object.defineProperty(navigator.clipboard, 'readText', {
      value: async () => {
        throw new Error('denied')
      },
    })
    Object.defineProperty(navigator.clipboard, 'read', { value: undefined })
    const warn = vi.spyOn(toast, 'warning').mockReturnValue('id')
    const opened = open('Some text.\n')

    await run(opened, PASTE)

    expect(opened.markdown()).toBe('Some text.\n')
    expect(warn).toHaveBeenCalled()
  })

  it('does nothing for an empty clipboard', async () => {
    withClipboard({ reads: { text: '' } })
    const opened = open('Some text.\n')

    await run(opened, PASTE)

    expect(opened.markdown()).toBe('Some text.\n')
  })
})

describe('copying a table as Markdown', () => {
  it('copies the table as it is written, from a caret anywhere in it', async () => {
    const clipboard = withClipboard()
    const opened = open(TABLE)
    act(() => {
      opened.editor.view.focus()
      opened.editor.chain().setTextSelection(5).run()
    })

    await run(opened, COPY_AS_MARKDOWN)

    expect(clipboard.texts).toEqual([
      '| Region | Owner |\n| - | - |\n| eu | Platform |\n| us | Data |\n',
    ])
  })

  it('copies only the cells selected, the first of them its header', async () => {
    const clipboard = withClipboard()
    const opened = open(TABLE)
    selectCells(opened, selectLine('row', 2, 0))

    await run(opened, COPY_AS_MARKDOWN)

    expect(clipboard.texts[0]).toContain('| us | Data |')
    expect(clipboard.texts[0]).not.toContain('Platform')
  })

  it('says so when the browser would not let it be copied', async () => {
    withClipboard({ refuse: true })
    const warn = vi.spyOn(toast, 'warning').mockReturnValue('id')
    const opened = open(TABLE)
    act(() => {
      opened.editor.view.focus()
      opened.editor.chain().setTextSelection(5).run()
    })

    await run(opened, COPY_AS_MARKDOWN)

    expect(warn).toHaveBeenCalled()
  })

  it('is not offered outside a table', () => {
    withClipboard()
    const opened = open('Some text.\n')

    expect(actionState(COPY_AS_MARKDOWN, opened.editor.state).enabled).toBe(false)
  })
})
