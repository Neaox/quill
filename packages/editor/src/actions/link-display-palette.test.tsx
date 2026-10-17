import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { linkDisplayPaletteCommands } from './link-display-palette.ts'

const ADDRESS = 'https://blog.example/post'

function open(source: string, caretIn: string | null) {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const editor = ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
  if (caretIn !== null) {
    let at = -1
    editor.state.doc.descendants((node, pos) => {
      const found = node.isText ? (node.text?.indexOf(caretIn) ?? -1) : -1
      if (at < 0 && found >= 0) at = pos + found + 2
    })
    act(() => {
      editor.view.focus()
      editor.chain().setTextSelection(at).run()
    })
  }
  const markdown = () => {
    const handle = ref.current
    if (handle === null) throw new Error('No handle')
    return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
  }
  return { editor, markdown }
}

describe('the command palette’s entries for the link at the cursor', () => {
  it('are "Show link as" each display the link is not already shown as', () => {
    const { editor } = open(`See [the post](${ADDRESS}) now.`, 'the post')
    expect(linkDisplayPaletteCommands(editor).map((command) => command.label)).toEqual([
      'Show link as inline',
      'Show link as compact',
      'Show link as card',
    ])
  })

  it('leave out the display the link already has', () => {
    const { editor } = open(
      `See :link[the post]{url="${ADDRESS}" display="inline"} now.`,
      'the post',
    )
    expect(linkDisplayPaletteCommands(editor).map((command) => command.label)).toEqual([
      'Show link as link',
      'Show link as compact',
      'Show link as card',
    ])
  })

  it('are none when the cursor is not in a link', () => {
    const { editor } = open(`See [the post](${ADDRESS}) now.`, 'See')
    expect(linkDisplayPaletteCommands(editor)).toEqual([])
  })

  it('leave out card and compact where a line of its own is not possible', () => {
    const { editor } = open(`# A [heading](${ADDRESS}) here`, 'heading')
    expect(linkDisplayPaletteCommands(editor).map((command) => command.label)).toEqual([
      'Show link as inline',
    ])
  })

  it('can be found by the words an author would type', () => {
    const { editor } = open(`See [the post](${ADDRESS}) now.`, 'the post')
    const [first] = linkDisplayPaletteCommands(editor)
    expect(first?.keywords).toEqual(expect.arrayContaining(['link', 'preview', 'display']))
  })

  it('change the display when run, and return the cursor to the document', () => {
    const { editor, markdown } = open(`See [the post](${ADDRESS}) now.`, 'the post')
    const card = linkDisplayPaletteCommands(editor).find(
      (command) => command.label === 'Show link as card',
    )
    act(() => {
      card?.run()
    })
    expect(markdown()).toContain(`::link[the post]{url="${ADDRESS}" display="card"}`)
    expect(editor.isFocused).toBe(true)
  })

  it('run as one edit that undo takes back', async () => {
    const { editor, markdown } = open(`See [the post](${ADDRESS}) now.`, 'the post')
    const inline = linkDisplayPaletteCommands(editor)[0]
    act(() => {
      inline?.run()
    })
    expect(markdown()).toContain(':link[the post]')
    editor.view.focus()
    await userEvent.keyboard('{Control>}z{/Control}')
    expect(markdown()).toBe(`See [the post](${ADDRESS}) now.\n`)
  })
})
