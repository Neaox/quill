import { Editor } from '@tiptap/core'
import { closeHistory, undo } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { buildExtensions } from '../document/extensions.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { showLinkAs } from './link-display.ts'
import { linkOfferAt, pasteAddress, withdrawLinkOffer } from './link-offer.ts'

const harness = createEditorTestHarness()
const editors: Editor[] = []
const ADDRESS = 'https://blog.example/post'

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function open(markdown: string) {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: buildExtensions({ files: { onFiles: () => undefined } }),
    content: harness.state(markdown).doc.toJSON(),
  })
  editors.push(editor)
  return editor
}

function markdownOf(editor: Editor): string {
  return harness.read(documentToMdast(editor.state.doc).tree).trim()
}

/** An editor with the address pasted at the end of "See ". */
function pasted() {
  const editor = open('See')
  editor.commands.focus('end')
  editor.commands.insertContent(' ')
  pasteAddress(ADDRESS)(editor.state, editor.view.dispatch)
  return editor
}

function caretAt(editor: Editor, position: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)),
  )
}

describe('pasting an address', () => {
  it('inserts the link at once, its words the address', () => {
    expect(markdownOf(pasted())).toBe(`See <${ADDRESS}>`)
  })

  it('says it can be pasted without pasting, when only asked', () => {
    const editor = open('See ')
    const before = editor.state.doc
    expect(pasteAddress(ADDRESS)(editor.state, undefined)).toBe(true)
    expect(editor.state.doc).toBe(before)
  })

  it('offers to show it another way, over the link it just made', () => {
    const offer = linkOfferAt(pasted().state)
    expect(offer?.to).toBe((offer?.from ?? 0) + ADDRESS.length)
  })

  it('keeps the offer while the caret stays in the link', () => {
    const editor = pasted()
    caretAt(editor, (linkOfferAt(editor.state)?.from ?? 0) + 3)
    expect(linkOfferAt(editor.state)).not.toBeNull()
  })

  it('withdraws it when the author types', () => {
    const editor = pasted()
    editor.commands.insertContent(' and')
    expect(linkOfferAt(editor.state)).toBeNull()
  })

  it('withdraws it when the caret moves away', () => {
    const editor = pasted()
    caretAt(editor, 1)
    expect(linkOfferAt(editor.state)).toBeNull()
  })

  it('withdraws it on Escape, and says so only when there was one to withdraw', () => {
    const editor = pasted()
    expect(withdrawLinkOffer(editor.state, editor.view.dispatch)).toBe(true)
    expect(linkOfferAt(editor.state)).toBeNull()
    expect(withdrawLinkOffer(editor.state)).toBe(false)
  })

  it('is spent by taking the offer, and one undo gives the plain link back', () => {
    const editor = pasted()
    // The author takes the offer a moment later, which is a separate step of history.
    editor.view.dispatch(closeHistory(editor.state.tr))
    caretAt(editor, (linkOfferAt(editor.state)?.from ?? 0) + 2)
    showLinkAs('inline')(editor.state, editor.view.dispatch)
    expect(markdownOf(editor)).toContain(`<${ADDRESS}><!-- quill:link display=inline -->`)
    expect(linkOfferAt(editor.state)).toBeNull()
    undo(editor.state, editor.view.dispatch)
    expect(markdownOf(editor)).toBe(`See <${ADDRESS}>`)
  })
})
