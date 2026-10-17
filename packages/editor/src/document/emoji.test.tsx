import { emojiLookup, parseDocument, serializeDocument } from '@quill/markdown'
import { standardEmoji } from '@quill/markdown/emoji-shortcodes'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { render, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'
import { documentFromMdast, documentToMdast } from './ast.ts'
import { emojiDecorations, emojiShortcodesKey, findEmoji, loadStandardEmoji } from './emoji.ts'
import { buildExtensions } from './extensions.ts'

const harness = createEditorTestHarness()
const AIRBNB = { src: '/api/emoji/airbnb.0123456789abcdef.svg', width: 32, height: 32 }
const custom = new Map([['airbnb', AIRBNB]])
const lookup = emojiLookup(custom, standardEmoji)
const leads = new Map([['airbnb', 'airbnb']])

const found = (markdown: string) =>
  findEmoji(harness.state(markdown).doc, lookup, leads).map(({ emoji, from, to }) => ({
    name: emoji.name,
    width: to - from,
  }))

/** Where these words first appear in the document. */
function at(state: EditorState, text: string): number {
  let first = -1
  state.doc.descendants((node, position) => {
    const offset = node.isText ? (node.text ?? '').indexOf(text) : -1
    if (first < 0 && offset >= 0) first = position + offset
  })
  return first
}

/** What the editor's emoji plugin draws, as positions. */
function drawn(state: EditorState): readonly (readonly [number, number])[] {
  return (emojiShortcodesKey.getState(state)?.find() ?? []).map(({ from, to }) => [from, to])
}

/** What a full scan of the same document draws. */
function expected(state: EditorState): readonly (readonly [number, number])[] {
  return emojiDecorations(state, findEmoji(state.doc, lookup, leads))
    .find()
    .map(({ from, to }) => [from, to])
}

describe('emoji in the editor (ADR-038)', () => {
  it('finds standard and custom shortcodes, and a label’s leading emoji', () => {
    expect(found(':+1: on :airbnb: and :airbnb[Airbnb]\n')).toEqual([
      { name: '+1', width: 4 },
      { name: 'airbnb', width: 8 },
      { name: 'airbnb', width: 0 },
    ])
  })

  it('leaves code, autolinks, unknown names and unlabelled directives alone', () => {
    expect(found('`:+1:` and https://x.test/:+1: and :nope: and status:airbnb\n')).toEqual([])
    expect(found('```\n:+1:\n```\n')).toEqual([])
    expect(found(':vrbo[Vrbo]\n')).toEqual([])
  })

  it('hides the shortcode behind its emoji, except where the selection touches it', () => {
    const state = harness.state('a :+1: b\n')
    const matches = findEmoji(state.doc, lookup, leads)
    const away = emojiDecorations(state, matches).find()
    expect(away).toHaveLength(2)

    const inside = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)))
    expect(emojiDecorations(inside, matches).find()).toHaveLength(0)
  })

  it.each([
    ':smile: :+1: :airbnb:',
    'a:b:c and 10:30:00 and status:ok',
    '<https://x.y/a:b>',
    'A sentence that ends in a colon:',
    ': a line that starts with a colon',
    ':smile: next to :ok[Built] and :airbnb[Airbnb]',
  ])('saves %s byte for byte', (line) => {
    const source = `${line}\n`
    const { doc } = documentFromMdast(parseDocument(source).ast)
    expect(serializeDocument({ frontMatter: {}, ast: documentToMdast(doc).tree })).toBe(source)
  })

  it('loads GitHub’s table once', async () => {
    expect(await loadStandardEmoji()).toBe(await loadStandardEmoji())
  })

  it('draws emoji in a live editor and keeps the shortcodes in the Markdown', async () => {
    const ref = createRef<DocumentEditorHandle>()
    const { container, unmount } = render(
      <DocumentEditor
        ast={parseDocument('Start :airbnb: :tada: :airbnb[Airbnb]\n').ast}
        ref={ref}
        labels={['airbnb']}
        emoji={{ custom, labelEmoji: leads }}
      />,
    )
    // Custom emoji at once, GitHub's once its table has loaded.
    expect(container.querySelector('img.emoji[alt=":airbnb:"]')).not.toBeNull()
    await waitFor(() => {
      expect(container.querySelector('span.emoji[aria-label="party popper"]')).not.toBeNull()
    })
    expect(container.querySelector('.badge img.emoji[alt=""]')).not.toBeNull()

    const handle = ref.current
    if (handle === null) throw new Error('no handle')
    const { editor } = handle
    if (editor === null) throw new Error('no editor')
    // The caret on a shortcode shows its text; typing, moving and an
    // unrelated transaction each redraw only when they must.
    editor.commands.setTextSelection(8)
    expect(container.querySelector('img.emoji[alt=":airbnb:"]')).toBeNull()
    editor.view.dispatch(editor.state.tr.setMeta('unrelated', true))
    editor.commands.insertContentAt(1, 'A ')
    expect(serializeDocument({ frontMatter: {}, ast: handle.toMdast() })).toContain(':tada:')
    unmount()
  })

  it('draws an animated emoji with its still for a reader who asks for less motion', async () => {
    const party = {
      src: '/api/emoji/party.aaaaaaaaaaaaaaaa.gif',
      still: '/api/emoji/party.bbbbbbbbbbbbbbbb.gif',
      frames: 12,
      milliseconds: 1200,
      width: 32,
      height: 32,
    }
    const { container, unmount } = render(
      <DocumentEditor
        ast={parseDocument('Start :party:\n').ast}
        emoji={{ custom: new Map([['party', party]]), labelEmoji: new Map() }}
      />,
    )
    const picture = container.querySelector('picture.emoji')
    const source = container.querySelector('picture.emoji > source')
    expect(source?.getAttribute('srcset')).toBe(party.still)
    expect(container.querySelector('picture.emoji > img.emoji')?.getAttribute('src')).toBe(
      party.src,
    )
    // Timed as the reader times it, and played briefly by the same enhancer (ADR-047).
    expect(picture?.getAttribute('data-frames')).toBe('12')
    expect(picture?.getAttribute('data-loop-ms')).toBe('1200')
    await waitFor(() => {
      expect(picture?.getAttribute('data-state')).not.toBeNull()
    })
    unmount()
    // Given back as it came once the editor goes, which Tiptap does on a later tick.
    await waitFor(() => {
      expect(source?.getAttribute('media')).toBe('(prefers-reduced-motion: reduce)')
    })
  })

  it('keeps its emoji right while the document is edited, block by block', async () => {
    await loadStandardEmoji()
    const editor = new Editor({
      extensions: buildExtensions({ emoji: { custom, labelEmoji: leads }, labels: ['airbnb'] }),
      content: harness
        .state(['One :+1: and :airbnb[Airbnb].', 'Two :airbnb:.', 'Three.', ''].join('\n\n'))
        .doc.toJSON(),
    })
    // GitHub's table arrives on a later turn of the event loop than the editor.
    await waitFor(() => {
      expect(drawn(editor.state)).toHaveLength(5)
    })
    const code = editor.schema.marks['code']
    if (code === undefined) throw new Error('No code mark.')
    const edits: ((state: EditorState) => Transaction)[] = [
      // A shortcode finished by typing its closing colon, in a block of its own.
      (state) => state.tr.insertText(' :tada', at(state, 'Three.') + 5),
      (state) => state.tr.insertText(':', at(state, ':tada') + 5),
      // A shortcode made code, which is not drawn, and the first block deleted.
      (state) => state.tr.addMark(at(state, ':airbnb:'), at(state, ':airbnb:') + 8, code.create()),
      (state) => state.tr.delete(0, state.doc.child(0).nodeSize),
      // The caret moved onto a shortcode, which shows its text.
      (state) => state.tr.setSelection(TextSelection.create(state.doc, at(state, ':tada:') + 2)),
    ]
    for (const edit of edits) {
      editor.view.dispatch(edit(editor.state))
      expect(drawn(editor.state)).toEqual(expected(editor.state))
    }
    expect(drawn(editor.state)).toEqual([])
    editor.destroy()
  })

  it('draws nothing once torn down before the table arrives', async () => {
    const editor = new Editor({
      extensions: buildExtensions(),
      content: harness.state(':tada:\n').doc.toJSON(),
    })
    editor.destroy()
    await loadStandardEmoji()
    expect(editor.isDestroyed).toBe(true)
  })
})
