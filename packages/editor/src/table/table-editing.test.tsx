import { parseDocument, serializeDocument } from '@quill/markdown'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/react'
import { CellSelection, TableMap } from 'prosemirror-tables'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { expectNoAccessibilityViolations } from '../testing/axe.ts'

/**
 * Editing a table as an author does: the caret in a cell, the grips, the "+"
 * on a border, and the toolbar that follows what has been picked out.
 */

const TABLE = '| Region | Owner |\n| - | - |\n| eu | Platform |\n| us | Data |\n'

function open(source = TABLE) {
  const ref = createRef<DocumentEditorHandle>()
  const result = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  return { ref, user: userEvent.setup(), ...result }
}

type Opened = ReturnType<typeof open>

function markdown(opened: Opened): string {
  const handle = opened.ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  return serializeDocument({ frontMatter: {}, ast: handle.toMdast() })
}

/** Rests the caret in the first cell holding `text`. */
function rest(opened: Opened, text: string): void {
  const editor = opened.ref.current?.editor
  if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text === text) at = pos
  })
  if (at < 0) throw new Error(`"${text}" is not in the document.`)
  act(() => {
    editor.view.focus()
    editor.chain().setTextSelection(at).run()
  })
}

const toolbar = (): HTMLElement => screen.getByRole('toolbar', { name: 'Table' })

function handles(opened: Opened, selector: string): HTMLElement[] {
  return [...opened.container.querySelectorAll<HTMLElement>(`.table-handles ${selector}`)]
}

/** A press and release on a grip, which selects its row or column. */
function pick(grip: HTMLElement | undefined): void {
  if (grip === undefined) throw new Error('There is no such grip.')
  fireEvent.pointerDown(grip, { pointerId: 1, clientX: 0, clientY: 0 })
  fireEvent.pointerUp(grip, { pointerId: 1, clientX: 0, clientY: 0 })
}

describe('the toolbar over a table', () => {
  it('appears with the caret, for the table as a whole', async () => {
    const opened = open()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    rest(opened, 'eu')

    const bar = toolbar()
    for (const name of [
      'Align left',
      'Align centre',
      'Align right',
      'Table settings',
      'Delete table',
    ]) {
      expect(within(bar).getByRole('button', { name })).toBeVisible()
    }
    expect(within(bar).queryByRole('button', { name: /row|column/i })).not.toBeInTheDocument()
    await expectNoAccessibilityViolations(opened.container)
  })

  it('aligns the column the caret is in, and shows which alignment is on', async () => {
    const opened = open()
    rest(opened, 'Platform')
    const right = within(toolbar()).getByRole('button', { name: 'Align right' })
    expect(right).toHaveAttribute('aria-pressed', 'false')

    await opened.user.click(right)

    expect(markdown(opened)).toContain('| - | -: |')
    expect(within(toolbar()).getByRole('button', { name: 'Align right' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('opens its settings in a menu that shows what each is set to', async () => {
    const opened = open(`:::table{width="full"}\n${TABLE}:::\n`)
    rest(opened, 'eu')

    await opened.user.click(within(toolbar()).getByRole('button', { name: /Table settings/ }))

    const menu = screen.getByRole('menu', { name: 'Table settings options' })
    expect(within(menu).getByRole('menuitemradio', { name: 'Full' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(menu).getByRole('menuitemcheckbox', { name: /Header row/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await opened.user.click(within(menu).getByRole('menuitemcheckbox', { name: /Footer row/ }))

    expect(markdown(opened)).toContain('footer="1"')
  })

  it('removes the table', async () => {
    const opened = open(`Before.\n\n${TABLE}`)
    rest(opened, 'eu')

    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Delete table' }))

    expect(markdown(opened)).toBe('Before.\n')
  })

  it('goes away when the caret leaves the table', () => {
    const opened = open(`${TABLE}\nAfter.\n`)
    rest(opened, 'eu')
    expect(toolbar()).toBeVisible()

    rest(opened, 'After.')

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })
})

describe('where the toolbar hangs over a table', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.style.removeProperty('--sticky-chrome-top')
  })

  /** The toolbar's top, with the table drawn at this top and bottom, and the page's bar this tall. */
  function hung(table: { top: number; bottom: number }, chrome?: string): string {
    if (chrome !== undefined)
      document.documentElement.style.setProperty('--sticky-chrome-top', chrome)
    const opened = open()
    const dom = opened.container.querySelector('.table-editor')
    if (dom === null) throw new Error('There is no table.')
    vi.spyOn(dom, 'getBoundingClientRect').mockReturnValue({
      ...table,
      left: 0,
      right: 600,
      width: 600,
      height: table.bottom - table.top,
      x: 0,
      y: table.top,
      toJSON: () => ({}),
    })
    rest(opened, 'eu')
    return toolbar().style.top
  }

  it('is above the table’s top edge, clear of its handles', () => {
    expect(hung({ top: 300, bottom: 500 })).toBe('284px')
  })

  it('is held below the page’s own bar while a tall table passes under it', () => {
    expect(hung({ top: -300, bottom: 900 }, '64px')).toBe('96px')
  })

  it('goes with the table’s foot once the table has all but gone by', () => {
    expect(hung({ top: -500, bottom: 50 }, '64px')).toBe('34px')
  })

  it('stays where it is when the browser has drawn nothing for the table', () => {
    const opened = open()
    const view = opened.ref.current?.editor?.view
    if (view === undefined) throw new Error('The editor did not mount.')
    vi.spyOn(view, 'nodeDOM').mockReturnValue(null)
    rest(opened, 'eu')

    expect(toolbar().style.top).toBe('')
  })
})

describe('a row picked out by its grip', () => {
  it('becomes what the toolbar is about, and the grip says so', async () => {
    const opened = open()
    rest(opened, 'eu')

    pick(handles(opened, '.table-grip[data-axis="row"]')[1])

    const bar = toolbar()
    for (const name of ['Insert row above', 'Insert row below', 'Move row up', 'Delete row']) {
      expect(within(bar).getByRole('button', { name })).toBeVisible()
    }
    expect(within(bar).queryByRole('button', { name: 'Table settings' })).not.toBeInTheDocument()
    const grips = handles(opened, '.table-grip[data-axis="row"]')
    expect(grips.map((grip) => grip.dataset['state'])).toEqual([undefined, 'selected', undefined])
  })

  it('inserts, moves and deletes that row', async () => {
    const opened = open()
    rest(opened, 'us')
    pick(handles(opened, '.table-grip[data-axis="row"]')[2])

    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Move row up' }))
    expect(markdown(opened)).toContain('| us | Data |\n| eu | Platform |')

    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Delete row' }))
    expect(markdown(opened)).not.toContain('us')
  })

  it('cannot move into the header row or leave the table with none', () => {
    const opened = open()
    rest(opened, 'eu')
    pick(handles(opened, '.table-grip[data-axis="row"]')[1])

    expect(within(toolbar()).getByRole('button', { name: 'Move row up' })).toBeDisabled()
  })
})

describe('a column picked out by its grip', () => {
  it('has a column’s tools, its alignment, and removal', async () => {
    const opened = open()
    rest(opened, 'eu')

    pick(handles(opened, '.table-grip[data-axis="column"]')[1])

    const bar = toolbar()
    for (const name of [
      'Insert column left',
      'Insert column right',
      'Align right',
      'Delete column',
    ]) {
      expect(within(bar).getByRole('button', { name })).toBeVisible()
    }
    await opened.user.click(within(bar).getByRole('button', { name: 'Insert column left' }))
    expect(markdown(opened)).toContain('| Region | | Owner |')
  })
})

describe('every tool of the toolbar', () => {
  it('draws an icon, for a toolbar of icons names each by its label and not by words', () => {
    const opened = open()
    const drawn = (): boolean[] =>
      within(toolbar())
        .getAllByRole('button')
        .filter((button) => button.hasAttribute('aria-label'))
        .map((button) => button.querySelector('svg') !== null)
    rest(opened, 'eu')
    const forTable = drawn()
    pick(handles(opened, '.table-grip[data-axis="row"]')[1])
    const forRow = drawn()
    pick(handles(opened, '.table-grip[data-axis="column"]')[1])
    const forColumn = drawn()

    expect([forTable, forRow, forColumn].map((icons) => icons.length)).toEqual([4, 5, 8])
    expect([...forTable, ...forRow, ...forColumn]).not.toContain(false)
  })
})

describe('the corner of a table', () => {
  const corner = (opened: Opened): HTMLElement | undefined =>
    handles(opened, '.table-grip[data-axis="table"]')[0]

  it('selects the whole table in one press, for the table’s own tools', () => {
    const opened = open()
    rest(opened, 'eu')
    expect(corner(opened)?.dataset['state']).toBeUndefined()

    pick(corner(opened))

    expect(within(toolbar()).getByRole('button', { name: 'Table settings' })).toBeVisible()
    expect(corner(opened)?.dataset['state']).toBe('selected')
    const grips = handles(opened, '.table-grip:not([data-axis="table"])')
    expect(grips.map((grip) => grip.dataset['state'])).toEqual(grips.map(() => undefined))
  })

  it('is one handle per table, however many rows and columns it grows to', () => {
    const opened = open()

    fireEvent.click(handles(opened, '.table-insert[data-axis="row"]')[1] as HTMLElement)

    expect(handles(opened, '.table-grip[data-axis="table"]')).toHaveLength(1)
  })

  it('is not selected by a row, or by the caret in a cell', () => {
    const opened = open()
    rest(opened, 'eu')
    pick(handles(opened, '.table-grip[data-axis="row"]')[1])

    expect(corner(opened)?.dataset['state']).toBeUndefined()
  })

  it('leaves the caret where it was when it is pressed', () => {
    const opened = open()

    expect(fireEvent.pointerDown(corner(opened) as HTMLElement)).toBe(false)
  })
})

/** Selects the whole of rows `first` to `last` of the first table, as dragging across their grips would. */
function selectRows(editor: Editor, first: number, last: number): void {
  const { state } = editor
  const map = TableMap.get(state.doc.child(0))
  const start = 1
  const from = start + (map.map[first * map.width] ?? 0)
  const to = start + (map.map[last * map.width + map.width - 1] ?? 0)
  editor.view.dispatch(state.tr.setSelection(CellSelection.create(state.doc, from, to)))
}

/** A right-click on an element, as the browser raises it: a context menu event that bubbles. */
function rightClick(element: HTMLElement | undefined): void {
  if (element === undefined) throw new Error('There is no such handle.')
  act(() => {
    fireEvent.contextMenu(element, { clientX: 5, clientY: 5 })
  })
}

const menu = (): HTMLElement => screen.getByRole('menu', { name: 'Context menu' })

describe('a right-click on a handle', () => {
  it('on the corner is a menu about the whole table, which it selects and keeps selected', () => {
    const opened = open()
    rest(opened, 'eu')

    rightClick(handles(opened, '.table-grip[data-axis="table"]')[0])

    expect(handles(opened, '.table-grip[data-axis="table"]')[0]?.dataset['state']).toBe('selected')
    for (const name of ['Cut', 'Copy', 'Paste', 'Copy as Markdown', 'Clear cells']) {
      expect(within(menu()).getByRole('menuitem', { name })).toBeVisible()
    }
  })

  it('on a row grip is a menu about that row', () => {
    const opened = open()
    rest(opened, 'eu')

    rightClick(handles(opened, '.table-grip[data-axis="row"]')[2])

    expect(
      handles(opened, '.table-grip[data-axis="row"]').map((grip) => grip.dataset['state']),
    ).toEqual([undefined, undefined, 'selected'])
    expect(within(menu()).getByRole('menuitem', { name: 'Delete row' })).toBeVisible()
  })

  it('on a column grip is a menu about that column', () => {
    const opened = open()
    rest(opened, 'eu')

    rightClick(handles(opened, '.table-grip[data-axis="column"]')[1])

    expect(
      handles(opened, '.table-grip[data-axis="column"]').map((grip) => grip.dataset['state']),
    ).toEqual([undefined, 'selected'])
    expect(within(menu()).getByRole('menuitem', { name: 'Delete column' })).toBeVisible()
  })

  it('keeps the rows already selected when it is on one of them', () => {
    const opened = open(`${TABLE}| fr | Ops |
`)
    rest(opened, 'eu')
    const editor = opened.ref.current?.editor
    if (editor === null || editor === undefined) throw new Error('The editor did not mount.')
    pick(handles(opened, '.table-grip[data-axis="row"]')[1])
    act(() => {
      selectRows(editor, 1, 2)
    })

    rightClick(handles(opened, '.table-grip[data-axis="row"]')[2])

    expect(within(menu()).getByRole('menuitem', { name: 'Delete rows' })).toBeVisible()
  })

  it('does not select anything by a press of another button than the main one', () => {
    const opened = open()
    rest(opened, 'eu')
    const corner = handles(opened, '.table-grip[data-axis="table"]')[0]

    if (corner !== undefined) fireEvent.pointerDown(corner, { button: 2 })

    expect(corner?.dataset['state']).toBeUndefined()
  })

  it('on a "+" leaves the selection as it was', () => {
    const opened = open()
    rest(opened, 'eu')
    pick(handles(opened, '.table-grip[data-axis="row"]')[1])

    rightClick(handles(opened, '.table-insert[data-axis="row"]')[2])

    expect(handles(opened, '.table-grip[data-axis="row"]')[1]?.dataset['state']).toBe('selected')
  })
})

describe('the "+" on a border', () => {
  it('has one more than there are lines, and none above the header row', () => {
    const opened = open()

    const columns = handles(opened, '.table-insert[data-axis="column"]')
    const rows = handles(opened, '.table-insert[data-axis="row"]')

    expect(columns).toHaveLength(3)
    expect(rows).toHaveLength(4)
    expect(rows.map((insert) => insert.hidden)).toEqual([true, false, false, false])
  })

  it('is offered above the first row when the rows are the only headers', () => {
    const opened = open(`:::table{headers=row}\n${TABLE}:::\n`)

    expect(handles(opened, '.table-insert[data-axis="row"]')[0]?.hidden).toBe(false)
  })

  it('inserts a row there, with the caret in its first cell', async () => {
    const opened = open()
    rest(opened, 'Region')

    fireEvent.click(handles(opened, '.table-insert[data-axis="row"]')[2] as HTMLElement)
    await opened.user.keyboard('typed')

    expect(markdown(opened)).toContain('| eu | Platform |\n| typed | |\n| us | Data |')
  })

  it('inserts a column between two, and after the last', () => {
    const opened = open()
    const insert = (at: number): void => {
      fireEvent.click(handles(opened, '.table-insert[data-axis="column"]')[at] as HTMLElement)
    }

    insert(1)
    expect(markdown(opened)).toContain('| Region | | Owner |')
    insert(3)
    expect(markdown(opened)).toContain('| Region | | Owner | |')
  })

  it('offers none before the first column, where the corner and the block’s own "+" are', () => {
    const opened = open()

    const columns = handles(opened, '.table-insert[data-axis="column"]')

    expect(columns.map((insert) => insert.hidden)).toEqual([true, false, false])
  })

  it('does not take the caret out of the table when it is pressed', () => {
    const opened = open()
    rest(opened, 'eu')
    const insert = handles(opened, '.table-insert[data-axis="row"]')[1] as HTMLElement

    const notPrevented = fireEvent.pointerDown(insert)

    expect(notPrevented).toBe(false)
  })
})

describe('the handles follow the table', () => {
  it('grow and shrink with its rows and columns', () => {
    const opened = open()
    rest(opened, 'eu')
    expect(handles(opened, '.table-grip')).toHaveLength(1 + 2 + 3)

    fireEvent.click(handles(opened, '.table-insert[data-axis="row"]')[1] as HTMLElement)

    expect(handles(opened, '.table-grip[data-axis="row"]')).toHaveLength(4)
    expect(handles(opened, '.table-insert[data-axis="row"]')).toHaveLength(5)
  })

  it('lose the border of a column that goes', async () => {
    const opened = open('| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n')
    rest(opened, 'a')
    expect(handles(opened, '.table-column-border')).toHaveLength(2)

    pick(handles(opened, '.table-grip[data-axis="column"]')[2])
    await opened.user.click(within(toolbar()).getByRole('button', { name: 'Delete column' }))

    expect(handles(opened, '.table-column-border')).toHaveLength(1)
  })

  it('are hidden from assistive technology, which has the toolbar and the keyboard', () => {
    const opened = open()

    expect(opened.container.querySelector('.table-handles')).toHaveAttribute('aria-hidden', 'true')
  })
})

const cellOf = (element: HTMLElement): HTMLTableCellElement | undefined =>
  element instanceof HTMLTableCellElement ? element : undefined
const rowOf = (element: HTMLElement): HTMLTableRowElement | undefined =>
  element instanceof HTMLTableRowElement ? element : undefined
const tableOf = (element: HTMLElement): HTMLTableElement | undefined =>
  element instanceof HTMLTableElement ? element : undefined

/**
 * jsdom lays nothing out, so the table is given a grid to be measured against:
 * every cell is 100 wide and every row 40 tall, and the card is the width of
 * the reading column.
 */
function layOut(): void {
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(
    function (this: HTMLElement) {
      return (cellOf(this)?.cellIndex ?? 0) * 100
    },
  )
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(
    function (this: HTMLElement) {
      return (rowOf(this)?.rowIndex ?? 0) * 40
    },
  )
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains('table-block')) return 680
      const table = tableOf(this)
      return table === undefined
        ? cellOf(this) === undefined
          ? 0
          : 100
        : (table.rows[0]?.cells.length ?? 0) * 100
    },
  )
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      const table = tableOf(this)
      return table === undefined ? (rowOf(this) === undefined ? 0 : 40) : table.rows.length * 40
    },
  )
}

describe('dragging a grip', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('moves a column to where it is dropped, in one undo step', () => {
    layOut()
    const opened = open()
    const root = opened.container.ownerDocument.documentElement
    const [grip] = handles(opened, '.table-grip[data-axis="column"]')
    if (grip === undefined) throw new Error('There is no grip.')

    fireEvent.pointerDown(grip, { pointerId: 1, clientX: 50, clientY: 0 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 52, clientY: 0 })
    expect(root.dataset['dragging']).toBeUndefined()
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 170, clientY: 0 })
    expect(root.dataset['dragging']).toBe('true')
    expect(opened.container.querySelector('.table-handles')).toHaveAttribute(
      'data-dragging',
      'column',
    )
    fireEvent.pointerUp(grip, { pointerId: 1, clientX: 170, clientY: 0 })

    expect(root.dataset['dragging']).toBeUndefined()
    expect(markdown(opened)).toContain('| Owner | Region |')
  })

  it('moves a row up, and leaves everything as it was when dropped where it started', () => {
    layOut()
    const opened = open(`${TABLE}| fr | Ops |\n`)
    const [, , grip] = handles(opened, '.table-grip[data-axis="row"]')
    if (grip === undefined) throw new Error('There is no grip.')

    fireEvent.pointerDown(grip, { pointerId: 1, clientX: 0, clientY: 100 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 0, clientY: 140 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 0, clientY: 100 })
    fireEvent.pointerUp(grip, { pointerId: 1, clientX: 0, clientY: 100 })
    expect(markdown(opened)).toContain('| eu | Platform |\n| us | Data |\n| fr | Ops |')

    fireEvent.pointerDown(grip, { pointerId: 1, clientX: 0, clientY: 100 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 0, clientY: 40 })
    fireEvent.pointerUp(grip, { pointerId: 1, clientX: 0, clientY: 40 })
    expect(markdown(opened)).toContain('| us | Data |\n| eu | Platform |\n| fr | Ops |')
  })
})

describe('dragging a border', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets the shares of the two columns either side, with a readout while it moves', () => {
    layOut()
    const opened = open()
    const [border] = handles(opened, '.table-column-border')
    const readout = opened.container.querySelector<HTMLElement>('.table-readout')
    if (border === undefined || readout === null) throw new Error('There is no border.')
    expect(readout.hidden).toBe(true)

    fireEvent.pointerDown(border, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(border, { pointerId: 1, clientX: 120 })
    expect(readout).toHaveTextContent('60% · 40%')
    expect(readout.hidden).toBe(false)
    fireEvent.pointerMove(border, { pointerId: 1, clientX: 130 })
    fireEvent.pointerUp(border, { pointerId: 1, clientX: 130 })

    expect(readout.hidden).toBe(true)
    expect(markdown(opened)).toContain('columns="65fr 35fr"')
  })

  it('leaves the table alone when it is pressed and let go', () => {
    layOut()
    const opened = open()
    const [border] = handles(opened, '.table-column-border')
    const before = markdown(opened)

    fireEvent.pointerDown(border as HTMLElement, { pointerId: 1, clientX: 100 })
    fireEvent.pointerUp(border as HTMLElement, { pointerId: 1, clientX: 100 })

    expect(markdown(opened)).toBe(before)
  })
})

function edgeOf(opened: Opened): HTMLElement {
  const edge = opened.container.querySelector<HTMLElement>('.table-width-handle')
  if (edge === null) throw new Error('There is no edge handle.')
  return edge
}

describe('dragging the trailing edge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const TRACKS = '100px 140px 680px 140px 220px'

  it('sets the width, snapping to a track, with its name in the readout', () => {
    layOut()
    const opened = open()
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = real(element, pseudo)
      return element.classList.contains('document-editor-content')
        ? new Proxy(style, {
            get: (target, name) =>
              name === 'gridTemplateColumns'
                ? TRACKS
                : (Reflect.get(target, name, target) as unknown),
          })
        : style
    })
    const edge = edgeOf(opened)
    const readout = opened.container.querySelector<HTMLElement>('.table-readout')

    fireEvent.pointerDown(edge, { pointerId: 1, clientX: 0 })
    fireEvent.pointerMove(edge, { pointerId: 1, clientX: 600 })
    expect(readout).toHaveTextContent('Full')
    fireEvent.pointerUp(edge, { pointerId: 1, clientX: 600 })

    expect(markdown(opened)).toContain('width="full"')
  })

  it('does nothing in a grid it cannot read the tracks of', () => {
    layOut()
    const opened = open()
    const before = markdown(opened)

    fireEvent.pointerDown(edgeOf(opened), { pointerId: 1, clientX: 0 })

    expect(markdown(opened)).toBe(before)
    expect(opened.container.querySelector('.table-handles')).not.toHaveAttribute('data-dragging')
  })
})

/** Lets the animation frame the handles place themselves in go by. */
async function placed(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
}

describe('the handles’ place', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is written as where each lies along its axis, and follows a sideways scroll', async () => {
    layOut()
    const opened = open()
    const layer = opened.container.querySelector<HTMLElement>('.table-handles')

    await placed()

    expect(layer?.style.getPropertyValue('--table-width')).toBe('200px')
    expect(layer?.style.getPropertyValue('--table-height')).toBe('120px')
    const columns = handles(opened, '.table-grip[data-axis="column"]')
    expect(columns.map((grip) => grip.style.getPropertyValue('--start'))).toEqual(['0px', '100px'])
    const inserts = handles(opened, '.table-insert[data-axis="column"]')
    expect(inserts.map((insert) => insert.style.getPropertyValue('--start'))).toEqual([
      '0px',
      '100px',
      '200px',
    ])
    const scroller = opened.container.querySelector('.table-scroll')
    if (scroller === null) throw new Error('There is no scroller.')
    scroller.scrollLeft = 30
    fireEvent.scroll(scroller)
    await placed()
    expect(columns[0]?.style.getPropertyValue('--start')).toBe('-30px')
  })
})
