// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TableEnvironment, TableWindow } from './tables.ts'
import { browserTableEnvironment, enhanceTables } from './tables.ts'

/** A table block as `@quill/markdown` renders one (ADR-040). */
function tableBlock(
  attributes = '',
  rows = [
    ['eu', '120'],
    ['us', '9'],
    ['ap', '1,000'],
  ],
) {
  const body = rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
  return `<div class="table-block"${attributes}><div class="table-scroll" tabindex="0" role="group" aria-label="Table"><table>
<thead><tr><th scope="col">Region</th><th scope="col" class="align-numeric">Budget</th></tr></thead>
<tbody>${body.join('')}</tbody></table></div></div>`
}

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<article>${html}</article>`
  const article = document.querySelector('article')
  if (article === null) throw new Error('no article')
  return article
}

/** A browser whose frames run when told to, and whose viewport is `height` tall. */
function environment(overrides: Partial<TableEnvironment> = {}) {
  const frames: (() => void)[] = []
  const resizers: (() => void)[] = []
  const observed: Element[] = []
  let observer: (() => void) | undefined
  const env: TableEnvironment = {
    requestFrame: (callback) => {
      frames.push(callback)
    },
    viewportHeight: () => 800,
    onViewportResize: (callback) => {
      resizers.push(callback)
      return () => resizers.splice(resizers.indexOf(callback), 1)
    },
    observeResize: (callback) => {
      observer = callback
      return {
        observe: (target) => observed.push(target),
        disconnect: () => {
          observer = undefined
        },
      }
    },
    scrollTimelines: false,
    locale: 'en',
    ...overrides,
  }
  const flush = (): void => {
    for (const frame of frames.splice(0)) frame()
  }
  return {
    env,
    flush,
    frames,
    resizers,
    observed,
    resize: () => observer?.(),
  }
}

function rect(height: number, width = 300, top = 0): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  }
}

/** Gives the elements matching `selector` a size, as layout would. */
function sized(selector: string, size: DOMRect): void {
  for (const element of document.querySelectorAll(selector)) {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(size)
  }
}

function scrolled(element: Element, left: number, width = 900, client = 300): void {
  Object.defineProperty(element, 'scrollLeft', { value: left, configurable: true })
  Object.defineProperty(element, 'scrollWidth', { value: width, configurable: true })
  Object.defineProperty(element, 'clientWidth', { value: client, configurable: true })
}

function cellTexts(column: number): string[] {
  return [...document.querySelectorAll('.table-scroll tbody tr')].map(
    (row) => row.children[column]?.textContent ?? '',
  )
}

function header(name: string): HTMLButtonElement {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('.table-scroll .table-sort'),
  ].find((each) => each.textContent === name)
  if (button === undefined) throw new Error(`no sort button ${name}`)
  return button
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('sorting', () => {
  it('gives every header a sort button holding its name', () => {
    mount(tableBlock())
    enhanceTables(document, environment().env)

    const buttons = document.querySelectorAll('.table-scroll th > button.table-sort')
    expect([...buttons].map((button) => button.textContent)).toEqual(['Region', 'Budget'])
    expect(buttons[0]?.getAttribute('type')).toBe('button')
    expect(buttons[0]?.querySelector('.table-sort-icon')?.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('.table-block')?.getAttribute('data-sortable')).toBe('true')
  })

  it('sorts ascending, then descending, then back to the order as written', () => {
    mount(tableBlock())
    enhanceTables(document, environment().env)
    const budget = header('Budget')
    const th = budget.closest('th')
    const status = document.querySelector('.table-announcement')

    budget.click()
    expect(cellTexts(1)).toEqual(['9', '120', '1,000'])
    expect(th?.getAttribute('aria-sort')).toBe('ascending')
    expect(status?.getAttribute('role')).toBe('status')
    expect(status?.textContent).toBe('Sorted by Budget, ascending')

    budget.click()
    expect(cellTexts(1)).toEqual(['1,000', '120', '9'])
    expect(th?.getAttribute('aria-sort')).toBe('descending')

    budget.click()
    expect(cellTexts(1)).toEqual(['120', '9', '1,000'])
    expect(th?.hasAttribute('aria-sort')).toBe(false)
    expect(status?.textContent).toBe('Rows in their original order')
  })

  it('starts a new column ascending, and clears the old one', () => {
    mount(tableBlock())
    enhanceTables(document, environment().env)

    header('Budget').click()
    header('Region').click()

    expect(cellTexts(0)).toEqual(['ap', 'eu', 'us'])
    expect(document.querySelectorAll('.table-scroll [aria-sort]')).toHaveLength(1)
  })

  it('leaves a table alone whose author turned sorting off, or that has one row', () => {
    mount(`${tableBlock(' data-sort="off"')}${tableBlock('', [['eu', '1']])}`)
    enhanceTables(document, environment().env)

    expect(document.querySelector('.table-sort')).toBeNull()
    expect(document.querySelector('.table-announcement')).toBeNull()
  })

  it('treats a missing cell as empty', () => {
    mount(tableBlock('', [['eu', '3'], ['us']]))
    enhanceTables(document, environment().env)

    header('Budget').click()
    expect(cellTexts(0)).toEqual(['eu', 'us'])
  })

  it('leaves a table with no header, or no body, alone', () => {
    mount(
      '<div class="table-block"><div class="table-scroll"><table><tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody></table></div></div>' +
        '<div class="table-block"><div class="table-scroll"><table><thead><tr><th>A</th></tr></thead></table></div></div>' +
        '<div class="table-block"><div class="table-scroll"></div></div>' +
        '<div class="table-block"><table></table></div>',
    )
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    expect(document.querySelector('.table-sort')).toBeNull()
    expect(document.querySelectorAll('[data-enhanced]')).toHaveLength(2)
  })
})

describe('the hanging header', () => {
  it('hangs a copy of the header above a table taller than the viewport', () => {
    mount(tableBlock())
    sized('table', rect(1200, 640))
    sized('th', rect(40, 320))
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    const strip = document.querySelector('.table-block > .table-sticky-head')
    expect(strip?.getAttribute('aria-hidden')).toBe('true')
    expect(strip?.nextElementSibling?.classList.contains('table-scroll')).toBe(true)
    expect(document.querySelector('.table-block')?.hasAttribute('data-sticky-head')).toBe(true)
    const copy = strip?.querySelector('table')
    expect(copy?.style.width).toBe('640px')
    expect([...(copy?.querySelectorAll('col') ?? [])].map((col) => col.style.width)).toEqual([
      '320px',
      '320px',
    ])
    expect(copy?.querySelector('button')?.tabIndex).toBe(-1)
  })

  it('hangs none for a table that fits in the viewport, unless its author froze the header', () => {
    mount(
      `${tableBlock()}${tableBlock(' data-freeze="header"')}${tableBlock(' data-freeze="none"')}`,
    )
    sized('table', rect(200))
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    const blocks = document.querySelectorAll('.table-block')
    expect(blocks[0]?.hasAttribute('data-sticky-head')).toBe(false)
    expect(blocks[1]?.hasAttribute('data-sticky-head')).toBe(true)
    expect(blocks[2]?.hasAttribute('data-sticky-head')).toBe(false)
    expect(blocks[2]?.querySelector('.table-sticky-head')).toBeNull()
  })

  it('never hangs a header that is not frozen, however tall the table', () => {
    mount(tableBlock(' data-freeze="first-column"'))
    sized('table', rect(5000))
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    expect(document.querySelector('.table-sticky-head')).toBeNull()
    header('Budget').click()
    flush()
    expect(document.querySelector('.table-sticky-head')).toBeNull()
  })

  it('shows the copy only while the real header has scrolled under the top of the page', () => {
    mount(tableBlock(' data-freeze="header"'))
    const block = document.querySelector('.table-block')
    sized('thead', rect(40))
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()
    const strip = document.querySelector('.table-sticky-head')
    if (block === null || strip === null) throw new Error('no strip')
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      top: '52px',
      position: 'static',
    } as unknown as CSSStyleDeclaration)

    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rect(800, 300, -100))
    sized('.table-scroll', rect(800, 300, -100))
    document.dispatchEvent(new Event('scroll'))
    flush()
    expect(block.hasAttribute('data-stuck')).toBe(true)

    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rect(800, 300, -780))
    sized('.table-scroll', rect(800, 300, -780))
    window.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('scroll'))
    flush()
    expect(block.hasAttribute('data-stuck')).toBe(false)
  })

  it('moves the copy sideways with the table, holding a frozen first column still', () => {
    mount(tableBlock(' data-freeze="header first-column"'))
    const scroller = document.querySelector('.table-scroll')
    if (scroller === null) throw new Error('no scroller')
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      top: 'auto',
      position: 'sticky',
    } as unknown as CSSStyleDeclaration)
    sized('th', rect(40, 120))
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    scrolled(scroller, 40)
    scroller.dispatchEvent(new Event('scroll'))
    flush()

    const copy = document.querySelector<HTMLElement>('.table-sticky-head table')
    const first = document.querySelector<HTMLElement>('.table-sticky-head th')
    expect(copy?.style.transform).toBe('translateX(-40px)')
    expect(first?.style.transform).toBe('translateX(40px)')
    expect(
      document
        .querySelector<HTMLElement>('.table-block')
        ?.style.getPropertyValue('--table-frozen-width'),
    ).toBe('120px')
  })

  it('leaves the first cell of the copy free when the first column scrolls', () => {
    mount(tableBlock(' data-freeze="header"'))
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    expect(document.querySelector<HTMLElement>('.table-sticky-head th')?.style.transform).toBe('')
  })

  it('sorts from a click on the copy, and redraws the copy with the new state', () => {
    mount(tableBlock(' data-freeze="header"'))
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    document.querySelectorAll<HTMLElement>('.table-sticky-head button')[1]?.click()
    expect(cellTexts(1)).toEqual(['9', '120', '1,000'])
    expect(document.querySelectorAll('.table-sticky-head')).toHaveLength(1)
    expect(document.querySelectorAll('.table-sticky-head th')[1]?.getAttribute('aria-sort')).toBe(
      'ascending',
    )
    flush()
    expect(document.querySelector<HTMLElement>('.table-sticky-head table')?.style.transform).toBe(
      'translateX(0px)',
    )
  })

  it('copies the header without its ids, or any button when sorting is off', () => {
    mount(
      tableBlock(' data-freeze="header" data-sort="off"').replace(
        'Region',
        'Region<sup><a id="user-content-fnref-1" href="#user-content-fn-1">1</a></sup>',
      ),
    )
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    const strip = document.querySelector('.table-sticky-head')
    expect(strip?.querySelector('[id]')).toBeNull()
    expect(strip?.querySelector('button')).toBeNull()
    expect(document.getElementById('user-content-fnref-1')).not.toBeNull()
  })

  it('measures again when a table or the viewport changes size, once per frame', () => {
    mount(tableBlock())
    sized('table', rect(200))
    const { env, flush, frames, resizers, observed, resize } = environment()
    enhanceTables(document, env)
    flush()
    expect(observed).toEqual([document.querySelector('.table-scroll > table')])
    expect(document.querySelector('.table-block')?.hasAttribute('data-sticky-head')).toBe(false)

    sized('table', rect(2000))
    resize()
    document.dispatchEvent(new Event('scroll'))
    resizers[0]?.()
    expect(frames).toHaveLength(1)
    flush()
    expect(document.querySelector('.table-block')?.hasAttribute('data-sticky-head')).toBe(true)
  })

  it('measures on the viewport alone where there is no ResizeObserver', () => {
    mount(tableBlock())
    const { env, flush } = environment({ observeResize: undefined })
    enhanceTables(document, env)
    flush()

    expect(document.querySelector('.table-block')?.hasAttribute('data-sticky-head')).toBe(false)
  })
})

describe('the scroll shadows', () => {
  it('says which sides have more to scroll to, writing only what changed', () => {
    mount(tableBlock())
    const block = document.querySelector('.table-block')
    const scroller = document.querySelector('.table-scroll')
    if (block === null || scroller === null) throw new Error('no table')
    const { env, flush } = environment()
    enhanceTables(document, env)

    scrolled(scroller, 0)
    flush()
    expect(block.hasAttribute('data-overflow-start')).toBe(false)
    expect(block.hasAttribute('data-overflow-end')).toBe(true)

    scrolled(scroller, 300)
    scroller.dispatchEvent(new Event('scroll'))
    flush()
    expect(block.hasAttribute('data-overflow-start')).toBe(true)
    expect(block.hasAttribute('data-overflow-end')).toBe(true)

    scrolled(scroller, 600)
    scroller.dispatchEvent(new Event('scroll'))
    flush()
    expect(block.hasAttribute('data-overflow-end')).toBe(false)
  })

  it('leaves them to the stylesheet where scroll-driven animations draw them', () => {
    mount(tableBlock())
    const scroller = document.querySelector('.table-scroll')
    if (scroller === null) throw new Error('no table')
    scrolled(scroller, 0)
    const { env, flush } = environment({ scrollTimelines: true })
    enhanceTables(document, env)
    flush()

    expect(document.querySelector('.table-block')?.hasAttribute('data-overflow-end')).toBe(false)
  })
})

describe('enhancing and disposing', () => {
  it('takes everything away again, leaving the table exactly as rendered', () => {
    const html = tableBlock(' data-freeze="header"')
    mount(html)
    const before = document.body.innerHTML
    const { env, flush, resizers } = environment()
    const dispose = enhanceTables(document, env)
    flush()
    header('Budget').click()
    flush()
    const scroller = document.querySelector('.table-scroll')
    if (scroller !== null) scrolled(scroller, 50)
    document.dispatchEvent(new Event('scroll'))
    flush()

    dispose()

    expect(document.body.innerHTML).toBe(before)
    expect(resizers).toHaveLength(0)
    document.dispatchEvent(new Event('scroll'))
    expect(document.body.innerHTML).toBe(before)
  })

  it('enhances a block once, however often it is asked', () => {
    mount(tableBlock())
    const { env } = environment()
    enhanceTables(document, env)
    const again = enhanceTables(document.body, env)

    expect(document.querySelectorAll('.table-scroll .table-sort')).toHaveLength(2)
    again()
  })

  it('does nothing where there is no table block, or no window', () => {
    mount('<div class="table-scroll"><table></table></div>')
    expect(enhanceTables(document)()).toBeUndefined()

    const detached = document.implementation.createHTMLDocument('')
    detached.body.innerHTML = tableBlock()
    enhanceTables(detached)
    expect(detached.querySelector('.table-sort')).toBeNull()
  })

  it('uses the real browser when given none', () => {
    mount(tableBlock())
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)

    const dispose = enhanceTables(document)

    expect(frame).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.table-sort')).not.toBeNull()
    dispose()
  })
})

describe('the browser environment', () => {
  it('reads the viewport, the language and the scroll-timeline support from the window', () => {
    document.documentElement.lang = 'de'
    const listeners: (() => void)[] = []
    const view: TableWindow = {
      document,
      innerHeight: 700,
      CSS: { supports: (condition) => condition === 'animation-timeline: scroll()' },
      requestAnimationFrame: (callback) => {
        callback(0)
        return 1
      },
      addEventListener: (_type, listener) => listeners.push(listener),
      removeEventListener: (_type, listener) => listeners.splice(listeners.indexOf(listener), 1),
    }
    const env = browserTableEnvironment(view)
    let ran = false
    env.requestFrame(() => {
      ran = true
    })
    const stop = env.onViewportResize(() => undefined)

    expect(ran).toBe(true)
    expect(env.viewportHeight()).toBe(700)
    expect(env.locale).toBe('de')
    expect(env.scrollTimelines).toBe(true)
    expect(env.observeResize).toBeUndefined()
    expect(listeners).toHaveLength(1)
    stop()
    expect(listeners).toHaveLength(0)
    document.documentElement.lang = ''
    expect(browserTableEnvironment({ ...view, CSS: undefined }).locale).toBeUndefined()
  })

  it('uses a ResizeObserver where there is one', () => {
    const observe = vi.fn<(target: Element) => void>()
    class Observer {
      observe = observe
      unobserve = vi.fn<(target: Element) => void>()
      disconnect = vi.fn<() => void>()
    }
    const env = browserTableEnvironment({
      document,
      innerHeight: 0,
      ResizeObserver: Observer,
      requestAnimationFrame: () => 0,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })

    env.observeResize?.(() => undefined).observe(document.body)
    expect(observe).toHaveBeenCalledWith(document.body)
  })
})

describe('at scale', () => {
  it('reads layout per column, never per row, and sorts a thousand rows in time', () => {
    const rows = Array.from({ length: 1000 }, (_, index) => [
      `Region ${(index * 7919) % 1000}`,
      String((index * 104_729) % 10_007),
    ])
    mount(tableBlock(' data-freeze="header"', rows))
    const { env, flush } = environment()
    const reads = vi.spyOn(Element.prototype, 'getBoundingClientRect')

    const started = performance.now()
    enhanceTables(document, env)
    flush()
    document.dispatchEvent(new Event('scroll'))
    flush()
    // One measuring frame and one scrolling frame: a handful of reads for the
    // block, its header and its columns, whatever the number of rows.
    expect(reads.mock.calls.length).toBeLessThan(20)
    header('Budget').click()
    header('Region').click()
    const elapsed = performance.now() - started

    expect(cellTexts(0).slice(0, 3)).toEqual(['Region 0', 'Region 1', 'Region 2'])
    // jsdom under coverage is many times slower than a browser, so this bounds
    // quadratic work, not a frame; the read count above is the exact check.
    expect(elapsed).toBeLessThan(3000)
  })
})

/** A table with a totals footer and row headers, as `@quill/markdown` renders one. */
function totalsBlock(attributes = ''): string {
  return `<div class="table-block" data-headers="both"${attributes}><div class="table-scroll" tabindex="0" role="group" aria-label="Table"><table>
<thead><tr><th scope="col">Region</th><th scope="col" class="align-numeric">Budget</th></tr></thead>
<tbody><tr><th scope="row">us</th><td>90</td></tr><tr><th scope="row">eu</th><td>120</td></tr></tbody>
<tfoot><tr><th scope="row">Total</th><td>210</td></tr></tfoot></table></div></div>`
}

describe('footers', () => {
  it('never sorts the footer into the data', () => {
    mount(totalsBlock())
    enhanceTables(document, environment().env)

    header('Budget').click()
    header('Budget').click()

    expect(cellTexts(0)).toEqual(['eu', 'us'])
    expect(document.querySelector('.table-scroll tfoot th')?.textContent).toBe('Total')
  })

  it('hangs a copy of the footer after the scroller, shown while the real one is below the fold', () => {
    mount(totalsBlock(' data-freeze="footer"'))
    const block = document.querySelector('.table-block')
    sized('tfoot', rect(40, 300, 1200))
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()
    const strip = document.querySelector(
      '.table-block > .table-sticky-bottom > .table-sticky-stack > .table-sticky-foot',
    )
    if (block === null || strip === null) throw new Error('no footer strip')

    expect(
      strip
        .closest('.table-sticky-bottom')
        ?.previousElementSibling?.classList.contains('table-scroll'),
    ).toBe(true)
    expect(strip.getAttribute('aria-hidden')).toBe('true')
    expect(strip.querySelector('tfoot th')?.textContent).toBe('Total')
    expect(document.querySelector('.table-sticky-head')).toBeNull()
    expect(block.hasAttribute('data-sticky-foot')).toBe(true)

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      top: 'auto',
      bottom: '24px',
      position: 'static',
    } as unknown as CSSStyleDeclaration)
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rect(1300, 300, 100))
    document.dispatchEvent(new Event('scroll'))
    flush()
    expect(block.hasAttribute('data-stuck-foot')).toBe(true)

    sized('tfoot', rect(40, 300, 500))
    document.dispatchEvent(new Event('scroll'))
    flush()
    expect(block.hasAttribute('data-stuck-foot')).toBe(false)
  })

  it('freezes header and footer on their own for a table taller than the viewport', () => {
    mount(totalsBlock())
    sized('.table-scroll > table', rect(1200, 640))
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    const block = document.querySelector('.table-block')
    expect(block?.hasAttribute('data-sticky-head')).toBe(true)
    expect(block?.hasAttribute('data-sticky-foot')).toBe(true)
  })
})

describe('tables headed by their rows alone', () => {
  it('get no sorting, and still their shadows', () => {
    mount(
      '<div class="table-block" data-headers="row"><div class="table-scroll"><table><tbody><tr><th scope="row">Owner</th><td>Platform</td></tr><tr><th scope="row">Budget</th><td>120</td></tr></tbody></table></div></div>',
    )
    const scroller = document.querySelector('.table-scroll')
    if (scroller === null) throw new Error('no table')
    scrolled(scroller, 0)
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    expect(document.querySelector('.table-sort')).toBeNull()
    expect(document.querySelector('.table-sticky-head')).toBeNull()
    expect(document.querySelector('.table-block')?.hasAttribute('data-overflow-end')).toBe(true)
  })
})

describe('the pinned scrollbar', () => {
  function wideTable() {
    mount(tableBlock(' data-freeze="header footer"'))
    const block = document.querySelector<HTMLElement>('.table-block')
    const scroller = document.querySelector<HTMLElement>('.table-scroll')
    if (block === null || scroller === null) throw new Error('no table')
    scrolled(scroller, 0, 2000, 600)
    Object.defineProperty(scroller, 'offsetHeight', { value: 1512, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 1500, configurable: true })
    return { block, scroller }
  }

  it('is a hidden proxy after the scroller, as wide as the table scrolls', () => {
    const { scroller } = wideTable()
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    const proxy = document.querySelector<HTMLElement>('.table-sticky-bottom .table-scrollbar')
    expect(proxy?.getAttribute('aria-hidden')).toBe('true')
    expect(proxy?.tabIndex).toBe(-1)
    expect(proxy?.closest('.table-sticky-bottom')?.previousElementSibling).toBe(scroller)
    expect(proxy?.querySelector<HTMLElement>('.table-scrollbar-track')?.style.width).toBe('2000px')
    expect(scroller.getAttribute('tabindex')).toBe('0')
  })

  it('shows while the table overflows and its own bar is below the fold, and not after', () => {
    const { block, scroller } = wideTable()
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rect(1600, 600, 100))
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(1512, 600, 120))
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()
    expect(block.hasAttribute('data-bar')).toBe(true)

    // Scrolled to the end: the table's own bar is in view, so the proxy goes.
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(1512, 600, -900))
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rect(1600, 600, -920))
    document.dispatchEvent(new Event('scroll'))
    flush()
    expect(block.hasAttribute('data-bar')).toBe(false)
  })

  it('does not show for a table that fits sideways', () => {
    const { block, scroller } = wideTable()
    scrolled(scroller, 0, 600, 600)
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(1512, 600, 120))
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    expect(block.hasAttribute('data-bar')).toBe(false)
  })

  it('scrolls the table, and follows it, both ways', () => {
    const { scroller } = wideTable()
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()
    const proxy = document.querySelector<HTMLElement>('.table-scrollbar')
    if (proxy === null) throw new Error('no proxy')
    let left = 0
    Object.defineProperty(scroller, 'scrollLeft', {
      get: () => left,
      set: (value: number) => {
        left = value
      },
      configurable: true,
    })
    let proxyLeft = 0
    Object.defineProperty(proxy, 'scrollLeft', {
      get: () => proxyLeft,
      set: (value: number) => {
        proxyLeft = value
      },
      configurable: true,
    })

    proxyLeft = 300
    proxy.dispatchEvent(new Event('scroll'))
    expect(left).toBe(300)
    flush()
    expect(proxyLeft).toBe(300)

    left = 120
    scroller.dispatchEvent(new Event('scroll'))
    flush()
    expect(proxyLeft).toBe(120)

    // Already level: nothing is written, so the two never chase each other.
    proxy.dispatchEvent(new Event('scroll'))
    expect(left).toBe(120)
  })

  it('never lets the hanging header cover the table’s own scrollbar at its end', () => {
    const { block, scroller } = wideTable()
    sized('thead', rect(40, 600, -1000))
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      top: '52px',
      bottom: '0px',
      position: 'static',
    } as unknown as CSSStyleDeclaration)

    // The scroller ends 120px down: header (40) and bar (12) fit under the bar at 52.
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rect(1600, 600, -1480))
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(1600, 600, -1480))
    document.dispatchEvent(new Event('scroll'))
    flush()
    expect(block.hasAttribute('data-stuck')).toBe(true)

    // 60px down: the copy would sit over the bar, so it goes.
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(1600, 600, -1540))
    document.dispatchEvent(new Event('scroll'))
    flush()
    expect(block.hasAttribute('data-stuck')).toBe(false)
  })
})

describe('sorting, for keyboard and screen reader', () => {
  it('leaves a link in a header where it is, with the sort button beside it', () => {
    mount(
      tableBlock().replace(
        '<th scope="col">Region</th>',
        '<th scope="col">Region <a href="#r">docs</a><sup><a id="fn" href="#n">1</a></sup></th>',
      ),
    )
    const before = document.querySelector('thead th')?.innerHTML
    const dispose = enhanceTables(document, environment().env)

    const th = document.querySelector('.table-scroll thead th')
    const button = th?.querySelector('button.table-sort')
    expect(button?.querySelector('a')).toBeNull()
    expect(button?.getAttribute('aria-label')).toBe('Sort by Region docs1')
    expect(th?.querySelector(':scope > a')?.textContent).toBe('docs')
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(th?.getAttribute('aria-sort')).toBe('ascending')

    dispose()
    expect(document.querySelector('thead th')?.innerHTML).toBe(before)
  })

  it('names the sort button of an empty header by its column', () => {
    mount(tableBlock().replace('<th scope="col">Region</th>', '<th scope="col"></th>'))
    enhanceTables(document, environment().env)

    expect(
      document.querySelector('.table-scroll thead th button')?.getAttribute('aria-label'),
    ).toBe('Sort by column 1')
  })

  it('takes every link and button in the hanging copy out of the tab order', () => {
    mount(
      tableBlock(' data-freeze="header"').replace(
        '<th scope="col">Region</th>',
        '<th scope="col">Region <a href="#r">docs</a></th>',
      ),
    )
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()

    const focusable = [
      ...document.querySelectorAll<HTMLElement>('.table-sticky-head a, .table-sticky-head button'),
    ]
    expect(focusable.length).toBeGreaterThan(1)
    expect(focusable.every((element) => element.tabIndex === -1)).toBe(true)
  })

  it('is a tab stop only while it has something to scroll', () => {
    mount(tableBlock())
    const scroller = document.querySelector<HTMLElement>('.table-scroll')
    if (scroller === null) throw new Error('no scroller')
    const { env, flush } = environment()
    const dispose = enhanceTables(document, env)
    flush()
    expect(scroller.tabIndex).toBe(-1)

    scrolled(scroller, 0, 900, 300)
    window.dispatchEvent(new Event('scroll'))
    scroller.dispatchEvent(new Event('scroll'))
    flush()
    expect(scroller.tabIndex).toBe(0)

    dispose()
    expect(scroller.getAttribute('tabindex')).toBe('0')
  })
})

describe('the pinned scrollbar and text selection', () => {
  it('is a native scroller with no text, and a drag on it leaves cell text selectable', () => {
    mount(tableBlock())
    const { env, flush } = environment()
    enhanceTables(document, env)
    flush()
    const proxy = document.querySelector<HTMLElement>('.table-scrollbar')
    if (proxy === null) throw new Error('no proxy')

    expect(proxy.textContent).toBe('')
    proxy.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    proxy.dispatchEvent(new Event('scroll'))
    proxy.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    expect(window.getSelection()?.toString()).toBe('')
    expect(document.documentElement.hasAttribute('data-dragging')).toBe(false)

    const cell = document.querySelector('.table-scroll tbody td')
    if (cell === null) throw new Error('no cell')
    const range = document.createRange()
    range.selectNodeContents(cell)
    window.getSelection()?.addRange(range)
    expect(window.getSelection()?.toString()).toBe('eu')
    window.getSelection()?.removeAllRanges()
  })
})
