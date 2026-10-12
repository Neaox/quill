import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'

/**
 * A GitHub alert is a callout while it is written (`> [!IMPORTANT]`), with all a
 * callout has — its type, its title — and is written back as the alert it was.
 */

const ALERT = '> [!IMPORTANT]\n> Delete every mark and every queue.\n'

function open(source: string) {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const editor = ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
  return {
    editor,
    user: userEvent.setup(),
    markdown: () =>
      serializeDocument({
        frontMatter: {},
        ast: ref.current?.toMdast() ?? { type: 'root', children: [] },
      }),
  }
}

/** The caret in the text of the callout. */
function caretIn(opened: ReturnType<typeof open>, text: string): void {
  let at = -1
  opened.editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.includes(text) === true) at = pos + 2
  })
  act(() => {
    opened.editor.view.focus()
    opened.editor.chain().setTextSelection(at).run()
  })
}

describe('an alert in the editor', () => {
  it('is drawn as the callout of its kind, with no marker in the text', () => {
    open(ALERT)

    const callout = screen.getByRole('group', { name: 'Callout: important' })
    expect(callout).toHaveClass('callout', 'callout-important')
    expect(callout).toHaveTextContent('Delete every mark and every queue.')
    expect(callout).not.toHaveTextContent('[!IMPORTANT]')
  })

  it('is drawn the same when it was written loosely', () => {
    open('>[!IMPORTANT]\nDelete every mark and every queue.\n')

    expect(screen.getByRole('group', { name: 'Callout: important' })).toBeVisible()
  })

  it('is written back as it was, unchanged', () => {
    expect(open(ALERT).markdown()).toBe(ALERT)
  })

  it('has its type changed from the toolbar, and is written as the alert of that type', async () => {
    const opened = open(ALERT)
    caretIn(opened, 'Delete')

    await opened.user.click(
      within(screen.getByRole('toolbar', { name: 'Callout' })).getByRole('button', {
        name: /Important/,
      }),
    )
    await opened.user.click(screen.getByRole('menuitemradio', { name: /Warning/ }))

    expect(opened.markdown()).toBe('> [!WARNING]\n> Delete every mark and every queue.\n')
  })

  it('is written as the quote of that type, whatever it is', async () => {
    const opened = open(ALERT)
    caretIn(opened, 'Delete')

    await opened.user.click(
      within(screen.getByRole('toolbar', { name: 'Callout' })).getByRole('button', {
        name: /Important/,
      }),
    )
    await opened.user.click(screen.getByRole('menuitemradio', { name: /Info/ }))

    expect(opened.markdown()).toBe('> [!INFO]\n> Delete every mark and every queue.\n')
  })

  it('is written with the title after its marker when it is given one, as Obsidian writes it', async () => {
    const opened = open(ALERT)
    caretIn(opened, 'Delete')

    await opened.user.click(
      within(screen.getByRole('toolbar', { name: 'Callout' })).getByRole('button', {
        name: 'Title',
      }),
    )
    await opened.user.keyboard('Read this')

    expect(opened.markdown()).toBe(
      '> [!IMPORTANT] Read this\n> Delete every mark and every queue.\n',
    )
  })
})
