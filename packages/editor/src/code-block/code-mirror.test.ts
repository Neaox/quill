import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'

import { atEdge, createCodeMirror, textChange } from './code-mirror.ts'
import type { EscapeDirection } from './code-mirror.ts'
import { resolveLanguage } from './languages.ts'

function stateAt(text: string, head: number, anchor: number = head): EditorState {
  return EditorState.create({ doc: text, selection: { anchor, head } })
}

function host(text = 'const a = 1', editable = true) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const onChange = vi.fn<(text: string) => void>()
  const onEscape = vi.fn<(direction: EscapeDirection) => void>()
  const view = createCodeMirror({
    parent,
    text,
    language: resolveLanguage('typescript'),
    editable,
    onChange,
    onEscape,
  })
  return { view, onChange, onEscape, parent }
}

describe('where the caret leaves a code block', () => {
  const text = 'one\ntwo\nthree'

  it('leaves from the first line upwards and the last line downwards', () => {
    expect(atEdge(stateAt(text, 1), 'up')).toBe(true)
    expect(atEdge(stateAt(text, 5), 'up')).toBe(false)
    expect(atEdge(stateAt(text, text.length), 'down')).toBe(true)
    expect(atEdge(stateAt(text, 1), 'down')).toBe(false)
  })

  it('leaves from the very start leftwards and the very end rightwards', () => {
    expect(atEdge(stateAt(text, 0), 'left')).toBe(true)
    expect(atEdge(stateAt(text, 1), 'left')).toBe(false)
    expect(atEdge(stateAt(text, text.length), 'right')).toBe(true)
    expect(atEdge(stateAt(text, 2), 'right')).toBe(false)
  })

  it('never leaves while text is selected, because the key collapses it first', () => {
    expect(atEdge(stateAt(text, 0, 3), 'left')).toBe(false)
  })
})

describe('the smallest change between two versions of a block', () => {
  it('has nothing to report when nothing changed', () => {
    expect(textChange('abc', 'abc')).toBeNull()
  })

  it('reports an insertion, a deletion and a replacement by their own extent', () => {
    expect(textChange('abc', 'abXc')).toEqual({ from: 2, to: 2, text: 'X' })
    expect(textChange('abc', 'ac')).toEqual({ from: 1, to: 2, text: '' })
    expect(textChange('abc', 'aXc')).toEqual({ from: 1, to: 2, text: 'X' })
  })

  it('reports a change at either end, and a change of everything', () => {
    expect(textChange('bc', 'abc')).toEqual({ from: 0, to: 0, text: 'a' })
    expect(textChange('ab', 'abc')).toEqual({ from: 2, to: 2, text: 'c' })
    expect(textChange('abc', '')).toEqual({ from: 0, to: 3, text: '' })
  })
})

describe('a hosted CodeMirror editor', () => {
  it('opens with the block text, coloured by the block language', () => {
    const { view, parent } = host()
    expect(view.view.state.doc.toString()).toBe('const a = 1')
    expect(parent.querySelector('.cm-editor')).not.toBeNull()
    view.destroy()
  })

  it('reports every change to its caller, and ignores a change to the same text', () => {
    const { view, onChange } = host()
    view.view.dispatch({ changes: { from: 11, insert: '2' } })
    expect(onChange).toHaveBeenCalledWith('const a = 12')

    view.setText('const a = 12')
    expect(onChange).toHaveBeenCalledTimes(1)

    view.setText('other')
    expect(onChange).toHaveBeenLastCalledWith('other')
    view.destroy()
  })

  it('changes grammar and editability without rebuilding itself', () => {
    const { view } = host()
    const before = view.view
    view.setLanguage(resolveLanguage('python'))
    view.setLanguage(undefined)
    view.setEditable(false)
    expect(view.view).toBe(before)
    expect(view.view.state.facet(EditorState.readOnly)).toBe(false)
    view.destroy()
  })

  it('opens read-only when the document is read-only', () => {
    const { view } = host('x', false)
    expect(view.view.state.facet(EditorView.editable)).toBe(false)
    view.setEditable(true)
    expect(view.view.state.facet(EditorView.editable)).toBe(true)
    view.destroy()
  })

  it('gives the document back the caret from every edge, and on demand', () => {
    const { view, onEscape } = host('one\ntwo')
    const leave = (key: string, head: number) => {
      view.view.dispatch({ selection: { anchor: head } })
      runScopeHandlers(view.view, new KeyboardEvent('keydown', { key }), 'editor')
    }
    leave('ArrowUp', 1)
    leave('ArrowLeft', 0)
    expect(onEscape).toHaveBeenNthCalledWith(1, -1)
    expect(onEscape).toHaveBeenNthCalledWith(2, -1)

    leave('ArrowDown', 7)
    leave('ArrowRight', 7)
    leave('Escape', 1)
    expect(onEscape).toHaveBeenLastCalledWith(1)

    onEscape.mockClear()
    leave('ArrowUp', 5)
    expect(onEscape).not.toHaveBeenCalled()
    view.destroy()
  })
})
