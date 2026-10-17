import { parseDocument } from '@quill/markdown'
import { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { describe, expect, it } from 'vitest'

import { documentFromMdast } from '../document/ast.ts'
import { editorSchema } from '../schema/editor-schema.ts'
import { caretRect, queryContinues, rectOf, slashAllowed } from './slash-extension.ts'
import { createSlashRegistry } from './slash-registry.ts'

function stateOf(markdown: string): EditorState {
  return EditorState.create({
    schema: editorSchema,
    doc: documentFromMdast(parseDocument(markdown).ast).doc,
  })
}

/** Where the first `/` in the document is, as the plugin's range would say. */
function slashIn(state: EditorState): { from: number; to: number } {
  let from = -1
  state.doc.descendants((node, position) => {
    const at = node.isText ? (node.text ?? '').indexOf('/') : -1
    if (from < 0 && at >= 0) from = position + at
  })
  return { from, to: from + 1 }
}

function allowed(markdown: string): boolean {
  const state = stateOf(markdown)
  return slashAllowed(state, slashIn(state))
}

describe('where a slash starts a query', () => {
  it('at the start of a line, or after whitespace', () => {
    expect(allowed('/\n')).toBe(true)
    expect(allowed('Some /\n')).toBe(true)
    expect(allowed('# A /\n')).toBe(true)
    expect(allowed('Tab /\n')).toBe(true)
  })

  it('not inside a word, an address, inline code, a link or a code block', () => {
    expect(allowed('and/or\n')).toBe(false)
    expect(allowed('`a /b`\n')).toBe(false)
    expect(allowed('[a /b](https://example.com)\n')).toBe(false)
    expect(allowed('```\n/\n```\n')).toBe(false)
    expect(allowed(':::note\n::leaf[a /b]\n:::\n')).toBe(false)
  })

  it('not straight after an inline node', () => {
    expect(allowed(':badge[Done]/\n')).toBe(false)
  })
})

describe('whether a query keeps the menu open', () => {
  const items = createSlashRegistry().items

  it('closes on a space straight after the slash', () => {
    expect(queryContinues(' ', items)).toBe(false)
    expect(queryContinues(' table', items)).toBe(false)
  })

  it('stays open through words that still match, and closes when they stop', () => {
    expect(queryContinues('tab', items)).toBe(true)
    expect(queryContinues('zzz', items)).toBe(true)
    expect(queryContinues('heading 2', items)).toBe(true)
    expect(queryContinues('zzz ', items)).toBe(false)
  })
})

describe('measuring the caret', () => {
  it('has no rectangle when the browser cannot say where the caret is', () => {
    expect(rectOf(undefined)).toBeNull()
    expect(rectOf(null)).toBeNull()
    expect(rectOf(() => null)).toBeNull()
    expect(rectOf(() => new DOMRect(5, 10, 0, 20))).toEqual({ top: 10, bottom: 30, left: 5 })
  })

  it('reads the caret from a view, or nothing from a view with no layout', () => {
    const state = stateOf('Words\n')
    const measured = {
      state,
      coordsAtPos: () => ({ top: 1, bottom: 2, left: 3, right: 3 }),
    } as unknown as EditorView
    expect(caretRect(measured)).toEqual({ top: 1, bottom: 2, left: 3 })
    const unmeasured = {
      state,
      coordsAtPos: () => {
        throw new Error('No layout')
      },
    } as unknown as EditorView
    expect(caretRect(unmeasured)).toBeNull()
  })
})
