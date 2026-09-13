import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import {
  blockWidth,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  setBlockWidth,
  supportsWidth,
  topLevelBlock,
} from './commands.ts'

const harness = createEditorTestHarness()

const DOCUMENT = ['First.', '', 'Second.', '', '---', '', 'Third.', ''].join('\n')

/** Puts the caret in the nth top-level block. */
function caretIn(state: EditorState, index: number): EditorState {
  let pos = 0
  state.doc.forEach((node, offset, childIndex) => {
    if (childIndex === index) pos = offset + 1
  })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

function apply(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const ran = command(state, (tr) => {
    next = state.apply(tr)
  })
  return ran ? next : null
}

function text(state: EditorState | null): readonly string[] {
  if (state === null) throw new Error('The command declined to run.')
  return state.doc.children.map((child) => child.textContent)
}

describe('the commands behind a block menu', () => {
  it('finds the top-level block the caret is in', () => {
    const block = topLevelBlock(caretIn(harness.state(DOCUMENT), 1))
    expect(block?.index).toBe(1)
    expect(block?.node.textContent).toBe('Second.')
  })

  it('finds the block a node selection has selected', () => {
    const state = harness.state(DOCUMENT)
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))
    expect(topLevelBlock(selected)?.index).toBe(0)
  })

  it('has no block when the selection is the whole document', () => {
    const state = harness.state(DOCUMENT)
    const whole = state.apply(state.tr.setSelection(new AllSelection(state.doc)))
    expect(topLevelBlock(whole)).toBeNull()
  })

  it('knows which blocks can carry a width, and which width they carry', () => {
    const state = harness.state(':::wide\nWide.\n:::\n')
    const block = topLevelBlock(caretIn(state, 0))
    expect(block === null ? null : supportsWidth(block.node)).toBe(true)
    expect(block === null ? null : blockWidth(block.node)).toBe('wide')
  })

  it('sets a width, and writes the default width as no wrapper at all', () => {
    const start = caretIn(harness.state('A table paragraph.\n'), 0)
    const wide = apply(start, setBlockWidth('wide'))
    expect(wide?.doc.firstChild?.attrs['layout']).toBe('wide')
    if (wide === null) throw new Error('Setting a width declined.')
    expect(harness.read(documentToMdast(wide.doc).tree)).toContain(':::wide')

    const back = apply(caretIn(wide, 0), setBlockWidth('content'))
    if (back === null) throw new Error('Clearing a width declined.')
    expect(harness.read(documentToMdast(back.doc).tree)).not.toContain(':::')
  })

  it('declines to set a width that is already set', () => {
    const start = caretIn(harness.state(':::wide\nWide.\n:::\n'), 0)
    expect(apply(start, setBlockWidth('wide'))).toBeNull()
  })

  it('declines to set a width on a block that cannot carry one', () => {
    const state = harness.state('---\ntitle: A\n---\n\nText.\n')
    const onFrontMatter = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))
    expect(supportsWidth(state.doc.child(0))).toBe(false)
    expect(apply(onFrontMatter, setBlockWidth('wide'))).toBeNull()
  })

  it('moves a block up and down, and declines at the ends', () => {
    const start = harness.state(DOCUMENT)
    expect(text(apply(caretIn(start, 1), moveBlock(-1)))).toEqual([
      'Second.',
      'First.',
      '',
      'Third.',
    ])
    expect(text(apply(caretIn(start, 0), moveBlock(1)))).toEqual([
      'Second.',
      'First.',
      '',
      'Third.',
    ])
    expect(apply(caretIn(start, 0), moveBlock(-1))).toBeNull()
    expect(apply(caretIn(start, 3), moveBlock(1))).toBeNull()
  })

  it('duplicates a block directly after itself', () => {
    expect(text(apply(caretIn(harness.state(DOCUMENT), 0), duplicateBlock))).toEqual([
      'First.',
      'First.',
      'Second.',
      '',
      'Third.',
    ])
  })

  it('deletes a block, but never the last one', () => {
    expect(text(apply(caretIn(harness.state(DOCUMENT), 1), deleteBlock))).toEqual([
      'First.',
      '',
      'Third.',
    ])
    expect(apply(caretIn(harness.state('Only.\n'), 0), deleteBlock)).toBeNull()
  })

  it('reports rather than acts when asked without a dispatch', () => {
    const start = caretIn(harness.state(DOCUMENT), 1)
    expect(moveBlock(-1)(start)).toBe(true)
    expect(deleteBlock(start)).toBe(true)
    expect(duplicateBlock(start)).toBe(true)
    expect(setBlockWidth('full')(start)).toBe(true)
  })
})
