import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { VirtualTree, type VirtualTreeRow } from './virtual-tree.tsx'

/** jsdom has no layout, so the window has no size: this gives the scrolling region one. */
function aWindowOf(height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 280,
    height,
    top: 0,
    left: 0,
    right: 280,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: height,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 280 })
}

beforeEach(() => {
  aWindowOf(400)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const node = (
  n: number,
  overrides: Partial<Extract<VirtualTreeRow, { kind: 'node' }>> = {},
): VirtualTreeRow => ({
  kind: 'node',
  id: `doc-${String(n)}`,
  label: `Document ${String(n)}`,
  link: { to: `#doc-${String(n)}` },
  depth: 0,
  position: n,
  siblings: 100,
  expandable: false,
  expanded: false,
  actions: [],
  ...overrides,
})

function open(
  rows: readonly VirtualTreeRow[],
  props: Partial<Parameters<typeof VirtualTree>[0]> = {},
) {
  const onToggle = vi.fn<(id: string) => void>()
  const onMore = vi.fn<(id: string) => void>()
  const view = render(
    <VirtualTree label="Documents" rows={rows} onToggle={onToggle} onMore={onMore} {...props} />,
  )
  return { onToggle, onMore, ...view }
}

const section = (id: string, label: string): VirtualTreeRow => ({ kind: 'section', id, label })

/** The rows drawn with the pin on them: in the flow of the list, not placed in it. */
const pinned = () =>
  screen
    .getAllByRole('listitem')
    .filter((item) => item.className.split(' ').includes('sticky'))
    .map((item) => item.textContent)

describe('VirtualTree', () => {
  it('draws only the rows in view, however many there are', () => {
    const rows = Array.from({ length: 50_000 }, (_, n) => node(n + 1))

    open(rows)

    const drawn = screen.getAllByRole('listitem').length
    expect(drawn).toBeGreaterThan(5)
    expect(drawn).toBeLessThan(60)
  })

  it('brings the document being read into view, however far down it is', async () => {
    const rows = Array.from({ length: 2000 }, (_, n) => node(n + 1))

    open(rows, { currentId: 'doc-1500' })

    // Its row is a long way down: the region is scrolled to it, and (as in a browser) the
    // scroll that follows is what moves the window.
    const scroller = screen.getByRole('navigation', { name: 'Documents' }).firstElementChild
    if (scroller === null) throw new Error('The tree has no scrolling region.')
    expect(scroller.scrollTop).toBeGreaterThan(40_000)
    fireEvent.scroll(scroller)
    expect(await screen.findByRole('link', { name: 'Document 1500' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('keeps the collection whose documents are at the top of the view at the top of it', () => {
    const rows = [
      section('a', 'Architecture'),
      ...Array.from({ length: 100 }, (_, n) => node(n + 1)),
      section('b', 'Runbooks'),
      ...Array.from({ length: 100 }, (_, n) => node(n + 101)),
    ]
    open(rows)
    const scroller = screen.getByRole('navigation', { name: 'Documents' }).firstElementChild
    if (scroller === null) throw new Error('The tree has no scrolling region.')
    // At the top, its own heading is the first row, and pinned where it already is.
    expect(pinned()).toEqual(['Architecture'])

    // Well down its documents, its heading is above the view and still drawn, and pinned.
    scroller.scrollTop = 60 * 28
    fireEvent.scroll(scroller)
    expect(screen.queryByRole('link', { name: 'Document 1' })).toBeNull()
    expect(pinned()).toEqual(['Architecture'])

    // The next heading takes over as it reaches the pinned one, rather than scrolling up beneath it.
    scroller.scrollTop = 99 * 28
    fireEvent.scroll(scroller)
    expect(pinned()).toEqual(['Architecture'])
    scroller.scrollTop = 100 * 28
    fireEvent.scroll(scroller)
    expect(pinned()).toEqual(['Runbooks'])

    // Past the next heading, that one takes over.
    scroller.scrollTop = 130 * 28
    fireEvent.scroll(scroller)
    expect(pinned()).toEqual(['Runbooks'])
  })

  it('says where each row is among its siblings and how deep, since the rows around it are not drawn', () => {
    open([node(3, { depth: 2, position: 3, siblings: 40 })])

    const item = screen.getByRole('listitem')
    expect(item).toHaveAttribute('aria-level', '3')
    expect(item).toHaveAttribute('aria-posinset', '3')
    expect(item).toHaveAttribute('aria-setsize', '40')
  })

  it('marks the document being read, and only that one', () => {
    open([node(1), node(2)], { currentId: 'doc-2' })

    expect(screen.getByRole('link', { name: 'Document 2' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Document 1' })).not.toHaveAttribute('aria-current')
  })

  it('opens and closes a row that has documents under it, saying which it is', async () => {
    const { onToggle } = open([
      node(1, { expandable: true, expanded: false }),
      node(2, { expandable: true, expanded: true }),
      node(3),
    ])

    const closed = screen.getByRole('button', { name: 'Expand Document 1' })
    expect(closed).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Collapse Document 2' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.queryByRole('button', { name: /(Expand|Collapse) Document 3/u })).toBeNull()

    await userEvent.click(closed)

    expect(onToggle).toHaveBeenCalledWith('doc-1')
  })

  it('loads more when asked, and not again while it is loading', async () => {
    const { onMore } = open([
      { kind: 'more', id: 'more-a', depth: 0, label: 'Show more', busy: false },
      { kind: 'more', id: 'more-b', depth: 0, label: 'Show more', busy: true },
    ])

    const buttons = screen.getAllByRole('button', { name: 'Show more' })
    await userEvent.click(buttons[0] as HTMLElement)

    expect(onMore).toHaveBeenCalledWith('more-a')
    expect(buttons[1]).toBeDisabled()
  })

  it('says what it is waiting for in a row of its own', () => {
    open([{ kind: 'status', id: 'loading-a', depth: 1, label: 'Loading…', busy: true }])

    expect(screen.getByText('Loading…')).toBeVisible()
  })

  it('gives a collection its name, its “new document” control and its menu', async () => {
    const onSelect = vi.fn<() => void>()
    open([
      {
        kind: 'section',
        id: 'architecture',
        label: 'Architecture',
        action: { label: 'New document in Architecture', onSelect },
        actions: [{ label: 'Rename…', onSelect: vi.fn<() => void>() }],
      },
    ])

    expect(screen.getByText('Architecture')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'New document in Architecture' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: /More actions for Architecture/u }),
    ).toBeInTheDocument()
  })

  it('draws a row’s own menu', () => {
    open([node(1, { actions: [{ label: 'New child document', onSelect: vi.fn<() => void>() }] })])

    const item = screen.getByRole('listitem')
    expect(
      within(item).getByRole('button', { name: /More actions for Document 1/u }),
    ).toBeInTheDocument()
  })

  it('has no accessibility violations', async () => {
    const { container } = open([
      {
        kind: 'section',
        id: 'architecture',
        label: 'Architecture',
        action: { label: 'New document in Architecture', onSelect: vi.fn<() => void>() },
      },
      node(1, { expandable: true }),
      node(2, { depth: 1 }),
    ])

    await expectNoAccessibilityViolations(container)
  })
})
