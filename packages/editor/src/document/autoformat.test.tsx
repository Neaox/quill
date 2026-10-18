import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { Fragment } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'

import { editorSchema } from '../schema/editor-schema.ts'
import { markType, nodeType } from '../schema/node-type.ts'
import { documentFromMdast, documentToMdast } from './ast.ts'
import { AUTOFORMAT_HINTS, autoformatRules, leaveInlineCode } from './autoformat.ts'
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

describe('Inline code typed between backticks', () => {
  it('becomes code as the closing backtick is typed, and what follows is plain', async () => {
    expect(await type('Run `pnpm check` before you push')).toBe(
      'Run `pnpm check` before you push\n',
    )
  })

  it('is code with the backticks gone, not text between them', async () => {
    const ref = createRef<DocumentEditorHandle>()
    render(<DocumentEditor ast={parseDocument('\n').ast} ref={ref} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('textbox', { name: 'Document' }))
    await user.keyboard('say `hi`')

    expect(screen.getByText('hi').tagName).toBe('CODE')
    expect(screen.getByRole('textbox', { name: 'Document' })).toHaveTextContent('say hi')
  })

  it('gives back what was typed when Backspace follows at once', async () => {
    const written = await type('say `hi`{Backspace}')

    expect(written).not.toContain('`hi`\n')
    expect(written).toContain('say ')
    expect(written).toContain('hi')
  })

  it('leaves a pair of backticks round spaces, which is not what anyone meant', async () => {
    expect(await type('a ` b ` c')).toBe('a \\` b \\` c\n')
  })

  it('leaves a backtick that is escaped', async () => {
    expect(await type('a \\`b` c')).toBe('a \\\\\\`b\\` c\n')
  })

  it('does not fire in a code block, where backticks are code', () => {
    const doc = docOf('```\nfoo `bar\n```\n')

    expect(typeInto(doc, endOfText(doc), '`').handled).toBe(false)
  })

  it('does not take over a triple backtick fence', async () => {
    expect(await type('```ts ')).toBe('```ts\n```\n')
  })

  it('goes on at the end of code, which is how words are added to it', async () => {
    const written = await type('{ArrowLeft}', 'See `code` now\n')
    expect(written).toBe('See `code` now\n')
  })
})

async function typeAfterArrow(presses: number, typed: string) {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument('See `code` now\n').ast} ref={ref} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('textbox', { name: 'Document' }))
  const editor = ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('No editor.')
  // The caret at the end of the code, where code would go on.
  let end = 0
  editor.state.doc.descendants((child, position) => {
    if (child.isText && child.marks.some((mark) => mark.type.name === 'code')) {
      end = position + child.nodeSize
    }
  })
  act(() => {
    editor.commands.setTextSelection(end)
  })
  await user.keyboard('{ArrowRight}'.repeat(presses) + typed)
  return serializeDocument({
    frontMatter: {},
    ast: ref.current?.toMdast() ?? { type: 'root', children: [] },
  })
}

describe('Leaving inline code with ArrowRight', () => {
  it('goes on in code at its end, until told otherwise', async () => {
    expect(await typeAfterArrow(0, 'X')).toBe('See `codeX` now\n')
  })

  it('steps out of it first, so the next character is plain, and does not move the caret', async () => {
    expect(await typeAfterArrow(1, 'X')).toBe('See `code`X now\n')
  })

  it('moves on as usual on the second press', async () => {
    expect(await typeAfterArrow(2, 'X')).toBe('See `code` Xnow\n')
  })
})

describe('Leaving inline code, asked of a state', () => {
  const code = markType(editorSchema, 'code')

  function codeParagraphDoc(text: string) {
    const line = nodeType(editorSchema, 'paragraph').create(
      null,
      editorSchema.text(text, [code.create()]),
    )
    return nodeType(editorSchema, 'doc').create(null, [line])
  }

  function caretAt(at: number): EditorState {
    const doc = codeParagraphDoc('code')
    const state = EditorState.create({ schema: editorSchema, doc })
    return state.apply(state.tr.setSelection(TextSelection.create(doc, at)))
  }

  it('lets an arrow move through the middle of code, where code goes on', () => {
    expect(leaveInlineCode(caretAt(3))).toBe(false)
  })

  it('lets an arrow move once the code has been left at its end', () => {
    const state = caretAt(5)
    expect(leaveInlineCode(state)).toBe(true)
    const out = state.apply(state.tr.setStoredMarks([markType(editorSchema, 'bold').create()]))
    expect(leaveInlineCode(out)).toBe(false)
  })

  it('leaves an arrow alone over a selection, and outside code', () => {
    const doc = codeParagraphDoc('code')
    const state = EditorState.create({ schema: editorSchema, doc })
    const selected = state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 4)))
    expect(leaveInlineCode(selected)).toBe(false)

    const plain = nodeType(editorSchema, 'doc').create(null, [
      nodeType(editorSchema, 'paragraph').create(null, editorSchema.text('plain')),
    ])
    expect(leaveInlineCode(EditorState.create({ schema: editorSchema, doc: plain }))).toBe(false)
  })

  it('does not turn text already marked as code into more of it as a closing backtick is typed', () => {
    const marked = codeParagraphDoc('`foo')
    const result = typeInto(marked, endOfText(marked), '`')
    expect(result.handled).toBe(false)
    // Nothing was made of it: the document is as it was, a span of code that holds a backtick.
    expect(result.markdown).toBe('`` `foo ``\n')
  })
})
