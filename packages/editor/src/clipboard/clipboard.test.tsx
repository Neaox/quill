import { parseDocument } from '@quill/markdown'
import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { canReadClipboard, readClipboard, selectionPayload, writeClipboard } from './clipboard.ts'

function open(source: string) {
  const ref = createRef<DocumentEditorHandle>()
  render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const editor = ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
  return editor
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('what a copy of the selection carries', () => {
  it('is nothing for a caret, which selects nothing', () => {
    const editor = open('Some text.\n')

    expect(selectionPayload(editor.view)).toBeUndefined()
  })

  it('is the selection as formatted and as plain text, as the editor’s own copy makes them', () => {
    const editor = open('Some **bold** text.\n')
    act(() => {
      editor.chain().setTextSelection({ from: 6, to: 10 }).run()
    })

    const payload = selectionPayload(editor.view)

    expect(payload?.text).toBe('bold')
    expect(payload?.html).toContain('<strong>bold</strong>')
  })
})

describe('the clipboard a page may reach', () => {
  it('is there to be read where the browser has one that reads', () => {
    expect(canReadClipboard()).toBe(false)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: async () => '' },
    })
    expect(canReadClipboard()).toBe(true)
  })

  it('says it could not write, and could not read, where there is none', async () => {
    expect(await writeClipboard({ html: '<p>a</p>', text: 'a' })).toBe(false)
    expect(await readClipboard()).toBeUndefined()
  })

  it('reads plain text alone where the browser only offers that, and an empty clipboard as empty', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: async () => 'plain' },
    })
    expect(await readClipboard()).toEqual({ html: '', text: 'plain' })

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [], readText: async () => '' },
    })
    expect(await readClipboard()).toEqual({ html: '', text: '' })
  })
})
