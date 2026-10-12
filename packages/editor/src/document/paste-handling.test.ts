import { parseDocument, serializeDocument } from '@quill/markdown'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DocumentAst } from '../document-ast.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { documentToMdast } from './ast.ts'
import { buildExtensions } from './extensions.ts'
import type { ParseMarkdown } from './markdown-parser.ts'
import { LARGE_PASTE_CHARS, MarkdownPaste, PASTE_PROGRESS_DELAY_MS, pasteKey } from './paste.ts'

/**
 * The paste handler, driven by real paste events through a real editor. The
 * decision is `choosePaste`, which `paste.test.ts` covers as a table; this is
 * the wiring around it: that Markdown is read from the event before
 * ProseMirror reads the clipboard, and that a large paste is parsed elsewhere
 * and lands where the selection was, whatever happened meanwhile.
 */

const harness = createEditorTestHarness()
const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
  vi.useRealTimers()
})

/** A parser that answers when the test says so. */
function heldParser() {
  const held: { markdown: string; resolve(ast: DocumentAst): void }[] = []
  const parse: ParseMarkdown = (markdown) =>
    new Promise((resolve) => {
      held.push({ markdown, resolve })
    })
  return {
    parse,
    held,
    /** Answers the oldest request still held. */
    async answer() {
      const request = held.shift()
      request?.resolve(parseDocument(request.markdown).ast)
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

function open(markdown: string, parse?: ParseMarkdown, editable = true) {
  const extensions = buildExtensions({ files: { onFiles: () => undefined } }).map((extension) =>
    extension.name === MarkdownPaste.name ? MarkdownPaste.configure({ parse }) : extension,
  )
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions,
    editable,
    content: harness.state(markdown).doc.toJSON(),
  })
  editors.push(editor)
  return editor
}

function paste(editor: Editor, data: Record<string, string>, files: readonly File[] = []) {
  const clipboardData = new DataTransfer()
  for (const [type, value] of Object.entries(data)) clipboardData.setData(type, value)
  Object.defineProperty(clipboardData, 'files', { value: files })
  const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
  editor.view.dom.dispatchEvent(event)
  return event
}

function written(editor: Editor): string {
  return serializeDocument({ frontMatter: {}, ast: documentToMdast(editor.state.doc).tree })
}

function caretAt(editor: Editor, pos: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}

/** Markdown longer than the threshold: a heading and enough paragraphs. */
function large(heading: string): string {
  const paragraph = 'A sentence that is long enough to count. '.repeat(10)
  const count = Math.ceil(LARGE_PASTE_CHARS / paragraph.length) + 1
  return [`## ${heading}`, ...Array.from({ length: count }, () => paragraph.trim())].join('\n\n')
}

describe('a paste of Markdown', () => {
  it('becomes blocks, read from the paste event before ProseMirror reads the clipboard', () => {
    const editor = open('Text.\n')
    caretAt(editor, 6)
    const event = paste(editor, { 'text/plain': '## A heading\n\n- one\n- two\n' })
    expect(event.defaultPrevented).toBe(true)
    expect(written(editor)).toBe('Text.\n\n## A heading\n\n- one\n- two\n')
  })

  it('links the selection when the clipboard is an address', () => {
    const editor = open('Read the docs.\n')
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 10, 14)),
    )
    paste(editor, { 'text/plain': 'https://example.com/docs' })
    expect(written(editor)).toBe('Read the [docs](https://example.com/docs).\n')
  })

  it('leaves rich content, a file, and a read-only document to the handlers after it', () => {
    const editor = open('Text.\n')
    caretAt(editor, 6)
    const rich = paste(editor, {
      'text/plain': 'Bold',
      'text/html': '<p><strong>Bold</strong></p>',
    })
    expect(written(editor)).toContain('**Bold**')
    expect(rich.defaultPrevented).toBe(true)

    const picture = new File(['png'], 'diagram.png', { type: 'image/png' })
    const before = written(editor)
    paste(editor, { 'text/plain': '# Not a heading' }, [picture])
    expect(written(editor)).toBe(before)

    // A paste event with no clipboard at all, which some browsers send.
    editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }))
    expect(written(editor)).toBe(before)

    const readOnly = open('Text.\n', undefined, false)
    const ignored = paste(readOnly, { 'text/plain': '## A heading' })
    expect(ignored.defaultPrevented).toBe(false)
  })
})

describe('a large paste of Markdown', () => {
  it('is parsed elsewhere and lands where the selection was, moved by what was typed meanwhile', async () => {
    const parser = heldParser()
    const editor = open('Before after.\n', parser.parse)
    caretAt(editor, 8)
    paste(editor, { 'text/plain': large('Pasted') })
    expect(parser.held).toHaveLength(1)
    expect(written(editor)).toBe('Before after.\n')

    // A transaction that moves nothing leaves the pending paste as it was.
    const waiting = pasteKey.getState(editor.state)
    editor.view.dispatch(editor.state.tr.setMeta('unrelated', true))
    expect(pasteKey.getState(editor.state)).toBe(waiting)

    // The writer goes on typing, before the place the paste will land.
    editor.view.dispatch(editor.state.tr.insertText('Just ', 1))
    await parser.answer()

    const text = written(editor)
    expect(text.startsWith('Just Before')).toBe(true)
    expect(text.indexOf('## Pasted')).toBeGreaterThan(text.indexOf('Just Before'))
    expect(text.endsWith('after.\n')).toBe(true)
    expect(pasteKey.getState(editor.state)).toBeNull()
  })

  it('says it is still going once it has taken a moment, as a status', () => {
    vi.useFakeTimers()
    const parser = heldParser()
    const editor = open('Text.\n', parser.parse)
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('Slow') })
    expect(editor.view.dom.querySelector('[role="status"]')).toBeNull()
    vi.advanceTimersByTime(PASTE_PROGRESS_DELAY_MS)
    const status = editor.view.dom.querySelector('[role="status"]')
    expect(status?.textContent).toBe('Pasting…')
    // Other edits redraw the document; the status stays where the paste lands.
    editor.view.dispatch(editor.state.tr.insertText('x', 1))
    expect(editor.view.dom.querySelector('[role="status"]')).not.toBeNull()
  })

  it('is abandoned by Escape, and its blocks are not put in when they arrive', async () => {
    vi.useFakeTimers()
    const parser = heldParser()
    const editor = open('Text.\n', parser.parse)
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('Abandoned') })
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    editor.view.dom.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(pasteKey.getState(editor.state)).toBeNull()
    vi.advanceTimersByTime(PASTE_PROGRESS_DELAY_MS)
    expect(editor.view.dom.querySelector('[role="status"]')).toBeNull()
    await parser.answer()
    expect(written(editor)).toBe('Text.\n')

    // With nothing on its way, Escape is not the paste's to take.
    const again = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    editor.view.dom.dispatchEvent(again)
    expect(again.defaultPrevented).toBe(false)
  })

  it('gives way to a newer one, and to the editor going away', async () => {
    const parser = heldParser()
    const editor = open('Text.\n', parser.parse)
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('First') })
    paste(editor, { 'text/plain': large('Second') })
    await parser.answer()
    expect(written(editor)).not.toContain('First')
    await parser.answer()
    expect(written(editor)).toContain('## Second')

    const leaving = open('Text.\n', parser.parse)
    paste(leaving, { 'text/plain': large('Gone') })
    leaving.destroy()
    await parser.answer()
    expect(parser.held).toHaveLength(0)
  })

  it('is parsed by the page when nothing else is given, here in the page itself', async () => {
    const editor = open('Text.\n')
    caretAt(editor, 6)
    paste(editor, { 'text/plain': large('In the page') })
    await vi.waitFor(() => {
      expect(written(editor)).toContain('## In the page')
    })
  })
})
