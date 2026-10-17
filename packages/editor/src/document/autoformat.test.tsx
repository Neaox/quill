import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { Fragment } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'

import { editorSchema } from '../schema/editor-schema.ts'
import { documentFromMdast, documentToMdast } from './ast.ts'
import { AUTOFORMAT_HINTS, autoformatRules } from './autoformat.ts'
import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'
import { EMPTY_LINE_HINT, placeholderFor } from './extensions.ts'

/**
 * Markdown typed at the start of a line, as a writer types it, and the
 * Markdown that comes out.
 */

const docOf = (markdown: string) => documentFromMdast(parseDocument(markdown).ast).doc

const node = (name: string, attrs: Record<string, unknown> = {}) =>
  ({ type: { name }, attrs }) as unknown as Parameters<ReturnType<typeof placeholderFor>>[0]['node']

function typeInto(doc: ReturnType<typeof documentFromMdast>['doc'], at: number, text: string) {
  const start = EditorState.create({
    schema: editorSchema,
    doc,
    plugins: [autoformatRules(editorSchema)],
  })
  const state = start.apply(start.tr.setSelection(TextSelection.create(start.doc, at)))
  const view = new EditorView(document.createElement('div'), { state })
  const handled = view.someProp('handleTextInput', (handle) =>
    handle(view, at, at, text, () => view.state.tr.insertText(text, at)),
  )
  const markdown = serializeDocument({
    frontMatter: {},
    ast: documentToMdast(view.state.doc).tree,
  })
  view.destroy()
  return { handled: handled === true, markdown }
}

const endOfText = (doc: ReturnType<typeof docOf>) => {
  let end = 0
  doc.descendants((child, position) => {
    if (child.isText) end = position + child.nodeSize
  })
  return end
}

async function type(text: string, source = '\n'): Promise<string> {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('textbox', { name: 'Document' }))
  act(() => {
    ref.current?.editor?.commands.focus('end')
  })
  await user.keyboard(text)
  const handle = ref.current
  if (handle === null) throw new Error('No editor.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

describe('Markdown typed at the start of a line', () => {
  it.each([
    ['## Title', '## Title\n'],
    ['#### Small', '#### Small\n'],
    ['- Item', '- Item\n'],
    ['* Item', '- Item\n'],
    ['1. First', '1. First\n'],
    ['3. Third', '3. Third\n'],
    ['[[] Task', '- [ ] Task\n'],
    ['[[ ] Task', '- [ ] Task\n'],
    ['> Quoted', '> Quoted\n'],
    ['``` ', '```\n```\n'],
    ['```ts code', '```ts\ncode\n```\n'],
  ])('%s becomes the block it means', async (typed, expected) => {
    // `[[` is how user-event types a bracket.
    expect(await type(typed)).toBe(expected)
  })

  it('--- becomes a divider with a fresh line after it', async () => {
    expect(await type('---Next')).toBe('---\n\nNext\n')
    cleanup()
    expect(await type('***')).toMatch(/^---\n/)
  })

  it('leaves dashes in the middle of a line alone', async () => {
    expect(await type(' ---', 'Words')).toBe('Words ---\n')
  })

  it('leaves a heading mark alone where a heading cannot go', async () => {
    expect(await type('## x', '- \n')).toBe('- \\## x\n')
  })

  it('is not undone by an ordinary Backspace', async () => {
    // jsdom deletes nothing on Backspace, so only the input rule's undo could act.
    expect(await type('Words{Backspace}')).toBe('Words\n')
  })

  it('names each shortcut the way it is typed', () => {
    expect(AUTOFORMAT_HINTS.heading(3)).toBe('###')
    expect(AUTOFORMAT_HINTS.taskList).toBe('[]')
  })
})

describe('Backspace straight after an autoformat', () => {
  it('gives back what was typed', async () => {
    expect(await type('## {Backspace}')).toBe('\\##&#x20;\n')
  })
})

describe('what an empty line says', () => {
  const say = placeholderFor('Start writing')

  it('the document’s own hint while the whole document is empty', () => {
    expect(say({ editor: { isEmpty: true }, node: node('paragraph') })).toBe('Start writing')
  })

  it('how to insert a block on an empty line, and its level on an empty heading', () => {
    expect(say({ editor: { isEmpty: false }, node: node('paragraph') })).toBe(EMPTY_LINE_HINT)
    expect(say({ editor: { isEmpty: false }, node: node('heading', { level: 2 }) })).toBe(
      'Heading 2',
    )
    expect(say({ editor: { isEmpty: false }, node: node('codeBlock') })).toBe('')
  })
})

describe('the rules, typed straight into a view', () => {
  it('continues a numbered list when the next number is typed after it', () => {
    const list = docOf('1. One\n')
    const doc = list.copy(
      list.content.append(
        Fragment.from(editorSchema.nodes['paragraph']?.create(null, editorSchema.text('2.'))),
      ),
    )
    const at = doc.content.size - 1
    expect(typeInto(doc, at, ' ').markdown).toBe('1. One\n2.\n')
  })

  it('does not draw a rule where one cannot go, or on a heading', () => {
    // A list item must open with a line of text, so a rule cannot replace it.
    const listed = docOf('* --\n')
    expect(typeInto(listed, endOfText(listed), '-').handled).toBe(false)
    // Dashes typed before words already on the line are prose.
    const before = docOf('--x\n')
    expect(typeInto(before, 3, '-').handled).toBe(false)
    const heading = docOf('# --\n')
    expect(typeInto(heading, endOfText(heading), '-').handled).toBe(false)
  })
})
