import { parseDocument } from '@quill/markdown'
import { render } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from './document-editor.tsx'

describe('a re-render of the document editor', () => {
  it('does not reconfigure the editor when its parent renders again with props of the same meaning', () => {
    const ast = parseDocument('Some words.\n').ast
    const setOptions = vi.spyOn(Editor.prototype, 'setOptions')
    // What a parent that renders on every autosave status change hands down: new objects each time.
    const view = () => (
      <DocumentEditor
        ast={{ ...ast }}
        label="Body"
        labels={['status']}
        emoji={{ custom: new Map(), labelEmoji: new Map() }}
      />
    )
    const { rerender } = render(view())
    setOptions.mockClear()

    rerender(view())
    rerender(view())

    // Rebuilding the extensions on every render is what makes saving a long document stall.
    expect(setOptions).not.toHaveBeenCalled()
    setOptions.mockRestore()
  })
})
