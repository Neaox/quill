import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '@quill/editor'
import type { DocumentEditorHandle } from '@quill/editor'
import { parseDocument } from '@quill/markdown'

import { currentEditorCommands } from '../search/editor-commands.ts'
import { useEditorPaletteCommands } from './use-editor-palette-commands.ts'

let handle: DocumentEditorHandle | null = null

function Harness() {
  const ref = useRef<DocumentEditorHandle>(null)
  useEditorPaletteCommands(ref)
  return (
    <DocumentEditor
      ref={(value) => {
        ref.current = value
        handle = value
      }}
      ast={parseDocument('See [the post](https://blog.example/post) now.').ast}
    />
  )
}

function placeCaret(position: number): void {
  const editor = handle?.editor
  if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
  act(() => {
    editor.view.focus()
    editor.chain().setTextSelection(position).run()
  })
}

describe('the editor’s commands in the palette', () => {
  it('are offered while the cursor is in a link, and only then', () => {
    const { unmount } = render(<Harness />)

    placeCaret(7)
    expect(currentEditorCommands().map((command) => command.label)).toEqual([
      'Show link as inline',
      'Show link as compact',
      'Show link as card',
    ])

    placeCaret(2)
    expect(currentEditorCommands()).toEqual([])
    unmount()
  })

  it('are withdrawn with the editor', () => {
    const { unmount } = render(<Harness />)
    placeCaret(7)
    expect(currentEditorCommands()).not.toEqual([])
    unmount()
    expect(currentEditorCommands()).toEqual([])
  })
})
