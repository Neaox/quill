import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'

import { createEditorTestHarness } from '../testing/harness.ts'
import { DocumentEditor } from './document-editor.tsx'
import { enterTable } from './enter-table.ts'
import type { DocumentEditorHandle } from './document-editor.tsx'

const lines = (...rows: string[]): string => `${rows.join('\n')}\n`
const TABLE = ['| One | Two |', '| --- | --- |', '| a | b |']
const BETWEEN = lines('Above.', '', ...TABLE, '', 'Below.')

async function openAt(source: string, caretAt: (doc: DocumentEditorHandle) => number) {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('textbox', { name: 'Document' }))
  act(() => {
    const handle = ref.current
    if (handle?.editor === undefined || handle.editor === null) throw new Error('No editor.')
    handle.editor.commands.setTextSelection(caretAt(handle))
  })
  const written = () => {
    const handle = ref.current
    if (handle === null) throw new Error('No editor.')
    return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
  }
  return { user, written }
}

/** The end of the paragraph before the table, and the start of the one after it. */
const endOfAbove = () => 7
const startOfBelow = (handle: DocumentEditorHandle) =>
  (handle.editor?.state.doc.content.size ?? 0) - 7

describe('stepping into a table from the paragraph beside it', () => {
  it.each(['{ArrowDown}', '{ArrowRight}'])(
    'takes %s from the end of the paragraph above into the first cell, at its start',
    async (key) => {
      const { user, written } = await openAt(BETWEEN, endOfAbove)

      await user.keyboard(`${key}X`)

      expect(written()).toContain('| XOne | Two |')
    },
  )

  it.each(['{ArrowUp}', '{ArrowLeft}'])(
    'takes %s from the start of the paragraph below into the last cell, at its end',
    async (key) => {
      const { user, written } = await openAt(BETWEEN, startOfBelow)

      await user.keyboard(`${key}X`)

      expect(written()).toContain('| a | bX |')
    },
  )

  it('leaves the key to the browser where the caret is not at the edge', async () => {
    const { user, written } = await openAt(BETWEEN, () => 3)

    await user.keyboard('{ArrowRight}X')

    expect(written()).not.toContain('XOne')
  })

  it('leaves the key alone where no table follows', async () => {
    const { user, written } = await openAt(lines('One.', '', 'Two.'), () => 5)

    await user.keyboard('{ArrowDown}X')

    expect(written()).not.toContain('| ')
  })

  it('lets Right step out of inline code before it steps into the table', async () => {
    const { user, written } = await openAt(lines('Above `code`', '', ...TABLE), () => 11)

    await user.keyboard('{ArrowRight}X')

    expect(written()).toContain('Above `code`X')
  })
})

describe('stepping into a table, asked of the command itself', () => {
  const harness = createEditorTestHarness()
  const at = (from: number, to = from): EditorState => {
    const state = harness.state(BETWEEN)
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
  }

  it('says it would run without running', () => {
    expect(enterTable('right')(at(7))).toBe(true)
  })

  it('leaves a range of text alone, which a key would only collapse', () => {
    expect(enterTable('right')(at(1, 7))).toBe(false)
  })

  it('has nothing to step into at the very start or end of a document with nothing beside it', () => {
    expect(enterTable('left')(at(1))).toBe(false)
  })
})
