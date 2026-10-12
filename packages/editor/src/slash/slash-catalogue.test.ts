import { parseDocument, serializeDocument } from '@quill/markdown'
import { history, undo } from '@tiptap/pm/history'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { afterEach, describe, expect, it } from 'vitest'

import { documentFromMdast, documentToMdast } from '../document/ast.ts'
import { editorSchema } from '../schema/editor-schema.ts'
import type { SlashPicker, SlashPickerOption, SlashRequest } from './slash-item.ts'
import { createSlashRegistry } from './slash-registry.ts'
import { runSlashItem } from './slash-run.ts'
import { insertBlock, paragraph } from './slash-commands.ts'
import { nodeType } from '../schema/node-type.ts'

/**
 * Every item Quill ships, run the way the menu runs it: with `/q` typed at
 * the caret, which the run removes. Each insertion is checked three ways —
 * the Markdown it writes, where the caret lands, and that the Markdown
 * round-trips through the editor unchanged, so nothing the menu makes is
 * lost or rewritten on the next save.
 */

const registry = createSlashRegistry({
  environment: {
    labels: ['airbnb'],
    customEmoji: new Map(),
    searchDocuments: async () => [{ id: 'doc-1', title: 'Runbook' }],
  },
})

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

function markdownOf(state: EditorState): string {
  return serializeDocument({ frontMatter: {}, ast: documentToMdast(state.doc).tree })
}

/** Markdown through the editor and back. */
function roundTrip(markdown: string): string {
  const { doc } = documentFromMdast(parseDocument(markdown).ast)
  return serializeDocument({ frontMatter: {}, ast: documentToMdast(doc).tree })
}

interface Run {
  readonly view: EditorView
  readonly markdown: string
  readonly requests: readonly SlashRequest[]
  readonly picker: SlashPicker | undefined
  /** The text of the line the caret is in, and what is selected in it. */
  readonly caret: { readonly line: string; readonly selected: string; readonly in: string }
}

function caretOf(state: EditorState): Run['caret'] {
  const { $from, from, to } = state.selection
  return {
    line: $from.parent.textContent,
    selected: state.doc.textBetween(from, to),
    in: $from.parent.type.name,
  }
}

/** Opens `before/q` with the caret after the query, and runs an item on it. */
function run(id: string, before = ''): Run {
  const item = registry.findSlashItem(id)
  if (item === undefined) throw new Error(`No item is called "${id}".`)
  const source = `${before}/q\n`
  const start = EditorState.create({
    schema: editorSchema,
    doc: documentFromMdast(parseDocument(source).ast).doc,
    plugins: [history()],
  })
  let to = 0
  start.doc.descendants((node, position) => {
    const at = node.isText ? (node.text ?? '').indexOf('/q') : -1
    if (at >= 0) to = position + at + 2
  })
  const state = start.apply(start.tr.setSelection(TextSelection.create(start.doc, to)))
  const view = new EditorView(document.createElement('div'), { state })
  views.push(view)
  const requests: SlashRequest[] = []
  let picker: SlashPicker | undefined
  runSlashItem({
    view,
    range: { from: to - 2, to },
    item,
    request: (request) => requests.push(request),
    pick: (chosen) => {
      picker = chosen
    },
  })
  return { view, markdown: markdownOf(view.state), requests, picker, caret: caretOf(view.state) }
}

async function choose(result: Run, query: string, index = 0): Promise<Run> {
  const { picker, view } = result
  if (picker === undefined) throw new Error('The item opened no picker.')
  const source = picker.source
  const options: readonly SlashPickerOption[] =
    source.kind === 'list'
      ? source.options(query)
      : await source.search(query, new AbortController().signal)
  const option = options[index]
  if (option === undefined) throw new Error(`Nothing matches "${query}".`)
  picker.choose(option)(view.state, (transaction) => {
    view.dispatch(transaction)
  })
  return { ...result, markdown: markdownOf(view.state), caret: caretOf(view.state) }
}

function expectStable(markdown: string): void {
  expect(roundTrip(markdown)).toBe(markdown)
}

describe('text items turn the line they are typed on', () => {
  it.each([
    ['paragraph', '# Words ', 'Words\n', 'paragraph'],
    ['heading-1', 'Words ', '# Words\n', 'heading'],
    ['heading-2', 'Words ', '## Words\n', 'heading'],
    ['heading-3', 'Words ', '### Words\n', 'heading'],
    ['heading-4', 'Words ', '#### Words\n', 'heading'],
    ['bullet-list', 'Words ', '- Words\n', 'paragraph'],
    ['numbered-list', 'Words ', '1. Words\n', 'paragraph'],
    ['task-list', 'Words ', '- [ ] Words\n', 'paragraph'],
    ['quote', 'Words ', '> Words\n', 'paragraph'],
  ])('%s', (id, before, expected, caretIn) => {
    const result = run(id, before)
    expect(result.markdown).toBe(expected)
    expect(result.caret).toMatchObject({ line: 'Words', in: caretIn })
    expectStable(result.markdown)
  })

  it('divider: a rule in place of the empty line, and a fresh line after it', () => {
    const result = run('divider')
    // The fresh line is written as a blank line until something is in it.
    expect(result.markdown).toBe('---\n\n')
    expect(result.caret).toEqual({ line: '', selected: '', in: 'paragraph' })
    expect(result.view.state.doc.childCount).toBe(2)
    expectStable(roundTrip(result.markdown))
  })

  it('keyboard keys: inline, with the keys selected to type over', () => {
    const result = run('keyboard', 'Press ')
    expect(result.markdown).toBe('Press :kbd[Ctrl+C]\n')
    expect(result.caret).toMatchObject({ selected: 'Ctrl+C', in: 'textDirective' })
    expectStable(result.markdown)
  })
})

describe('blocks open with the caret inside them', () => {
  it.each([
    ['callout-note', '> [!NOTE]\n'],
    ['callout-info', '> [!info]\n'],
    ['callout-tip', '> [!TIP]\n'],
    ['callout-important', '> [!IMPORTANT]\n'],
    ['callout-warning', '> [!WARNING]\n'],
    ['callout-caution', '> [!CAUTION]\n'],
    ['notes', ':::notes\n:::\n'],
  ])('%s', (id, expected) => {
    const result = run(id)
    expect(result.markdown).toBe(expected)
    expect(result.view.state.doc.childCount).toBe(1)
    expect(result.caret).toMatchObject({ in: 'paragraph', line: '' })
    expect(result.view.state.selection.$from.node(1).type.name).toBe('containerDirective')
    expectStable(result.markdown)
  })

  it('figure: a line for its subject, the caret on it, and a caption', () => {
    const result = run('figure')
    expect(result.markdown).toBe(':::figure\nCaption\n:::\n')
    expect(result.caret).toMatchObject({ line: '', in: 'paragraph' })
    expectStable(result.markdown)
  })

  it('cards: two cards, the first one’s title selected', () => {
    const result = run('cards')
    expect(result.markdown).toBe(':::cards\n### First card\n\n### Second card\n:::\n')
    expect(result.caret).toMatchObject({ selected: 'First card', in: 'heading' })
    expectStable(result.markdown)
  })

  it.each([
    ['width-wide', ':::wide\nWords\n:::\n'],
    ['width-full', ':::full\nWords\n:::\n'],
  ])('%s sets the width of the line it was typed on', (id, expected) => {
    const result = run(id, 'Words ')
    expect(result.markdown).toBe(expected)
    expectStable(result.markdown)
  })

  it('width-content is offered only where a block is wider than the measure', () => {
    const item = registry.findSlashItem('width-content')
    const state = EditorState.create({
      schema: editorSchema,
      doc: documentFromMdast(parseDocument('Words\n').ast).doc,
    })
    expect(item?.available?.({ state, inTableCell: false })).toBe(false)
  })

  it.each([
    [
      'template-placeholder',
      ':::placeholder\nSay what belongs here\n:::\n',
      'Say what belongs here',
    ],
    [
      'template-guidance',
      ':::guidance\nExplain how to fill this section in\n:::\n',
      'Explain how to fill this section in',
    ],
    [
      'template-optional',
      ':::optional{title="Optional section"}\nWhat this section is for\n:::\n',
      'What this section is for',
    ],
    [
      'template-repeat',
      ':::repeat{title="Another item"}\nWhat one item looks like\n:::\n',
      'What one item looks like',
    ],
  ])('%s, with its prompt selected', (id, expected, prompt) => {
    const result = run(id)
    expect(result.markdown).toBe(expected)
    expect(result.caret.selected).toBe(prompt)
    expectStable(result.markdown)
  })

  it('goes after a line with words in it, in a list item where it must', () => {
    const result = run('table', '- Item ')
    expect(result.markdown).toMatch(/^- Item\n {2}\| /)
    expect(result.caret.in).toBe('paragraph')
    expect(result.view.state.selection.$from.node(-1).type.name).toBe('tableHeader')
  })
})

describe('media, diagrams and code', () => {
  it('table: a header row and two more, the caret in the first cell', () => {
    const result = run('table')
    expect(result.markdown).toBe('| | | |\n| - | - | - |\n| | | |\n| | | |\n')
    expect(result.view.state.selection.$from.node(-1).type.name).toBe('tableHeader')
    expectStable(result.markdown)
  })

  it('mermaid: a diagram fence with a small diagram to edit', () => {
    const result = run('mermaid')
    expect(result.markdown).toBe(
      '```mermaid\nflowchart LR\n  start[Start] --> finish[Finish]\n```\n',
    )
    expect(result.caret.in).toBe('codeBlock')
    expectStable(result.markdown)
  })

  it('image and drawing: ask the application, and leave nothing but the removed query', () => {
    const image = run('image')
    expect(image.requests).toEqual([{ kind: 'image' }])
    expect(image.markdown).toBe('')
    expect(run('drawing').requests).toEqual([{ kind: 'drawing' }])
  })

  it('code block: in the language chosen, or plain', async () => {
    const typed = await choose(run('code-block'), 'ts')
    expect(typed.markdown).toBe('```typescript\n```\n')
    expect(typed.caret.in).toBe('codeBlock')
    expectStable(typed.markdown)

    const plain = await choose(run('code-block'), 'plain')
    expect(plain.markdown).toBe('```\n```\n')
  })
})

describe('data and references', () => {
  it('badge: in the tone chosen, its words selected', async () => {
    const result = await choose(run('badge', 'Built '), 'success')
    expect(result.markdown).toBe('Built :ok[Status]\n')
    expect(result.caret).toMatchObject({ selected: 'Status', in: 'textDirective' })
    expectStable(result.markdown)
  })

  it('label: one of the organisation’s, named for itself', async () => {
    const result = await choose(run('label'), 'air')
    expect(result.markdown).toBe(':airbnb[Airbnb]\n')
    expect(result.caret.selected).toBe('Airbnb')
    expectStable(result.markdown)
  })

  it('emoji: its shortcode, which the editor and the reader draw', async () => {
    const result = await choose(run('emoji', 'Ship it '), 'tada')
    expect(result.markdown).toBe('Ship it :tada:\n')
    expectStable(result.markdown)
  })

  it('link to document: by id, with the title as its words', async () => {
    const result = await choose(run('document-link', 'See '), 'run')
    expect(result.markdown).toBe('See [Runbook](/d/doc-1)\n')
    expectStable(result.markdown)
  })

  it('footnote: the mark at the caret, numbered after the others, and the note at the end', () => {
    const result = run('footnote', 'Claim[^1] and more\n\n[^1]: First.\n\nThen ')
    expect(result.markdown).toBe(
      'Claim[^1] and more\n\n[^1]: First.\n\nThen [^2]\n\n[^2]: Footnote text\n',
    )
    expect(result.caret.selected).toBe('Footnote text')
  })

  it('footnote: the first one is one', () => {
    const result = run('footnote', 'Claim')
    expect(result.markdown).toBe('Claim[^1]\n\n[^1]: Footnote text\n')
    expectStable(result.markdown)
  })

  it('small print: inline, its words selected', () => {
    const result = run('small-print', 'Drawn from main. ')
    expect(result.markdown).toBe('Drawn from main. :small[Small print]\n')
    expect(result.caret.selected).toBe('Small print')
    expectStable(result.markdown)
  })
})

describe('pickers say when nothing matches', () => {
  it.each([
    ['code-block', 'No language matches “zz”'],
    ['badge', 'No tone matches “zz”'],
    ['label', 'No label matches “zz”'],
    ['emoji', 'No emoji matches “zz”'],
    ['document-link', 'No document matches “zz”'],
  ])('%s', (id, message) => {
    expect(run(id).picker?.empty('zz')).toBe(message)
  })

  it('and a document search asks for words before it has any', async () => {
    const { picker } = run('document-link')
    expect(picker?.empty(' ')).toBe('Type to search documents')
    const source = picker?.source
    if (source?.kind !== 'search') throw new Error('Not a search.')
    expect(await source.search('  ', new AbortController().signal)).toEqual([])
  })
})

describe('a block with nowhere to go', () => {
  it('is not offered', () => {
    const state = EditorState.create({
      schema: editorSchema,
      doc: documentFromMdast(parseDocument('Words\n').ast).doc,
    })
    // A list item belongs in a list; the document cannot hold one directly.
    const stray = insertBlock((schema) =>
      nodeType(schema, 'listItem').create(null, paragraph(schema, 'x')),
    )
    expect(stray(state)).toBe(false)
  })
})

describe('undo', () => {
  it('takes the block away and gives the query back, in one step', () => {
    const { view } = run('heading-2', 'Words ')
    undo(view.state, (transaction) => {
      view.dispatch(transaction)
    })
    expect(markdownOf(view.state)).toBe('Words /q\n')
  })
})
