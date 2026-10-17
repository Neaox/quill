// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { addTableViewer } from './table-viewer.ts'
import { enhanceTables } from './tables.ts'

function showModal(this: HTMLDialogElement): void {
  this.setAttribute('open', '')
}

function close(this: HTMLDialogElement): void {
  this.removeAttribute('open')
  this.dispatchEvent(new Event('close'))
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = showModal
  HTMLDialogElement.prototype.close = close
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'matchMedia')
  document.body.replaceChildren()
  document.documentElement.classList.remove('lightbox-open')
})

const BLOCK = `<div class="table-block" data-freeze="header" data-headers="both"><div class="table-scroll" tabindex="0" role="group" aria-labelledby="c"><table>
<caption id="c"><span class="table-caption-text">Budgets</span></caption>
<thead><tr><th scope="col">Region</th><th scope="col" class="align-numeric">Budget</th></tr></thead>
<tbody><tr><th scope="row">us</th><td class="align-numeric">90</td></tr><tr><th scope="row">eu</th><td class="align-numeric">120</td></tr></tbody>
</table></div></div>`

function mount(html = BLOCK): { block: HTMLElement; scroller: HTMLElement } {
  document.body.innerHTML = `<article>${html}</article>`
  const block = document.querySelector<HTMLElement>('.table-block')
  const scroller = document.querySelector<HTMLElement>('.table-scroll')
  if (block === null || scroller === null) throw new Error('no table')
  return { block, scroller }
}

function expandButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('.table-expand')
  if (button === null) throw new Error('no expand button')
  return button
}

function control(action: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`dialog [data-action="${action}"]`)
  if (button === null) throw new Error(`no ${action} control`)
  return button
}

/** A ResizeObserver whose callbacks run when the test says. */
function observer() {
  const callbacks: (() => void)[] = []
  class Observer {
    constructor(callback: () => void) {
      callbacks.push(callback)
    }
    observe = vi.fn<(target: Element) => void>()
    disconnect = vi.fn<() => void>()
  }
  return { Observer, resize: () => callbacks.forEach((callback) => callback()) }
}

function sizes(stageWidth: number, tableWidth: number): void {
  const stage = document.querySelector<HTMLElement>('.lightbox-stage')
  const table = document.querySelector('dialog table')
  if (stage === null || table === null) throw new Error('no stage')
  Object.defineProperty(stage, 'clientWidth', { value: stageWidth, configurable: true })
  Object.defineProperty(table, 'scrollWidth', { value: tableWidth, configurable: true })
}

describe('the table viewer', () => {
  it('gives the table an expand button named by its caption', () => {
    mount()
    addTableViewer(...(Object.values(mount()) as [HTMLElement, HTMLElement]))

    expect(expandButton().getAttribute('aria-label')).toBe('Expand table: Budgets')
    expect(expandButton().type).toBe('button')
  })

  it('names an uncaptioned table plainly, in the button and the viewer', () => {
    const { block, scroller } = mount(BLOCK.replace(/<caption.*<\/caption>/u, ''))
    addTableViewer(block, scroller)

    expect(expandButton().getAttribute('aria-label')).toBe('Expand table')
    expandButton().click()
    expect(document.querySelector('dialog')?.getAttribute('aria-label')).toBe('Table')
    expect(document.querySelector('.lightbox-caption')).toBeNull()
  })

  it('moves the table into the viewer and back, keeping the block’s height, and returns focus', () => {
    const { block, scroller } = mount()
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 240))
    addTableViewer(block, scroller)

    expandButton().focus()
    expandButton().click()
    const dialog = document.querySelector('dialog')
    expect(dialog?.getAttribute('aria-label')).toBe('Budgets')
    expect(dialog?.querySelector('.lightbox-stage-table > .table-block > .table-scroll')).toBe(
      scroller,
    )
    const frame = scroller.parentElement
    expect(frame?.getAttribute('data-freeze')).toBe('header')
    expect(frame?.getAttribute('data-headers')).toBe('both')
    expect(frame?.hasAttribute('data-responsive')).toBe(false)
    expect(block.style.minHeight).toBe('240px')
    expect(document.querySelector('.lightbox-caption')?.textContent).toBe('Budgets')
    expect(document.documentElement.classList.contains('lightbox-open')).toBe(true)

    control('close').click()
    expect(block.querySelector(':scope > .table-scroll')).toBe(scroller)
    expect(block.hasAttribute('style')).toBe(false)
    expect(document.activeElement).toBe(expandButton())
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('sorts inside the viewer, and the order is still there when it closes', () => {
    const { block } = mount()
    enhanceTables(document, {
      requestFrame: () => undefined,
      viewportHeight: () => 800,
      onViewportResize: () => () => undefined,
      observeResize: undefined,
      scrollTimelines: true,
      locale: 'en',
    })

    expandButton().click()
    document.querySelector<HTMLButtonElement>('dialog .table-sort')?.click()
    control('close').click()

    expect(
      [...block.querySelectorAll('.table-scroll tbody th')].map((cell) => cell.textContent),
    ).toEqual(['eu', 'us'])
    expect(block.querySelector('.table-scroll thead th')?.getAttribute('aria-sort')).toBe(
      'ascending',
    )
  })

  it('copies the table as CSV and as Markdown, and says so', async () => {
    const { block, scroller } = mount()
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    addTableViewer(block, scroller, { clipboard: { writeText } })
    expandButton().click()

    control('csv').click()
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Region,Budget\r\nus,90\r\neu,120')
      // Inside the open dialog, where a live region is heard.
      expect(document.querySelector('dialog > .code-copy-status')?.textContent).toBe(
        'Table copied as CSV',
      )
    })

    control('markdown').click()
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenLastCalledWith(
        '| Region | Budget |\n| --- | --: |\n| us | 90 |\n| eu | 120 |',
      )
    })
    // Named by the words it shows (WCAG 2.5.3).
    expect(control('csv').textContent).toBe('Copy CSV')
    expect(control('csv').getAttribute('aria-label')).toBe('Copy CSV')
    expect(control('markdown').textContent).toBe('Copy Markdown')
  })

  it('says so when the browser refuses to copy', async () => {
    const { block, scroller } = mount()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    addTableViewer(block, scroller, {
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    })
    expandButton().click()

    control('csv').click()
    await vi.waitFor(() => {
      expect(document.querySelector('dialog > .code-copy-status')?.textContent).toBe(
        'The browser refused to copy the table',
      )
    })
  })

  it('offers Fit width only while the table is wider than the stage, and fits it', () => {
    const { block, scroller } = mount()
    const { Observer, resize } = observer()
    addTableViewer(block, scroller, { ResizeObserver: Observer })
    expandButton().click()
    const fit = control('fit')
    expect(fit.hidden).toBe(true)

    sizes(300, 600)
    resize()
    expect(fit.hidden).toBe(false)
    expect(fit.getAttribute('aria-label')).toBe('Fit width')

    fit.click()
    const frame = scroller.parentElement
    expect(frame?.hasAttribute('data-fit')).toBe(true)
    expect(frame?.style.getPropertyValue('--table-fit')).toBe('0.5')
    expect(fit.getAttribute('aria-label')).toBe('Actual size')
    expect(fit.dataset['state']).toBe('on')

    fit.click()
    expect(frame?.hasAttribute('data-fit')).toBe(false)
    expect(frame?.style.getPropertyValue('--table-fit')).toBe('1')
    expect(fit.getAttribute('aria-label')).toBe('Fit width')
  })

  it('turns the fit off and goes when the stage grows to hold the table, moving focus on', () => {
    const { block, scroller } = mount()
    const { Observer, resize } = observer()
    addTableViewer(block, scroller, { ResizeObserver: Observer })
    expandButton().click()
    sizes(300, 600)
    resize()
    const fit = control('fit')
    fit.click()
    fit.focus()

    sizes(800, 600)
    resize()

    expect(fit.hidden).toBe(true)
    expect(scroller.parentElement?.hasAttribute('data-fit')).toBe(false)
    expect(document.activeElement).toBe(control('csv'))
  })

  it('leaves focus alone when the control that goes did not have it', () => {
    const { block, scroller } = mount()
    const { Observer, resize } = observer()
    addTableViewer(block, scroller, { ResizeObserver: Observer })
    expandButton().click()
    sizes(300, 600)
    resize()
    control('markdown').focus()

    sizes(800, 600)
    resize()
    expect(document.activeElement).toBe(control('markdown'))
  })

  it('asks a phone held upright to turn for a table wider than the screen, and says how to scroll', () => {
    const { block, scroller } = mount()
    const table = scroller.querySelector('table')
    if (table === null) throw new Error('no table')
    Object.defineProperty(table, 'scrollWidth', { value: 2000, configurable: true })
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 375,
      configurable: true,
    })
    window.matchMedia = (media: string) =>
      ({
        matches: true,
        media,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList
    addTableViewer(block, scroller)
    expandButton().click()

    const hint = document.querySelector<HTMLElement>('.lightbox-hint')
    expect(hint?.dataset['turn']).toBe('true')
    control('close').click()

    Object.defineProperty(table, 'scrollWidth', { value: 10, configurable: true })
    expandButton().click()
    expect(document.querySelector('.lightbox-hint')?.textContent).toBe('Swipe to scroll the table')
  })

  it('says nothing to a mouse, which knows how to scroll', () => {
    const { block, scroller } = mount()
    addTableViewer(block, scroller)
    expandButton().click()

    expect(document.querySelector<HTMLElement>('.lightbox-hint')?.hidden).toBe(true)
  })

  it('closes an open viewer, and takes its button away, when the page is done with it', () => {
    const { block, scroller } = mount()
    const dispose = addTableViewer(block, scroller)
    expandButton().click()

    dispose()
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.querySelector('.table-expand')).toBeNull()
    expect(block.querySelector(':scope > .table-scroll')).toBe(scroller)
    dispose()
  })
})

describe('the table viewer and the block’s own style', () => {
  it('leaves the block’s other properties when it gives its height back', () => {
    const { block, scroller } = mount()
    block.style.setProperty('--table-frozen-width', '80px')
    addTableViewer(block, scroller)

    expandButton().click()
    control('close').click()

    expect(block.getAttribute('style')).toBe('--table-frozen-width: 80px;')
  })
})

describe('the table viewer, for keyboard and screen reader', () => {
  it('comes first in the card, where it is drawn', () => {
    const { block, scroller } = mount()
    addTableViewer(block, scroller)

    expect(block.firstElementChild).toBe(expandButton())
  })

  it('takes the sort announcements into the dialog while it is open, and back', () => {
    const { block } = mount()
    enhanceTables(document, {
      requestFrame: () => undefined,
      viewportHeight: () => 800,
      onViewportResize: () => () => undefined,
      observeResize: undefined,
      scrollTimelines: true,
      locale: 'en',
    })

    expandButton().click()
    expect(document.querySelector('dialog .table-announcement')).not.toBeNull()
    control('close').click()
    expect(block.querySelector(':scope > .table-announcement')).not.toBeNull()
  })
})
