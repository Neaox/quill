// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { enhanceContents, type IntersectionObserverClass } from './contents-spy.ts'

type Callback = (records: readonly { target: Element; isIntersecting: boolean }[]) => void

/** An IntersectionObserver a test drives by hand. */
function fakeObserver() {
  const created: {
    callback: Callback
    observed: Element[]
    options: IntersectionObserverInit | undefined
    disconnected: boolean
  }[] = []
  class Fake {
    readonly entry: (typeof created)[number]
    constructor(callback: Callback, options?: IntersectionObserverInit) {
      this.entry = { callback, observed: [], options, disconnected: false }
      created.push(this.entry)
    }
    observe(target: Element): void {
      this.entry.observed.push(target)
    }
    disconnect(): void {
      this.entry.disconnected = true
    }
  }
  return { Observer: Fake satisfies IntersectionObserverClass, created }
}

function page(): Document {
  document.body.innerHTML = [
    '<article>',
    '<h2 id="user-content-one">One</h2><p>a</p>',
    '<h2 id="user-content-two">Two</h2><p>b</p>',
    '<h3 id="user-content-two-a">Two A</h3><p>c</p>',
    '<h2 id="user-content-three">Three</h2><p>d</p>',
    '</article>',
    '<nav class="site-toc"><ul>',
    '<li><a href="#user-content-one">One</a></li>',
    '<li><a href="#user-content-two">Two</a></li>',
    '<li><a href="#user-content-two-a">Two A</a></li>',
    '<li><a href="#user-content-three">Three</a></li>',
    '</ul></nav>',
    '<footer class="site-footer"></footer>',
  ].join('')
  return document
}

const heading = (id: string): Element => {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`no heading ${id}`)
  return element
}

const current = (): string[] =>
  [...document.querySelectorAll('.site-toc a[aria-current]')].map((link) => link.textContent ?? '')

afterEach(() => {
  document.body.replaceChildren()
})

describe('enhanceContents', () => {
  it('watches every heading the contents links to, in a band at the top of the view', () => {
    const { Observer, created } = fakeObserver()
    enhanceContents(page(), { Observer, topInset: () => 64 })

    const [sections] = created
    expect(sections?.observed.map((element) => element.id)).toEqual([
      'user-content-one',
      'user-content-two',
      'user-content-two-a',
      'user-content-three',
    ])
    // Below the sticky header, down to the upper third of the view.
    expect(sections?.options?.rootMargin).toBe('-64px 0px -70% 0px')
  })

  it('marks the first section in the band as the one being read, and only that one', () => {
    const { Observer, created } = fakeObserver()
    enhanceContents(page(), { Observer, topInset: () => 0 })
    const sections = created[0]

    sections?.callback([
      { target: heading('user-content-two'), isIntersecting: true },
      { target: heading('user-content-two-a'), isIntersecting: true },
    ])
    expect(current()).toEqual(['Two'])
    expect(document.querySelector('a[aria-current]')?.getAttribute('aria-current')).toBe('location')

    sections?.callback([
      { target: heading('user-content-two'), isIntersecting: false },
      { target: heading('user-content-three'), isIntersecting: true },
    ])
    expect(current()).toEqual(['Two A'])
  })

  it('keeps the last section passed while the reader is between headings', () => {
    const { Observer, created } = fakeObserver()
    enhanceContents(page(), { Observer, topInset: () => 0 })
    const sections = created[0]

    sections?.callback([{ target: heading('user-content-one'), isIntersecting: true }])
    sections?.callback([{ target: heading('user-content-one'), isIntersecting: false }])
    expect(current()).toEqual(['One'])
  })

  it('marks the last section once the end of the page is reached, however short it is', () => {
    const { Observer, created } = fakeObserver()
    enhanceContents(page(), { Observer, topInset: () => 0 })
    const end = created[1]

    expect(end?.observed[0]?.className).toBe('site-footer')
    end?.callback([{ target: end.observed[0] ?? document.body, isIntersecting: true }])
    expect(current()).toEqual(['Three'])
  })

  it('does nothing on a page with no contents, and leaves nothing behind when taken away', () => {
    const { Observer, created } = fakeObserver()
    document.body.innerHTML = '<article><h2 id="x">X</h2></article>'
    enhanceContents(document, { Observer, topInset: () => 0 })()
    expect(created).toHaveLength(0)

    const undo = enhanceContents(page(), { Observer, topInset: () => 0 })
    created[0]?.callback([{ target: heading('user-content-one'), isIntersecting: true }])
    undo()
    expect(created.every((observer) => observer.disconnected)).toBe(true)
    expect(current()).toEqual([])
  })

  it('ignores links that point at nothing on the page', () => {
    const { Observer, created } = fakeObserver()
    page()
    document
      .querySelector('.site-toc ul')
      ?.insertAdjacentHTML(
        'beforeend',
        '<li><a href="#gone">Gone</a></li><li><a href="/elsewhere">Elsewhere</a></li>',
      )
    enhanceContents(document, { Observer, topInset: () => 0 })
    expect(created[0]?.observed).toHaveLength(4)
  })

  it('reads the sticky header height for its band when not told one', () => {
    const { Observer, created } = fakeObserver()
    page()
    document.documentElement.style.setProperty('--sticky-chrome-top', '72px')
    enhanceContents(document, { Observer })
    expect(created[0]?.options?.rootMargin).toBe('-72px 0px -70% 0px')
    document.documentElement.style.removeProperty('--sticky-chrome-top')
  })

  it('starts its band at the top when nothing has measured a sticky header', () => {
    const { Observer, created } = fakeObserver()
    enhanceContents(page(), { Observer })
    expect(created[0]?.options?.rootMargin).toBe('-0px 0px -70% 0px')
  })

  it('can be taken away before anything is marked', () => {
    const { Observer } = fakeObserver()
    expect(() => {
      enhanceContents(page(), { Observer, topInset: () => 0 })()
    }).not.toThrow()
  })

  it('leaves the mark alone while the end of the page is not yet in view', () => {
    const { Observer, created } = fakeObserver()
    enhanceContents(page(), { Observer, topInset: () => 0 })
    created[0]?.callback([{ target: heading('user-content-one'), isIntersecting: true }])
    created[1]?.callback([{ target: document.body, isIntersecting: false }])
    expect(current()).toEqual(['One'])
  })

  it('follows the band alone on a page with no footer to mark the end', () => {
    const { Observer, created } = fakeObserver()
    page()
    document.querySelector('.site-footer')?.remove()
    enhanceContents(document, { Observer, topInset: () => 0 })
    expect(created[1]?.observed).toEqual([])
  })

  it('uses the browser’s own observer when not given one', () => {
    // jsdom has none, so the page is left as it is: the same answer a browser
    // without the API gets.
    page()
    expect(() => {
      enhanceContents(document)()
    }).not.toThrow()
    expect(current()).toEqual([])
  })

  it('marks every link to the section in a table of contents block as well as the rail (ADR-054)', () => {
    const { Observer, created } = fakeObserver()
    page()
    // A block in the body lists a subset, and lists it first in the page.
    document
      .querySelector('article')
      ?.insertAdjacentHTML(
        'afterbegin',
        '<nav class="toc"><ul><li><a href="#user-content-three">Three</a></li><li><a href="#user-content-two">Two</a></li></ul></nav>',
      )
    enhanceContents(document, { Observer, topInset: () => 0 })
    // One section per heading, in the order the headings come.
    expect(created[0]?.observed.map((element) => element.id)).toEqual([
      'user-content-one',
      'user-content-two',
      'user-content-two-a',
      'user-content-three',
    ])
    created[0]?.callback([{ target: heading('user-content-two'), isIntersecting: true }])
    const marked = [...document.querySelectorAll('a[aria-current]')].map(
      (link) => `${link.closest('nav')?.className ?? ''}:${link.textContent ?? ''}`,
    )
    expect(marked).toEqual(['toc:Two', 'site-toc:Two'])

    created[0]?.callback([
      { target: heading('user-content-two'), isIntersecting: false },
      { target: heading('user-content-three'), isIntersecting: true },
    ])
    expect(document.querySelectorAll('a[aria-current]')).toHaveLength(2)
    expect(current()).toEqual(['Three'])
  })

  it('follows only the lists it is asked to, for a reader that draws its own rail', () => {
    const { Observer, created } = fakeObserver()
    page()
    document
      .querySelector('article')
      ?.insertAdjacentHTML(
        'beforeend',
        '<nav class="toc"><a href="#user-content-one">One</a></nav>',
      )
    enhanceContents(document, { Observer, topInset: () => 0, links: 'nav.toc a[href^="#"]' })
    created[0]?.callback([{ target: heading('user-content-one'), isIntersecting: true }])
    expect(current()).toEqual([])
    expect(document.querySelector('nav.toc a')?.getAttribute('aria-current')).toBe('location')
  })

  it('does nothing where the browser has no IntersectionObserver', () => {
    page()
    expect(() => {
      enhanceContents(document, { Observer: undefined })()
    }).not.toThrow()
    expect(current()).toEqual([])
  })
})
