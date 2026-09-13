import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { EditorView as ProseMirrorView } from '@tiptap/pm/view'

import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { COPIED_FEEDBACK_MS, CodeBlockNodeView, PLAIN_TEXT } from './code-block-view.ts'

const SOURCE = ['```ts', "const a = 'one'", '```', '', 'After the block.', ''].join('\n')

function open(source = SOURCE) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  return { ref, user: userEvent.setup(), ...result }
}

function markdown(ref: { current: DocumentEditorHandle | null }): string {
  const handle = ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

/**
 * The clipboard, which jsdom does not implement. Defined on the real navigator
 * rather than over it, because replacing the whole object takes `userAgent`
 * with it and TipTap reads that while it builds its keymap.
 */
function withClipboard(writeText: () => Promise<void>) {
  const written: string[] = []
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text)
        return writeText()
      },
    },
  })
  return {
    written,
    restore: () => {
      if (original === undefined) Reflect.deleteProperty(navigator, 'clipboard')
      else Object.defineProperty(navigator, 'clipboard', original)
    },
  }
}

/** The CodeMirror editor hosted inside the one code block on the page. */
function codeMirror(): CodeMirrorView {
  const host = document.querySelector('.code-block-editor .cm-editor')
  const view = host === null ? null : CodeMirrorView.findFromDOM(host as HTMLElement)
  if (view === null) throw new Error('The code block has no code editor in it.')
  return view
}

describe('a code block in the editor', () => {
  it('is hosted in a code editor with the block text in it', () => {
    open()
    expect(codeMirror().state.doc.toString()).toBe("const a = 'one'")
  })

  it('is framed and named by the language it is written in', () => {
    open()
    const block = screen.getByRole('figure', { name: 'TypeScript code block' })
    expect(block).toBeVisible()
    // The frame is the design system's, applied by class rather than copied.
    expect(block.className).toContain('bg-code-background')
    expect(screen.getByRole('combobox', { name: 'Code block language' })).toHaveValue('typescript')
  })

  it('offers the languages the reading surface colours, and plain text', async () => {
    open()
    const picker = screen.getByRole('combobox', { name: 'Code block language' })
    expect(within(picker).getByRole('option', { name: PLAIN_TEXT.label })).toBeInTheDocument()
    for (const name of ['Bash', 'Go', 'Rust', 'Diff']) {
      expect(within(picker).getByRole('option', { name })).toBeInTheDocument()
    }
    await expect(
      within(picker).findByRole('option', { name: /no grammar/ }),
    ).rejects.toBeInstanceOf(Error)
  })

  it('copies the block, and says so before offering itself again', async () => {
    open()
    // After `open`, because `userEvent.setup` installs a clipboard stub of its own.
    const clipboard = withClipboard(() => Promise.resolve())
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => {
      expect(clipboard.written).toEqual(["const a = 'one'"])
    })
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Copy' })).toBeVisible()
      },
      { timeout: COPIED_FEEDBACK_MS * 2 },
    )
    clipboard.restore()
  })

  it('keeps offering itself when the browser refuses the clipboard', async () => {
    open()
    const clipboard = withClipboard(() => Promise.reject(new Error('Denied')))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => {
      expect(clipboard.written).toEqual(["const a = 'one'"])
    })
    expect(screen.getByRole('button', { name: 'Copy' })).toBeVisible()
    clipboard.restore()
  })

  it('takes its width from the block, so a wide block stays wide (ADR-027)', () => {
    open(':::wide\n```ts\nconst a = 1\n```\n:::\n')
    expect(screen.getByRole('figure', { name: 'TypeScript code block' })).toHaveAttribute(
      'data-layout',
      'wide',
    )
  })

  it('renders the code block without an accessibility violation', async () => {
    const { container } = open()
    await expectNoAccessibilityViolations(container)
  })

  it('shows an alias under the canonical language it means', () => {
    open('```yml\nkey: value\n```\n')
    expect(screen.getByRole('combobox', { name: 'Code block language' })).toHaveValue('yaml')
  })

  it('keeps a fence nothing knows as an option of its own, under its own name', () => {
    open('```mermaid\ngraph TD\n```\n')
    const picker = screen.getByRole('combobox', { name: 'Code block language' })
    expect(picker).toHaveValue('mermaid')
    expect(within(picker).getByRole('option', { name: 'mermaid' })).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'mermaid code block' })).toBeVisible()
  })

  it('writes what is typed in the code editor into the document', () => {
    const { ref } = open()
    act(() => {
      codeMirror().dispatch({ changes: { from: 15, insert: '\nconst b = 2' } })
    })
    expect(markdown(ref)).toContain('const b = 2')
  })

  it('writes a deletion into the document too', () => {
    const { ref } = open()
    act(() => {
      codeMirror().dispatch({ changes: { from: 0, to: 6 } })
    })
    expect(markdown(ref)).toContain("a = 'one'")
    expect(markdown(ref)).not.toContain('const a')
  })

  it('changes the language of the block from the picker', async () => {
    const { ref, user } = open()
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Code block language' }),
      'python',
    )
    expect(markdown(ref)).toContain('```python')
  })

  it('clears the language when the picker is set back to plain text', async () => {
    const { ref, user } = open()
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Code block language' }),
      PLAIN_TEXT.value,
    )
    expect(markdown(ref)).toContain('```\n')
    expect(markdown(ref)).not.toContain('```ts')
  })

  it('gives the document back the caret on Escape', () => {
    const { ref } = open()
    const editor = ref.current?.editor
    if (editor === undefined || editor === null) throw new Error('There is no editor.')
    const before = editor.state.selection.from
    act(() => {
      codeMirror().contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(editor.state.selection.from).toBeGreaterThan(before)
  })

  it('gives the document back the caret above the block as well as below it', () => {
    const { ref } = open(['Before the block.', '', '```ts', 'const a = 1', '```', ''].join('\n'))
    const editor = ref.current?.editor
    if (editor === undefined || editor === null) throw new Error('There is no editor.')
    act(() => {
      codeMirror().dispatch({ selection: { anchor: 0 } })
      codeMirror().contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
      )
    })
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('leaves the block unchanged when nothing in it changed', () => {
    const { ref } = open()
    const before = markdown(ref)
    act(() => {
      codeMirror().dispatch({ selection: { anchor: 2 } })
    })
    expect(markdown(ref)).toBe(before)
  })
})

/**
 * The parts of the node view contract ProseMirror calls but jsdom never reaches,
 * because they depend on real focus and a real selection.
 */
function mount(markdownSource = SOURCE, pos: () => number | undefined = () => 0) {
  const state = createEditorTestHarness().state(markdownSource)
  const host = document.createElement('div')
  document.body.append(host)
  const view = new ProseMirrorView(host, { state })
  return { view, nodeView: new CodeBlockNodeView(view.state.doc.child(0), view, pos) }
}

describe('the code block node view itself', () => {
  it('takes the caret when the document puts the selection inside it', () => {
    const { nodeView, view } = mount()
    nodeView.setSelection(4, 4)
    const inner = CodeMirrorView.findFromDOM(nodeView.dom)
    expect(inner?.state.selection.main.head).toBe(4)
    nodeView.destroy()
    view.destroy()
  })

  it('owns every event and every mutation inside itself', () => {
    const { nodeView, view } = mount()
    expect(nodeView.stopEvent()).toBe(true)
    expect(nodeView.ignoreMutation()).toBe(true)
    nodeView.destroy()
    view.destroy()
  })

  it('refuses to become a node of another type', () => {
    const { nodeView, view } = mount()
    const paragraph = view.state.schema.nodes['paragraph']?.create()
    if (paragraph === undefined) throw new Error('The schema has no paragraph.')
    expect(nodeView.update(paragraph)).toBe(false)
    nodeView.destroy()
    view.destroy()
  })

  it('does nothing at all once it has been taken out of the document', () => {
    const { view, nodeView } = mount(SOURCE, () => undefined)
    const inner = CodeMirrorView.findFromDOM(nodeView.dom)
    const before = view.state.doc.toString()

    inner?.dispatch({ changes: { from: 0, insert: 'x' } })
    nodeView.dom.querySelector('select')?.dispatchEvent(new Event('change'))
    nodeView.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(view.state.doc.toString()).toBe(before)
    nodeView.destroy()
    view.destroy()
  })
})
