import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { actionState } from './editor-action.ts'
import type { EditorAction } from './editor-action.ts'
import {
  CARD_IMAGE,
  CARD_LAYOUT_GROUP,
  LINK_DISPLAY_GROUP,
  linkDisplayAction,
} from './link-display-actions.ts'

const harness = createEditorTestHarness()

function caretIn(markdown: string, needle: string): EditorState {
  const opened = harness.state(markdown)
  let found = -1
  opened.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(needle) === true) found = pos + 1
    return found < 0
  })
  return opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, found)))
}

function selectCard(markdown: string): EditorState {
  const opened = harness.state(markdown)
  let found = -1
  opened.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'leafDirective') found = pos
    return found < 0
  })
  return opened.apply(opened.tr.setSelection(NodeSelection.create(opened.doc, found)))
}

function apply(state: EditorState, action: EditorAction): string {
  let next = state
  action.command(state, (tr) => {
    next = state.apply(tr)
  })
  return harness.read(documentToMdast(next.doc).tree).trim()
}

const PLAIN = 'See [the doc](https://blog.example/post).'
const CARD = '::link{url="https://blog.example/post" display=card}'

describe('the link display actions', () => {
  it('offers a plain link, an inline link and a card, and not embed until there is somewhere to embed from', () => {
    expect(LINK_DISPLAY_GROUP.actions.map((action) => action.label)).toEqual([
      'Link',
      'Inline',
      'Compact',
      'Card',
    ])
    expect(LINK_DISPLAY_GROUP.actions.every((action) => action.kind === 'radio')).toBe(true)
  })

  it('marks the one in force as chosen, and offers the others', () => {
    const state = caretIn(PLAIN, 'doc')
    const states = LINK_DISPLAY_GROUP.actions.map((action) => actionState(action, state))
    expect(states.map((entry) => entry.checked)).toEqual([true, false, false, false])
    expect(states.every((entry) => entry.enabled)).toBe(true)
  })

  it('shows a card as chosen when one is selected', () => {
    const state = selectCard(CARD)
    expect(LINK_DISPLAY_GROUP.actions.map((action) => actionState(action, state).checked)).toEqual([
      false,
      false,
      false,
      true,
    ])
  })

  it('changes the display when one is chosen', () => {
    expect(apply(caretIn(PLAIN, 'doc'), linkDisplayAction('inline'))).toBe(
      'See :link[the doc]{url="https://blog.example/post" display="inline"}.',
    )
  })

  it('offers nothing away from a link', () => {
    const state = caretIn('Just words.', 'words')
    expect(LINK_DISPLAY_GROUP.actions.some((action) => actionState(action, state).enabled)).toBe(
      false,
    )
  })

  it('says why a card cannot be made where the line cannot be split', () => {
    const card = linkDisplayAction('card')
    const inHeading = caretIn('# A [heading link](https://blog.example/post)', 'heading')
    expect(actionState(card, inHeading).enabled).toBe(false)
    expect(card.whyUnavailable?.(inHeading)).toMatch(/line of its own/u)
    expect(card.whyUnavailable?.(caretIn(PLAIN, 'doc'))).toBeUndefined()
  })

  it('offers a card its layout, which is chosen and written back', () => {
    const state = selectCard(CARD)
    const [side, top] = CARD_LAYOUT_GROUP.actions
    expect(side?.label).toBe('Image beside')
    expect(top?.label).toBe('Image above')
    expect(actionState(side as EditorAction, state).checked).toBe(true)
    expect(apply(state, top as EditorAction)).toContain('layout="top"')
  })

  it('offers a card its image, which can be taken away and put back', () => {
    const state = selectCard(CARD)
    expect(actionState(CARD_IMAGE, state).checked).toBe(true)
    const without = apply(state, CARD_IMAGE)
    expect(without).toContain('image="none"')
    expect(actionState(CARD_IMAGE, selectCard(without)).checked).toBe(false)
    expect(apply(selectCard(without), CARD_IMAGE)).not.toContain('image=')
  })

  it('offers the card’s own choices nowhere else', () => {
    const state = caretIn(PLAIN, 'doc')
    expect(actionState(CARD_IMAGE, state).enabled).toBe(false)
    expect(CARD_LAYOUT_GROUP.actions.some((action) => actionState(action, state).enabled)).toBe(
      false,
    )
  })
})
