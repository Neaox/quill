// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import type { ResizeObserverClass } from '../sticky-chrome/sticky-chrome.ts'
import { watchScrollingCode } from './scrolling-code.ts'

/** A stand-in ResizeObserver that reports when the test says the layout changed. */
function observers(): { Observer: ResizeObserverClass; resize(): void; watched(): Element[] } {
  const live: { callback: () => void; targets: Element[] }[] = []
  class Observer {
    private readonly entry: { callback: () => void; targets: Element[] }
    constructor(callback: () => void) {
      this.entry = { callback, targets: [] }
      live.push(this.entry)
    }
    observe(target: Element): void {
      this.entry.targets.push(target)
    }
    disconnect(): void {
      live.splice(live.indexOf(this.entry), 1)
    }
  }
  return {
    Observer,
    resize: () => {
      for (const { callback } of live) callback()
    },
    watched: () => live.flatMap(({ targets }) => targets),
  }
}

function page(html: string): HTMLElement {
  const article = document.createElement('article')
  article.innerHTML = html
  document.body.append(article)
  return article
}

function width(element: Element, scroll: number, client: number): void {
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scroll })
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: client })
}

const name = (code: Element | null): string | undefined =>
  code?.getAttribute('data-lang') === 'ts' ? 'TypeScript' : undefined

afterEach(() => {
  document.body.replaceChildren()
})

describe('watchScrollingCode', () => {
  it('makes a block that scrolls sideways a named tab stop, and only while it does', () => {
    const article = page(
      '<div class="code-block"><pre><code data-lang="ts">const a = 1</code></pre></div>',
    )
    const pre = article.querySelector('pre')
    if (pre === null) throw new Error('expected a pre')
    const { Observer, resize } = observers()
    width(pre, 900, 300)

    watchScrollingCode(article, name, Observer)

    expect(pre.tabIndex).toBe(0)
    expect(pre.getAttribute('role')).toBe('group')
    expect(pre.getAttribute('aria-label')).toBe('TypeScript code, scrolls sideways')

    width(pre, 300, 300)
    resize()

    expect(pre.hasAttribute('tabindex')).toBe(false)
    expect(pre.hasAttribute('role')).toBe(false)
    expect(pre.hasAttribute('aria-label')).toBe(false)
  })

  it('names a block without a known language for what it is', () => {
    const article = page('<pre><code>plain</code></pre>')
    const pre = article.querySelector('pre')
    if (pre === null) throw new Error('expected a pre')
    width(pre, 900, 300)

    watchScrollingCode(article, name, observers().Observer)

    expect(pre.getAttribute('aria-label')).toBe('Code, scrolls sideways')
  })

  it('leaves a block that fits, a hidden diagram source, and a tab stop it did not make', () => {
    const article = page(
      '<pre id="fits"><code>x</code></pre>' +
        '<div class="diagram" data-state="drawn"><pre id="source"><code>graph</code></pre></div>' +
        '<pre id="theirs" tabindex="-1"><code>y</code></pre>',
    )
    const [fits, source, theirs] = article.querySelectorAll('pre')
    if (fits === undefined || source === undefined || theirs === undefined) {
      throw new Error('expected three blocks')
    }
    width(fits, 300, 300)
    width(source, 0, 0)
    width(theirs, 900, 300)
    const { Observer, resize } = observers()

    watchScrollingCode(article, name, Observer)
    resize()

    expect(fits.hasAttribute('tabindex')).toBe(false)
    expect(source.hasAttribute('tabindex')).toBe(false)
    expect(theirs.tabIndex).toBe(-1)
    expect(theirs.hasAttribute('role')).toBe(false)
  })

  it('measures once without an observer, and takes everything away when disposed', () => {
    const article = page('<pre><code data-lang="ts">x</code></pre>')
    const pre = article.querySelector('pre')
    if (pre === null) throw new Error('expected a pre')
    width(pre, 900, 300)
    const tracked = observers()

    const withObserver = watchScrollingCode(article, name, tracked.Observer)
    expect(tracked.watched()).toEqual([pre])
    withObserver()

    expect(tracked.watched()).toEqual([])
    expect(pre.hasAttribute('tabindex')).toBe(false)
    expect(pre.hasAttribute('aria-label')).toBe(false)

    const once = watchScrollingCode(article, name, undefined)
    expect(pre.tabIndex).toBe(0)
    once()
    expect(pre.hasAttribute('role')).toBe(false)
  })

  it('reads the page’s own ResizeObserver when none is given', () => {
    const article = page('<pre><code>x</code></pre>')
    const pre = article.querySelector('pre')
    if (pre === null) throw new Error('expected a pre')
    width(pre, 900, 300)

    const dispose = watchScrollingCode(article, name)

    expect(pre.tabIndex).toBe(0)
    dispose()
  })
})

describe('watchScrollingCode over a whole page', () => {
  it('reads the page’s own window when given the document', () => {
    const article = page('<pre><code>x</code></pre>')
    const pre = article.querySelector('pre')
    if (pre === null) throw new Error('expected a pre')
    width(pre, 900, 300)

    const dispose = watchScrollingCode(document, name)

    expect(pre.tabIndex).toBe(0)
    dispose()
  })
})
