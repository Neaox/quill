import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { nodeType } from '../schema/node-type.ts'
import {
  insertBlock,
  insertFootnote,
  insertInline,
  insertShortcode,
  insertText,
  paragraph,
} from './slash-commands.ts'

const harness = createEditorTestHarness()
const NL = String.fromCharCode(10)

/** What the command writes, and where the caret is in the line afterwards. */
function inserted(source: string, from: number) {
  const opened = harness.state(source)
  const state = opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, from)))
  let next: EditorState | undefined
  insertShortcode('tada')(state, (tr) => {
    next = state.apply(tr)
  })
  if (next === undefined) throw new Error('The command did not run.')
  const { $from } = next.selection
  return {
    line: $from.parent.textContent,
    before: $from.parent.textBetween(0, $from.parentOffset),
    markdown: harness.read(documentToMdast(next.doc).tree),
  }
}

describe('writing an emoji’s shortcode', () => {
  it('puts it at the caret and leaves the caret after it at the end of a line, where no space is written', () => {
    expect(inserted('Ship it', 8)).toMatchObject({ line: 'Ship it:tada:', before: 'Ship it:tada:' })
    expect(inserted('Ship it', 8).markdown).toBe('Ship it:tada:' + NL)
  })

  it('goes past the space that is already there, so the emoji is drawn at once', () => {
    expect(inserted('Ship  now', 6)).toMatchObject({
      line: 'Ship :tada: now',
      before: 'Ship :tada: ',
    })
  })

  it('adds a space where words follow with none, and goes past it', () => {
    expect(inserted('Shipnow', 5)).toMatchObject({ line: 'Ship:tada: now', before: 'Ship:tada: ' })
  })

  it('says it could run without running, and declines where there is no line to write in', () => {
    const state = harness.state('| a | b |' + NL + '| - | - |' + NL + '| c | d |' + NL)
    expect(
      insertShortcode('tada')(
        state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4))),
      ),
    ).toBe(true)
    expect(
      insertShortcode('tada')(
        state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0))),
      ),
    ).toBe(false)
  })
})

describe('typing text at the caret', () => {
  it('writes it where there is a line to write in, and declines on a selected block', () => {
    const state = harness.state('| a | b |' + NL + '| - | - |' + NL + '| c | d |' + NL)
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))

    expect(insertText(':')(selected)).toBe(false)
    expect(
      insertText(':')(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)))),
    ).toBe(true)
  })
})

describe('what cannot be inserted where the caret is', () => {
  const inCode = (): EditorState => {
    const opened = harness.state('```' + NL + 'code' + NL + '```' + NL)
    return opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, 2)))
  }
  const onBlock = (): EditorState => {
    const opened = harness.state('---' + NL)
    return opened.apply(opened.tr.setSelection(NodeSelection.create(opened.doc, 0)))
  }

  it('is not a block when the caret is not in a line of text', () => {
    expect(insertBlock((schema) => paragraph(schema, 'x'))(onBlock())).toBe(false)
  })

  it('is not an inline node in a code block, which holds only text', () => {
    const emoji = insertInline((schema) =>
      nodeType(schema, 'footnoteReference').create({ identifier: '1' }),
    )
    expect(emoji(inCode())).toBe(false)
  })

  it('is not a footnote in a code block either', () => {
    expect(insertFootnote('Note')(inCode())).toBe(false)
  })
})
