import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { changedBlocks, redecorateChangedBlocks } from './changed-blocks.ts'

const harness = createEditorTestHarness()
const SOURCE = '# One\n\nTwo words.\n\nThree words.\n\nFour words.\n'

/** Where each top-level block starts and ends, by its text. */
function blocks(doc: PMNode): Readonly<Record<string, { from: number; to: number }>> {
  const found: Record<string, { from: number; to: number }> = {}
  doc.forEach((node, offset) => {
    found[node.textContent] = { from: offset, to: offset + node.nodeSize }
  })
  return found
}

function inside(state: { readonly doc: PMNode }, text: string): number {
  const block = blocks(state.doc)[text]
  if (block === undefined) throw new Error(`No block reads “${text}”.`)
  return block.from + 1
}

describe('the blocks a transaction changed', () => {
  it('is nothing when the document did not change', () => {
    const state = harness.state(SOURCE)
    expect(changedBlocks(state.tr.setMeta('x', 1))).toEqual([])
  })

  it('is the one block a keystroke landed in', () => {
    const state = harness.state(SOURCE)
    const tr = state.tr.insertText('x', inside(state, 'Three words.'))
    expect(changedBlocks(tr)).toEqual([blocks(tr.doc)['xThree words.']])
  })

  it('maps an earlier step’s block through the steps after it', () => {
    const state = harness.state(SOURCE)
    const tr = state.tr.insertText('x', inside(state, 'Four words.'))
    tr.insertText('yy', inside(state, 'Two words.'))
    const after = blocks(tr.doc)
    expect(changedBlocks(tr)).toEqual([after['yyTwo words.'], after['xFour words.']])
  })

  it('merges neighbouring and overlapping blocks into one range', () => {
    const state = harness.state(SOURCE)
    const two = inside(state, 'Two words.')
    const tr = state.tr.insertText('a', two).insertText('b', two)
    tr.insertText('c', inside(tr, 'Three words.'))
    const after = blocks(tr.doc)
    expect(changedBlocks(tr)).toEqual([
      { from: after['baTwo words.']?.from, to: after['cThree words.']?.to },
    ])
  })

  it('takes in the block after a new one, and reaches the end of the document', () => {
    const state = harness.state(SOURCE)
    const end = state.doc.content.size
    const paragraph = state.schema.nodes['paragraph']?.create(null, state.schema.text('Five'))
    if (paragraph === undefined) throw new Error('No paragraph type.')
    const tr = state.tr.insert(end, paragraph)
    expect(changedBlocks(tr)).toEqual([{ from: end, to: tr.doc.content.size }])
  })

  it('finds a mark, which moves no positions, by its range', () => {
    const state = harness.state(SOURCE)
    const from = inside(state, 'Three words.')
    const bold = state.schema.marks['bold']
    if (bold === undefined) throw new Error('No bold mark.')
    const added = state.tr.addMark(from, from + 5, bold.create())
    expect(changedBlocks(added)).toEqual([blocks(added.doc)['Three words.']])
    const removed = harness.state('Two **words**.\n\nThree.\n').tr.removeMark(1, 10, bold)
    expect(changedBlocks(removed)).toEqual([blocks(removed.doc)['Two words.']])
  })

  it('finds a changed attribute by the node it belongs to', () => {
    const state = harness.state(SOURCE)
    const heading = blocks(state.doc)['One']
    if (heading === undefined) throw new Error('No heading.')
    const tr = state.tr.setNodeAttribute(heading.from, 'level', 2)
    expect(changedBlocks(tr)).toEqual([heading])
  })

  it('is the whole document for a step it cannot place', () => {
    const state = harness.state(SOURCE)
    const tr = state.tr.setDocAttribute('anything', 1)
    expect(changedBlocks(tr)).toEqual([{ from: 0, to: tr.doc.content.size }])
  })
})

/** A widget on each block whose text starts with “x”, so a test can see what was redone. */
function decorateX(doc: PMNode, from: number, to: number): readonly Decoration[] {
  const found: Decoration[] = []
  doc.nodesBetween(from, to, (node, position) => {
    if (node.textContent.startsWith('x'))
      found.push(Decoration.widget(position + 1, () => document.createElement('i')))
    return false
  })
  return found
}

function redecorate(state: EditorState, edit: (tr: Transaction) => Transaction) {
  const before = DecorationSet.create(state.doc, [
    ...decorateX(state.doc, 0, state.doc.content.size),
  ])
  const tr = edit(state.tr)
  const incremental = redecorateChangedBlocks(before, tr, decorateX)
  const full = DecorationSet.create(tr.doc, [...decorateX(tr.doc, 0, tr.doc.content.size)])
  return { incremental, full, before }
}

const positions = (set: DecorationSet) => set.find().map((decoration) => decoration.from)

describe('redecorating only the changed blocks', () => {
  it('gives the same set a full rebuild would', () => {
    const state = harness.state('xOne\n\nTwo\n\nxThree\n\nFour\n')
    const { incremental, full } = redecorate(state, (tr) => {
      tr.insertText('x', inside(state, 'Two'))
      const three = inside(tr, 'xThree')
      return tr.delete(three, three + 1)
    })
    expect(positions(incremental)).toEqual(positions(full))
    expect(positions(full)).toHaveLength(2)
  })

  it('keeps the set it was given when the document did not change', () => {
    const state = harness.state('xOne\n')
    const { incremental, before } = redecorate(state, (tr) => tr.setMeta('x', 1))
    expect(incremental).toBe(before)
  })
})
