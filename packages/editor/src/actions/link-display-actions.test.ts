import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { linkEmbedsPlugin, recordLinkEmbed } from '../link/link-embeds.ts'
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
const CARD = '<https://blog.example/post> <!-- quill:link display=card -->'

describe('the link display actions', () => {
  it('lists every way a link can be shown, embed last', () => {
    expect(LINK_DISPLAY_GROUP.actions.map((action) => action.label)).toEqual([
      'Link',
      'Inline',
      'Compact',
      'Card',
      'Embed',
    ])
    expect(LINK_DISPLAY_GROUP.actions.every((action) => action.kind === 'radio')).toBe(true)
  })

  it('marks the one in force as chosen, and offers the others', () => {
    const state = caretIn(PLAIN, 'doc')
    const states = LINK_DISPLAY_GROUP.actions.map((action) => actionState(action, state))
    expect(states.map((entry) => entry.checked)).toEqual([true, false, false, false, false])
    // Everything but embed, which needs a page that can be embedded.
    expect(states.map((entry) => entry.enabled)).toEqual([true, true, true, true, false])
  })

  it('shows a card as chosen when one is selected', () => {
    const state = selectCard(CARD)
    expect(LINK_DISPLAY_GROUP.actions.map((action) => actionState(action, state).checked)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ])
  })

  it('changes the display when one is chosen', () => {
    expect(apply(caretIn(PLAIN, 'doc'), linkDisplayAction('inline'))).toBe(
      'See [the doc](https://blog.example/post)<!-- quill:link display=inline -->.',
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

  describe('Embed', () => {
    const ADDRESS = 'https://blog.example/post'
    const embed = linkDisplayAction('embed')

    function told(state: EditorState, hint = { provider: 'YouTube', aspectRatio: 16 / 9 }) {
      const plugged = EditorState.create({
        doc: state.doc,
        selection: state.selection,
        plugins: [linkEmbedsPlugin()],
      })
      const record = recordLinkEmbed(plugged, ADDRESS, hint)
      return record === null ? plugged : plugged.apply(record)
    }

    it('is available for a link whose page can be embedded, and writes the embed', () => {
      const state = told(caretIn(PLAIN, 'doc'))
      expect(actionState(embed, state).enabled).toBe(true)
      expect(embed.whyUnavailable?.(state)).toBeUndefined()
      expect(apply(state, embed)).toContain(
        '[the doc](https://blog.example/post) <!-- quill:link display=embed -->',
      )
    })

    it('is disabled for a page that cannot be, and says so', () => {
      const state = caretIn(PLAIN, 'doc')
      expect(actionState(embed, state).enabled).toBe(false)
      expect(embed.whyUnavailable?.(state)).toMatch(/cannot be embedded/u)
    })

    it('says a line of its own is needed where the link sits in a heading', () => {
      const state = told(caretIn('# A [heading link](https://blog.example/post)', 'heading'))
      expect(actionState(embed, state).enabled).toBe(false)
      expect(embed.whyUnavailable?.(state)).toMatch(/line of its own/u)
    })

    it('is shown as chosen on an embed, and a card can be chosen from it', () => {
      const state = told(
        selectCard('<https://blog.example/post> <!-- quill:link display=embed -->'),
      )
      expect(actionState(embed, state).checked).toBe(true)
      expect(apply(state, linkDisplayAction('card'))).toContain('display=card')
    })

    it('has nothing to say away from a link', () => {
      expect(embed.whyUnavailable?.(caretIn('Just words.', 'words'))).toBeUndefined()
    })
  })

  it('offers a card its layout, which is chosen and written back', () => {
    const state = selectCard(CARD)
    const [side, top] = CARD_LAYOUT_GROUP.actions
    expect(side?.label).toBe('Image beside')
    expect(top?.label).toBe('Image above')
    expect(actionState(side as EditorAction, state).checked).toBe(true)
    expect(apply(state, top as EditorAction)).toContain('layout=top')
  })

  it('offers a card its image, which can be taken away and put back', () => {
    const state = selectCard(CARD)
    expect(actionState(CARD_IMAGE, state).checked).toBe(true)
    const without = apply(state, CARD_IMAGE)
    expect(without).toContain('image=none')
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
