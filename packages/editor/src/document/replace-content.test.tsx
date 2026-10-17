import { parseDocument, serializeDocument } from '@quill/markdown'
import { undo } from '@tiptap/pm/history'
import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'

const BEFORE = [
  '# Runbook',
  '',
  'Restart the queue first.',
  '',
  'Tell the on-call engineer.',
  '',
].join('\n')
const AFTER = [
  '# Runbook',
  '',
  'Restart the queue first, then wait.',
  '',
  'Tell the on-call engineer.',
  '',
  'Page the manager.',
  '',
].join('\n')

function open(source: string) {
  const ref = createRef<DocumentEditorHandle>()
  const onChange = vi.fn<(handle: DocumentEditorHandle) => void>()
  render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} onChange={onChange} />)
  const handle = (): DocumentEditorHandle => {
    if (ref.current === null) throw new Error('The editor did not expose a handle.')
    return ref.current
  }
  return { handle, onChange }
}

const written = (handle: DocumentEditorHandle): string =>
  serializeDocument({ frontMatter: {}, ast: handle.toMdast() })

describe('replacing what the editor holds', () => {
  it('becomes the document it is given, and says it changed', () => {
    const { handle, onChange } = open(BEFORE)

    act(() => {
      handle().replaceContent(parseDocument(AFTER).ast)
    })

    expect(written(handle())).toBe(AFTER)
    expect(onChange).toHaveBeenCalled()
  })

  it('can be undone in one step, like an edit', () => {
    const { handle } = open(BEFORE)

    act(() => {
      handle().replaceContent(parseDocument(AFTER).ast)
    })
    act(() => {
      const view = handle().editor?.view
      if (view !== undefined) undo(view.state, view.dispatch)
    })

    expect(written(handle())).toBe(BEFORE)
  })

  it('leaves blocks that did not change as they were, caret included', () => {
    const { handle } = open(BEFORE)
    const editor = handle().editor
    // The caret in the heading, which the replacement does not touch.
    act(() => {
      editor?.commands.setTextSelection(3)
    })

    act(() => {
      handle().replaceContent(parseDocument(AFTER).ast)
    })

    expect(editor?.state.selection.from).toBe(3)
  })

  it('does nothing when it is given what the editor already holds', () => {
    const { handle, onChange } = open(BEFORE)

    act(() => {
      handle().replaceContent(parseDocument(BEFORE).ast)
    })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('replaces the right stretch when what was added repeats the block beside it', () => {
    const { handle } = open('Same.\n')
    const repeated = 'Same.\n\nSame.\n'

    act(() => {
      handle().replaceContent(parseDocument(repeated).ast)
    })

    expect(written(handle())).toBe(repeated)
  })
})
