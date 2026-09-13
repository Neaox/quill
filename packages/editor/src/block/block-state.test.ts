import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import {
  BLOCK_ACTIONS,
  BLOCK_WIDTHS,
  blockLabel,
  describeBlockMenu,
  widthLabel,
} from './block-state.ts'

const harness = createEditorTestHarness()

function caretIn(state: EditorState, index: number): EditorState {
  let pos = 0
  state.doc.forEach((node, offset, childIndex) => {
    if (childIndex === index) pos = offset + 1
  })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

describe('what the block menu shows', () => {
  it('offers the three widths of ADR-027, in reading order', () => {
    expect(BLOCK_WIDTHS).toEqual(['content', 'wide', 'full'])
    expect(BLOCK_WIDTHS.map(widthLabel)).toEqual(['Content', 'Wide', 'Full'])
  })

  it('offers move, duplicate and delete', () => {
    expect(BLOCK_ACTIONS.map((action) => action.id)).toEqual([
      'move-up',
      'move-down',
      'duplicate',
      'delete',
    ])
  })

  it('calls a block what the author calls it', () => {
    const state = harness.state('```ts\nx\n```\n')
    expect(blockLabel(state.doc.child(0))).toBe('Code block')
  })

  it('calls a directive by its own name', () => {
    const state = harness.state(':::callout{type="tip"}\nA tip.\n:::\n')
    expect(blockLabel(state.doc.child(0))).toBe('Callout')
  })

  it('describes the block the caret is in, with each action answering for itself', () => {
    const state = caretIn(harness.state('First.\n\nSecond.\n'), 0)
    const description = describeBlockMenu(state)
    expect(description).toMatchObject({
      label: 'Paragraph',
      width: 'content',
      canSetWidth: true,
      enabled: { 'move-up': false, 'move-down': true, duplicate: true, delete: true },
    })
  })

  it('changes its key exactly when its appearance changes', () => {
    const document = 'First.\n\nSecond.\n'
    const first = describeBlockMenu(caretIn(harness.state(document), 0))
    const second = describeBlockMenu(caretIn(harness.state(document), 1))
    expect(first?.key).not.toBe(second?.key)
  })

  it('reports the range a comment would be anchored to', () => {
    const state = caretIn(harness.state('Anchor me.\n'), 0)
    const description = describeBlockMenu(state)
    expect(state.doc.textBetween(description?.from ?? 0, description?.to ?? 0, ' ')).toContain(
      'Anchor me.',
    )
  })

  it('describes a block that cannot carry a width as one that cannot', () => {
    const state = harness.state('---\ntitle: A\n---\n\nText.\n')
    const onFrontMatter = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))
    expect(describeBlockMenu(onFrontMatter)?.canSetWidth).toBe(false)
  })

  it('has nothing to describe when the selection is the whole document', () => {
    const state = harness.state('Text.\n')
    const whole = state.apply(state.tr.setSelection(new AllSelection(state.doc)))
    expect(describeBlockMenu(whole)).toBeNull()
  })
})
