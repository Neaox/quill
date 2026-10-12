import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { leaveEnd, leaveStart } from './exit-block.ts'

import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'

import { createEditorTestHarness } from '../testing/harness.ts'
import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'

const lines = (...rows: string[]): string => `${rows.join('\n')}\n`

const NOTES_LAST = lines('Some words.', '', ':::notes', 'Pause after the table.', ':::')
const NOTES_FIRST = lines(':::notes', 'Pause after the table.', ':::', '', 'Some words.')
const NOTES_MIDDLE = lines('Before.', '', ':::notes', 'Pause.', ':::', '', 'After.')

async function openWithCaret(source: string, at: 'start' | 'end') {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('textbox', { name: 'Document' }))
  act(() => {
    ref.current?.editor?.commands.focus(at)
  })
  const written = () => {
    const handle = ref.current
    if (handle === null) throw new Error('No editor.')
    return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
  }
  return { user, written }
}

describe('leaving a block that has the end of the document', () => {
  it.each(['{ArrowDown}', '{ArrowRight}'])(
    'takes %s out of a last block to a new line after it, where typing goes outside it',
    async (key) => {
      const { user, written } = await openWithCaret(NOTES_LAST, 'end')

      await user.keyboard(`${key}after`)

      expect(written()).toBe(
        lines('Some words.', '', ':::notes', 'Pause after the table.', ':::', '', 'after'),
      )
    },
  )

  it('leaves the document as it was when the key only moves the caret within the block', async () => {
    const { user, written } = await openWithCaret(NOTES_LAST, 'end')

    await user.keyboard('{ArrowLeft}')

    expect(written()).toBe(NOTES_LAST)
  })

  it.each(['{ArrowUp}', '{ArrowLeft}'])(
    'takes %s out of a first block to a new line before it',
    async (key) => {
      const { user, written } = await openWithCaret(NOTES_FIRST, 'start')

      await user.keyboard(`${key}before`)

      expect(written()).toBe(
        lines('before', '', ':::notes', 'Pause after the table.', ':::', '', 'Some words.'),
      )
    },
  )

  it('does not add a line where the key goes on into the next block anyway', async () => {
    const { user, written } = await openWithCaret(NOTES_MIDDLE, 'end')
    // The caret at the very end of the document, after "After.", then up into the block above.
    await user.keyboard('{ArrowDown}')

    expect(written()).toBe(NOTES_MIDDLE)
  })

  it('does not add a second line when there is already one to go to', async () => {
    const { user, written } = await openWithCaret(NOTES_LAST, 'end')

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowDown}')

    // The one empty line the first press made is all there is, and the Markdown ends where it did.
    expect(written().trimEnd()).toBe(NOTES_LAST.trimEnd())
  })
})

describe('leaving a block, asked of the command itself', () => {
  const harness = createEditorTestHarness()
  const NL = String.fromCharCode(10)
  const at = (source: string, from: number, to = from): EditorState => {
    const state = harness.state(source)
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
  }
  // `:::notes` holds "Speak slowly": the block opens at 0, its text at 2 to 14.
  const NOTES = ':::notes' + NL + 'Speak slowly' + NL + ':::' + NL

  it('says it would run without running, where a line could be added', () => {
    expect(leaveEnd('right')(at(NOTES, 14))).toBe(true)
    expect(leaveStart('left')(at(NOTES, 2))).toBe(true)
  })

  it('leaves a range of text alone, which a key would only collapse', () => {
    expect(leaveEnd('right')(at(NOTES, 8, 14))).toBe(false)
    expect(leaveStart('left')(at(NOTES, 2, 8))).toBe(false)
  })

  it('has nothing to leave from a paragraph that is itself the first or last block', () => {
    expect(leaveEnd('right')(at('Only words' + NL, 11))).toBe(false)
    expect(leaveStart('left')(at('Only words' + NL, 1))).toBe(false)
  })

  it('leaves a key that only moves the caret within the block to the browser', () => {
    expect(leaveEnd('right')(at(NOTES, 8))).toBe(false)
    expect(leaveStart('left')(at(NOTES, 8))).toBe(false)
  })

  it('leaves a selected block to the key, which is not a caret in its text', () => {
    const state = harness.state(NOTES)
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))

    expect(leaveEnd('right')(selected)).toBe(false)
    expect(leaveStart('left')(selected)).toBe(false)
  })

  it('leaves a block that something follows, or precedes, to the key', () => {
    const middle = 'Before.' + NL + NL + NOTES + NL + 'After.' + NL
    expect(leaveStart('left')(at(middle, 11))).toBe(false)
    expect(leaveEnd('right')(at(middle, 23))).toBe(false)
  })

  it('lets Right step out of inline code first, then out of the block', () => {
    const code = ':::notes' + NL + 'Speak `slowly`' + NL + ':::' + NL
    expect(leaveEnd('right')(at(code, 14))).toBe(false)
  })
})
