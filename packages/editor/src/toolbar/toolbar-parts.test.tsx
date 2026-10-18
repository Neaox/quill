import { TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { fireEvent, render, screen } from '@testing-library/react'
import { CellSelection, TableMap } from 'prosemirror-tables'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import { targetKey, toolbarTarget } from './toolbar-target.ts'
import { focusToolbar, handleToolbarKey, nextItem } from './use-toolbar-keys.ts'

const harness = createEditorTestHarness()

function stateAt(markdown: string, from: number, to = from): EditorState {
  const opened = harness.state(markdown)
  return opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, from, to)))
}

describe('what the toolbar is about', () => {
  it('is selected text, before anything else around it', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |\n'
    expect(toolbarTarget(stateAt(table, 4, 5))).toMatchObject({ kind: 'text' })
    expect(toolbarTarget(stateAt('[x y](/z)\n', 1, 3))).toMatchObject({ kind: 'text' })
  })

  it('is not selected text in a code block, where marks cannot go', () => {
    expect(toolbarTarget(stateAt('```\nsome code\n```\n', 2, 6))).toBeNull()
  })

  it('is a link written as a directive, whichever form, with how it is shown', () => {
    expect(
      toolbarTarget(
        stateAt('See :link[the doc]{url="https://blog.example/p" display=inline}.', 12),
      ),
    ).toMatchObject({
      kind: 'link',
      form: 'text',
      display: 'inline',
      href: 'https://blog.example/p',
    })
  })

  it('is the link a caret rests in, before the table or callout around it', () => {
    expect(toolbarTarget(stateAt('[a link](/x)\n', 3))).toEqual({
      kind: 'link',
      from: 1,
      to: 7,
      href: '/x',
      form: 'mark',
      display: 'url',
    })
    expect(toolbarTarget(stateAt(':::callout\n[a link](/x)\n:::\n', 3))).toMatchObject({
      kind: 'link',
    })
  })

  it('is the callout that holds the caret', () => {
    expect(toolbarTarget(stateAt(':::callout\nBody.\n:::\n', 3))).toMatchObject({ kind: 'callout' })
  })

  describe('in a table', () => {
    const source = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n'

    /** The state with the cells from one corner to the other selected, by row and column. */
    function cells(from: [number, number], to: [number, number]): EditorState {
      const state = harness.state(source)
      const table = state.doc.child(0)
      const map = TableMap.get(table)
      const at = ([row, column]: [number, number]): number =>
        1 + (map.map[row * map.width + column] ?? 0)
      return state.apply(state.tr.setSelection(CellSelection.create(state.doc, at(from), at(to))))
    }

    it('is the table for a caret in a cell', () => {
      expect(toolbarTarget(stateAt(source, 4))).toEqual({
        kind: 'table',
        scope: 'table',
        tablePos: 0,
      })
    })

    it('is a row or a column when a grip has picked out the whole of one', () => {
      expect(toolbarTarget(cells([2, 0], [2, 2]))).toEqual({
        kind: 'table',
        scope: 'row',
        tablePos: 0,
      })
      expect(toolbarTarget(cells([0, 1], [2, 1]))).toEqual({
        kind: 'table',
        scope: 'column',
        tablePos: 0,
      })
    })

    it('is the table for a patch of cells, and for all of them, which no grip picks', () => {
      expect(toolbarTarget(cells([1, 0], [2, 1]))).toMatchObject({ scope: 'table' })
      expect(toolbarTarget(cells([0, 0], [2, 2]))).toMatchObject({ scope: 'table' })
    })

    it('is the text, when text in a cell is selected, before the table around it', () => {
      expect(toolbarTarget(stateAt(source, 4, 5))).toMatchObject({ kind: 'text' })
    })
  })

  it('is nothing for a caret in plain text', () => {
    expect(toolbarTarget(stateAt('Some text.\n', 3))).toBeNull()
  })

  it('has a key that changes with the target and not with the caret inside a block', () => {
    expect(targetKey(null)).toBe('none')
    const text = toolbarTarget(stateAt('Some text.\n', 1, 5))
    const link = toolbarTarget(stateAt('[a link](/x)\n', 3))
    expect(targetKey(text)).toBe('text:1-5')
    expect(targetKey(link)).toBe('link:1-7')
    expect(targetKey({ kind: 'table', scope: 'row', tablePos: 12 })).toBe('table:12:row')

    // The caret moving about inside a callout is the same toolbar.
    const callout = ':::callout\nBody.\n\nMore.\n:::\n'
    expect(targetKey(toolbarTarget(stateAt(callout, 3)))).toBe('callout:0')
    expect(targetKey(toolbarTarget(stateAt(callout, 10)))).toBe('callout:0')
  })
})

function pressIn(key: string, target: 'item' | 'input', modifiers: KeyboardEventInit = {}) {
  const leave = vi.fn<() => void>()
  let handled: boolean | undefined
  render(
    <div
      role="toolbar"
      tabIndex={-1}
      onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
        handled = handleToolbarKey(event, leave)
      }}
    >
      <button type="button" data-toolbar-item="">
        one
      </button>
      <button type="button" data-toolbar-item="">
        two
      </button>
      <input aria-label="box" />
    </div>,
  )
  const element =
    target === 'item' ? screen.getByRole('button', { name: 'one' }) : screen.getByRole('textbox')
  element.focus()
  fireEvent.keyDown(element, { key, ...modifiers })
  return { handled, leave }
}

describe('moving between a toolbar’s controls', () => {
  it('goes to the next and previous control, wrapping at both ends', () => {
    expect(nextItem(0, 3, 'ArrowRight')).toBe(1)
    expect(nextItem(2, 3, 'ArrowRight')).toBe(0)
    expect(nextItem(0, 3, 'ArrowLeft')).toBe(2)
    expect(nextItem(1, 3, 'ArrowLeft')).toBe(0)
  })

  it('goes to either end with Home and End', () => {
    expect(nextItem(1, 4, 'Home')).toBe(0)
    expect(nextItem(1, 4, 'End')).toBe(3)
  })

  it('has nowhere to go with no controls, and ignores keys that are not movement', () => {
    expect(nextItem(0, 0, 'ArrowRight')).toBeNull()
    expect(nextItem(0, 3, 'a')).toBeNull()
    expect(nextItem(0, 3, 'ArrowDown')).toBeNull()
  })

  it('enters at the first control that can be used, and not at all when there is none', () => {
    expect(focusToolbar(null)).toBe(false)
    render(
      <div role="toolbar">
        <button type="button" disabled data-toolbar-item="">
          off
        </button>
        <button type="button" data-toolbar-item="">
          on
        </button>
      </div>,
    )
    expect(focusToolbar(screen.getByRole('toolbar'))).toBe(true)
    expect(screen.getByRole('button', { name: 'on' })).toHaveFocus()
    expect(focusToolbar(document.createElement('div'))).toBe(false)
  })

  it('moves focus with the arrows and says it used the key', () => {
    const { handled } = pressIn('ArrowRight', 'item')
    expect(handled).toBe(true)
    expect(screen.getByRole('button', { name: 'two' })).toHaveFocus()
  })

  it('leaves on Escape', () => {
    const { handled, leave } = pressIn('Escape', 'item')
    expect(handled).toBe(true)
    expect(leave).toHaveBeenCalledTimes(1)
  })

  it('does not use a key that is not movement', () => {
    expect(pressIn('a', 'item').handled).toBe(false)
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }])(
    'leaves a chord such as %j to what it means elsewhere',
    (modifiers) => {
      const { handled, leave } = pressIn('End', 'item', modifiers)
      expect(handled).toBe(false)
      expect(leave).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'one' })).toHaveFocus()
    },
  )

  it('leaves a text box its own arrows and Escape', () => {
    const { handled, leave } = pressIn('ArrowRight', 'input')
    expect(handled).toBe(false)
    expect(leave).not.toHaveBeenCalled()
  })
})
