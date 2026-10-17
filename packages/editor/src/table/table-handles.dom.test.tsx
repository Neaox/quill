import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, fireEvent, render } from '@testing-library/react'
import { CellSelection } from 'prosemirror-tables'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import { setPageNearness } from '../document/measuring.ts'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'

/*
 * The handles drive the table by what the browser has laid out. The test's
 * DOM lays nothing out, so every cell here is 100 pixels wide and every row
 * 40 tall, the table 300 wide, the scroller as wide as the table, and the
 * card 680 pixels: the content track of the grid below.
 */

const CELL = 100
const ROW = 40
const GRID = '100px 140px 680px 140px 220px'

const SOURCE = [
  ':::table{headers=both}',
  '| Region | Owner | Budget |',
  '| - | - | - |',
  '| eu | Platform | 120 |',
  '| us | Data | 90 |',
  ':::',
  '',
].join('\n')

function layout(
  this: HTMLElement,
  axis: 'offsetLeft' | 'offsetTop' | 'offsetWidth' | 'offsetHeight',
) {
  if (this instanceof HTMLTableCellElement) {
    return {
      offsetLeft: this.cellIndex * CELL,
      offsetTop: 0,
      offsetWidth: CELL,
      offsetHeight: ROW,
    }[axis]
  }
  if (this instanceof HTMLTableRowElement) {
    return {
      offsetLeft: 0,
      offsetTop: this.rowIndex * ROW,
      offsetWidth: 3 * CELL,
      offsetHeight: ROW,
    }[axis]
  }
  if (this instanceof HTMLTableElement) return axis === 'offsetWidth' ? 3 * CELL : 3 * ROW
  if (this.classList.contains('table-block')) return 680
  return 0
}

beforeEach(() => {
  for (const axis of ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight'] as const) {
    vi.spyOn(HTMLElement.prototype, axis, 'get').mockImplementation(function (this: HTMLElement) {
      return layout.call(this, axis)
    })
  }
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(3 * CELL)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function open(source = SOURCE) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  const editor = ref.current?.editor
  if (editor == null) throw new Error('The editor did not start.')
  editor.view.dom.style.gridTemplateColumns = GRID
  await frame()
  const layer = result.container.querySelector<HTMLElement>('.table-handles')
  if (layer === null) throw new Error('The table has no handles.')
  const handle = ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  const written = (): string => serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
  return { ...result, editor, layer, written }
}

/** Waits for the handles' next placement, which happens in an animation frame. */
async function frame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
}

function only(layer: HTMLElement, selector: string, index = 0): HTMLElement {
  const found = layer.querySelectorAll<HTMLElement>(selector)[index]
  if (found === undefined) throw new Error(`no ${selector} ${String(index)}`)
  return found
}

describe('the handles', () => {
  it('follow the cells: a grip on each column and row, a "+" on each boundary', async () => {
    const { layer } = await open()

    expect(only(layer, '.table-grip-column', 1).style.transform).toBe('translateX(100px)')
    expect(only(layer, '.table-grip-row', 2).style.transform).toBe('translateY(80px)')
    expect(only(layer, '.table-column-border', 0).style.transform).toBe('translateX(100px)')
    expect(only(layer, '.table-insert-column', 3).style.transform).toBe('translateX(300px)')
    expect(only(layer, '.table-width-handle').style.transform).toBe('translateX(300px)')
    // Nothing goes above the header row.
    expect(only(layer, '.table-insert-row', 0).hidden).toBe(true)
    expect(only(layer, '.table-insert-row', 1).hidden).toBe(false)
  })

  it('offer a row above the first when the rows have no header row', async () => {
    const { layer } = await open(SOURCE.replace('headers=both', 'headers=row'))
    expect(only(layer, '.table-insert-row', 0).hidden).toBe(false)
  })

  it('hide a "+" whose boundary has scrolled out of the frame, placed again on scroll', async () => {
    const { layer, container } = await open()
    const scroller = container.querySelector<HTMLElement>('.table-scroll')
    if (scroller === null) throw new Error('no scroller')
    scroller.scrollLeft = 150
    fireEvent.scroll(scroller)
    await frame()

    expect(only(layer, '.table-insert-column', 0).hidden).toBe(true)
    expect(only(layer, '.table-insert-column', 2).hidden).toBe(false)
  })

  it('insert a row with a "+", keeping the caret in the document', async () => {
    const { layer, written } = await open()
    const insert = only(layer, '.table-insert-row', 2)

    expect(fireEvent.pointerDown(insert)).toBe(false)
    fireEvent.click(insert)
    expect(written()).toContain('| eu | Platform | 120 |\n| | | |\n| us |')
  })

  it('move a row dragged by its grip, turning text selection off only while it moves', async () => {
    const { layer, written } = await open()
    const grip = only(layer, '.table-grip-row', 1)
    const root = document.documentElement

    fireEvent.pointerDown(grip, { clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientY: 61, pointerId: 1 })
    expect(root).not.toHaveAttribute('data-dragging')
    fireEvent.pointerMove(grip, { clientY: 110, pointerId: 1 })
    expect(root).toHaveAttribute('data-dragging')
    expect(layer).toHaveAttribute('data-dragging', 'row')
    expect(only(layer, '.table-drop-line').style.transform).toBe('translateY(120px)')
    fireEvent.pointerUp(grip, { clientY: 110, pointerId: 1 })

    expect(root).not.toHaveAttribute('data-dragging')
    expect(written()).toContain('| us | Data | 90 |\n| eu | Platform | 120 |')
  })

  it('move a column dragged back by its grip, and leave one dropped where it was', async () => {
    const { layer, written } = await open()
    const grip = only(layer, '.table-grip-column', 2)

    fireEvent.pointerDown(grip, { clientX: 250, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 190, pointerId: 1 })
    expect(only(layer, '.table-drop-line').style.transform).toBe('translateX(100px)')
    fireEvent.pointerUp(grip, { clientX: 190, pointerId: 1 })
    expect(written()).toContain('| Region | Budget | Owner |')

    const before = written()
    const first = only(layer, '.table-grip-column', 0)
    fireEvent.pointerDown(first, { clientX: 50, pointerId: 2 })
    fireEvent.pointerMove(first, { clientX: 60, pointerId: 2 })
    fireEvent.pointerCancel(first, { clientX: 60, pointerId: 2 })
    expect(written()).toBe(before)
  })

  it('select a whole column when its grip is clicked, capturing the pointer where it can', async () => {
    const { layer, editor } = await open()
    const grip = only(layer, '.table-grip-column', 1)
    const capture = vi.fn<(pointerId: number) => void>()
    Object.assign(grip, { setPointerCapture: capture })

    fireEvent.pointerDown(grip, { clientX: 150, pointerId: 7 })
    fireEvent.pointerUp(grip, { clientX: 150, pointerId: 7 })

    expect(capture).toHaveBeenCalledWith(7)
    const { selection } = editor.state
    expect(selection instanceof CellSelection && selection.isColSelection()).toBe(true)
  })

  it('resize two columns by the border between them, with both shares read out', async () => {
    const { layer, container, written } = await open()
    const border = only(layer, '.table-column-border', 0)

    fireEvent.pointerDown(border, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(border, { clientX: 120, pointerId: 1 })
    fireEvent.pointerMove(border, { clientX: 130, pointerId: 1 })
    const readout = only(layer, '.table-readout')
    expect(readout.hidden).toBe(false)
    expect(readout.textContent).toBe('43% · 23%')
    expect(container.querySelectorAll('colgroup > col')).toHaveLength(3)
    fireEvent.pointerUp(border, { clientX: 130, pointerId: 1 })

    expect(readout.hidden).toBe(true)
    expect(written()).toContain('columns="43fr 23fr 33fr"')
  })

  it('change nothing when a border is pressed and let go', async () => {
    const { layer, written } = await open()
    const before = written()
    const border = only(layer, '.table-column-border', 1)

    fireEvent.pointerDown(border, { clientX: 200, pointerId: 1 })
    fireEvent.pointerUp(border, { clientX: 200, pointerId: 1 })
    expect(written()).toBe(before)
  })

  it('set the width by the trailing edge, snapping to the tracks', async () => {
    const { layer, written } = await open()
    const edge = only(layer, '.table-width-handle')

    fireEvent.pointerDown(edge, { clientX: 680, pointerId: 1 })
    fireEvent.pointerMove(edge, { clientX: 1270, pointerId: 1 })
    expect(only(layer, '.table-readout').textContent).toBe('Full')
    fireEvent.pointerUp(edge, { clientX: 1270, pointerId: 1 })
    expect(written()).toContain('width="full"')

    fireEvent.pointerDown(edge, { clientX: 680, pointerId: 2 })
    fireEvent.pointerMove(edge, { clientX: 1100, pointerId: 2 })
    fireEvent.pointerUp(edge, { clientX: 1100, pointerId: 2 })
    expect(written()).toContain('width="85%"')
  })

  it('leave the width alone where the grid has no tracks to snap to', async () => {
    const { layer, editor, written } = await open()
    editor.view.dom.style.gridTemplateColumns = 'none'
    const before = written()
    const edge = only(layer, '.table-width-handle')

    fireEvent.pointerDown(edge, { clientX: 680, pointerId: 1 })
    fireEvent.pointerMove(edge, { clientX: 900, pointerId: 1 })
    fireEvent.pointerUp(edge, { clientX: 900, pointerId: 1 })
    expect(written()).toBe(before)
    expect(layer).not.toHaveAttribute('data-dragging')
  })

  it('are placed again when the table’s frame changes size', async () => {
    const resized: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized.push(callback)
        }
        observe(): void {}
        disconnect(): void {}
      },
    )
    const { layer } = await open()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(150)
    for (const callback of resized) callback()
    await frame()

    expect(layer.style.getPropertyValue('--table-handles-width')).toBe('150px')
    vi.unstubAllGlobals()
  })

  it('are placed only once the table comes near the screen', async () => {
    // A runbook's 240 tables placed at once laid the page out 240 times in a frame.
    const watched = new Map<Element, (near: boolean) => void>()
    const restore = setPageNearness({
      watch(element, change) {
        watched.set(element, change)
        return () => watched.delete(element)
      },
    })
    try {
      const { layer } = await open()
      const grip = only(layer, '.table-grip-column', 1)
      expect(grip.style.transform).toBe('')

      act(() => {
        for (const change of watched.values()) change(true)
      })
      await frame()
      expect(grip.style.transform).toBe('translateX(100px)')

      // Coming near again with nothing changed places nothing again.
      grip.style.transform = ''
      act(() => {
        for (const change of watched.values()) change(true)
      })
      await frame()
      expect(grip.style.transform).toBe('')
    } finally {
      restore()
    }
  })

  it('stop following the page once the table is gone', async () => {
    const { editor, container } = await open()
    const scroller = container.querySelector('.table-scroll')
    act(() => {
      editor.commands.setContent('<p>Nothing</p>')
    })
    expect(scroller?.isConnected).toBe(false)
  })
})
