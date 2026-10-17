import { serializeDocument } from '@quill/markdown'
import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { documentToMdast } from './ast.ts'
import { markdownFragment, replaceSelectionWithFragment } from './commands.ts'
import { cancelLanding, insertBatch, mapLanding, prepareLanding } from './paste-landing.ts'
import type { Landing } from './paste-landing.ts'

/**
 * Where a large paste lands, as transactions on a state (quill-plan.md
 * section 31). The paste arrives in batches; landed one after another, they
 * must leave the document exactly as one paste of the whole would, and a
 * cancelled paste must leave it as it was.
 */

const harness = createEditorTestHarness()

function written(doc: PMNode): string {
  return serializeDocument({ frontMatter: {}, ast: documentToMdast(doc).tree })
}

function at(markdown: string, from: number, to = from): EditorState {
  const state = harness.state(markdown)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
}

/** A paragraph of text and an empty one after it, the caret in the empty one. */
function inEmptyParagraph(): EditorState {
  const state = harness.state('Text.\n')
  const end = state.doc.content.size
  const tr = state.tr.insert(end, state.schema.nodes['paragraph']?.create() ?? [])
  return state.apply(tr.setSelection(TextSelection.create(tr.doc, end + 1)))
}

const EMPTY_PARAGRAPH = -1

const PASTE = '## Pasted\n\nOne.\n\n- a\n- b\n\nTwo.\n'

/** Lands `markdown` in batches of `size` blocks, as the paste handler does. */
function landInBatches(
  state: EditorState,
  markdown: string,
  size: number,
): { doc: PMNode; landing: Landing } {
  const blocks: PMNode[] = []
  markdownFragment(markdown, state.schema).forEach((block) => blocks.push(block))
  const tr = state.tr
  let landing = prepareLanding(tr)
  for (let start = 0; start < blocks.length; start += size) {
    landing = insertBatch(tr, landing, Fragment.from(blocks.slice(start, start + size)))
  }
  return { doc: tr.doc, landing }
}

/** The same paste, all at once, as a small paste is made. */
function wholePaste(state: EditorState, markdown: string): PMNode {
  return replaceSelectionWithFragment(state.tr, markdownFragment(markdown, state.schema)).doc
}

describe('landing a paste in batches', () => {
  it.each([
    ['in the middle of a paragraph', 'Before after.\n', 8, 8],
    ['at the start of a paragraph', 'Text.\n', 1, 1],
    ['at the end of a paragraph', 'Text.\n', 6, 6],
    ['in an empty paragraph', '', EMPTY_PARAGRAPH, EMPTY_PARAGRAPH],
    ['over a selection', 'Keep this, drop that, keep.\n', 12, 22],
    ['in an empty document', '', 1, 1],
  ])('leaves the document as one paste of the whole would, %s', (_where, markdown, from, to) => {
    const state = from === EMPTY_PARAGRAPH ? inEmptyParagraph() : at(markdown, from, to)
    const whole = wholePaste(state, PASTE)
    for (const size of [1, 2, 100]) {
      expect(written(landInBatches(state, PASTE, size).doc)).toBe(written(whole))
    }
  })

  it('lands in a list item after its paragraph, where blocks may go', () => {
    const state = at('- item\n', 7)
    expect(written(landInBatches(state, PASTE, 1).doc)).toBe(written(wholePaste(state, PASTE)))
  })

  it('climbs out of a container that cannot hold the blocks', () => {
    // A list item must start with a paragraph, so a heading cannot go first in one.
    const state = at('- item\n', 3)
    const { doc } = landInBatches(state, '## Heading\n\nText.\n', 1)
    expect(written(doc)).toContain('## Heading')
    expect(doc.check()).toBeUndefined()
  })

  it('knows where the landed blocks start and end, and how many there are', () => {
    const state = at('Before after.\n', 8)
    const { doc, landing } = landInBatches(state, PASTE, 2)
    expect(landing.blocks).toBe(4)
    expect(doc.slice(landing.from, landing.at).content.childCount).toBe(4)
    expect(doc.nodeAt(landing.from)?.type.name).toBe('heading')
  })

  it('keeps its place through edits before and after it', () => {
    const state = at('Before after.\n', 8)
    const tr = state.tr
    let landing = prepareLanding(tr)
    landing = insertBatch(tr, landing, markdownFragment('## One\n', state.schema))
    // Typing before the paste moves it; typing right after it stays after it.
    const typed = tr.insertText('Just ', 1)
    landing = mapLanding(landing, typed.mapping.slice(typed.mapping.maps.length - 1))
    const end = tr.doc.resolve(landing.at)
    tr.insertText('!', end.pos + 1)
    landing = mapLanding(landing, tr.mapping.slice(tr.mapping.maps.length - 1))
    landing = insertBatch(tr, landing, markdownFragment('## Two\n', state.schema))
    expect(tr.doc.textBetween(0, tr.doc.content.size, '|')).toBe('Just Before |One|Two|!after.')
  })

  it('does not replace a paragraph that was written in while the paste was on its way', () => {
    const state = inEmptyParagraph()
    const tr = state.tr
    let landing = prepareLanding(tr)
    tr.insertText('Typed', landing.at + 1)
    landing = mapLanding(landing, tr.mapping)
    landing = insertBatch(tr, landing, markdownFragment('## Pasted\n', state.schema))
    expect(written(tr.doc)).toContain('## Pasted')
    expect(written(tr.doc)).toContain('Typed')
  })
})

describe('landing a paste where the caret is between blocks', () => {
  it('lands at the gap itself, splitting nothing', () => {
    // Two rules, and the caret in the gap between them.
    const state = harness.state('***\n\n***\n')
    const between = state.doc.child(0).nodeSize
    const tr = state.tr.setSelection(new GapCursor(state.doc.resolve(between)))
    const landing = prepareLanding(tr)
    expect(landing).toEqual(expect.objectContaining({ at: between, split: false }))
    const landed = insertBatch(tr, landing, markdownFragment('## Between\n', state.schema))
    const kinds: string[] = []
    tr.doc.forEach((block) => kinds.push(block.type.name))
    expect(kinds).toEqual(['horizontalRule', 'heading', 'horizontalRule'])
    expect(landed.blocks).toBe(1)
  })
})

describe('cancelling a paste', () => {
  it.each([
    ['in the middle of a paragraph', 'Before after.\n', 8, 8],
    ['in an empty paragraph', '', EMPTY_PARAGRAPH, EMPTY_PARAGRAPH],
    ['in an empty document', '', 1, 1],
    ['at the end of a paragraph', 'Text.\n', 6, 6],
  ])('puts the document back as it was, %s', (_where, markdown, from, to) => {
    const state = from === EMPTY_PARAGRAPH ? inEmptyParagraph() : at(markdown, from, to)
    const { doc, landing } = landInBatches(state, PASTE, 2)
    const tr = state.apply(state.tr.replaceWith(0, state.doc.content.size, doc.content)).tr
    cancelLanding(tr, landing)
    expect(written(tr.doc)).toBe(written(state.doc))
  })

  it('puts back a split paragraph even when nothing had landed', () => {
    const state = at('Before after.\n', 8)
    const tr = state.tr
    const landing = prepareLanding(tr)
    cancelLanding(tr, landing)
    expect(written(tr.doc)).toBe('Before after.\n')
  })
})
