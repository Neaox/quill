// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { enhanceDetails, exclusiveMode, textFragments } from './details.ts'

/** A details as the renderer emits it (`@quill/markdown`, `details/render.ts`). */
function details(summary: string, body: string, attributes = ''): string {
  return `<details class="details"${attributes}><summary>${summary}</summary><div class="details-body">${body}</div></details>`
}

function page(html: string): HTMLElement {
  const article = document.createElement('article')
  article.innerHTML = html
  document.body.append(article)
  return article
}

function openOf(root: ParentNode): boolean[] {
  return [...root.querySelectorAll('details')].map((element) => element.open)
}

const disposers: (() => void)[] = []

function enhance(...args: Parameters<typeof enhanceDetails>): void {
  disposers.push(enhanceDetails(...args))
}

// jsdom lays nothing out, so it has no `scrollIntoView`; every browser does.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn<() => void>()
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  document.body.replaceChildren()
  window.history.replaceState(null, '', '/')
})

describe('opening a details a link points into', () => {
  it('opens every closed details around the target of the address it is loaded at', () => {
    window.history.replaceState(null, '', '#user-content-deep')
    const root = page(
      details('Outer', details('Inner', '<h2 id="user-content-deep">Deep</h2>')) +
        details('Other', 'x'),
    )

    enhance(root)

    expect(openOf(root)).toEqual([true, true, false])
  })

  it('finds a heading by its unprefixed slug too, as a hand-written link names it', () => {
    window.history.replaceState(null, '', '#deep')
    const root = page(details('Outer', '<h2 id="user-content-deep">Deep</h2>'))

    enhance(root)

    expect(openOf(root)).toEqual([true])
  })

  it('opens the target of a later change of address, and scrolls to it', () => {
    const root = page(details('Outer', '<p id="user-content-block">Here</p>'))
    const target = root.querySelector('p')
    const scrolled = vi.fn<() => void>()
    if (target !== null) target.scrollIntoView = scrolled
    enhance(root)

    window.history.replaceState(null, '', '#user-content-block')
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(openOf(root)).toEqual([true])
    expect(scrolled).toHaveBeenCalledTimes(1)
  })

  it('opens the target of an in-page link that is followed again', () => {
    const root = page(
      `<a href="#user-content-again">Again</a>${details('Outer', '<p id="user-content-again">Here</p>')}`,
    )
    enhance(root)

    root.querySelector('a')?.click()

    expect(openOf(root)).toEqual([true])
  })

  it('leaves a details whose own summary is the target closed, and an ordinary target alone', () => {
    window.history.replaceState(null, '', '#user-content-title')
    const root = page(
      details('<span id="user-content-title">Title</span>', 'x') +
        '<p id="user-content-plain">Plain</p>',
    )

    enhance(root)
    window.history.replaceState(null, '', '#user-content-plain')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    window.history.replaceState(null, '', '#nowhere')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    window.history.replaceState(null, '', '#%E0%A4%A')
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(openOf(root)).toEqual([false])
  })
})

describe('where it is enhanced', () => {
  it('works on a whole document, as the public reader runs it', () => {
    window.history.replaceState(null, '', '#user-content-deep')
    const root = page(details('Outer', '<p id="user-content-deep">Deep</p>'))
    enhance(document)
    expect(openOf(root)).toEqual([true])
  })

  it('does nothing in a document with no window', () => {
    const detached = document.implementation.createHTMLDocument()
    detached.body.innerHTML = details('A', 'a')
    const dispose = enhanceDetails(detached)
    dispose()
    expect(detached.querySelector('details')?.open).toBe(false)
  })

  it('ignores clicks on what is not a link, and on what is not an element', () => {
    const root = page(details('Outer', '<p id="user-content-x">Here</p>'))
    enhance(root)
    root.querySelector('p')?.click()
    root.querySelector('p')?.firstChild?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(openOf(root)).toEqual([false])
  })
})

describe('the browser’s find', () => {
  it('opens the details a match is found in, from the beforematch event', () => {
    const root = page(details('Outer', details('Inner', '<p>needle</p>')))
    enhance(root)

    root.querySelector('p')?.dispatchEvent(new Event('beforematch', { bubbles: true }))

    expect(openOf(root)).toEqual([true, true])
  })
})

describe('text fragments', () => {
  it('reads the text a fragment directive looks for, without its prefix and suffix', () => {
    expect(textFragments('https://x.test/d#:~:text=hello%20world')).toEqual(['hello world'])
    expect(textFragments('https://x.test/d#top:~:text=pre-,start,end,-post&text=two')).toEqual([
      'start',
      'two',
    ])
    expect(textFragments('https://x.test/d#top')).toEqual([])
    expect(textFragments('https://x.test/d#:~:text=%E0%A4%A')).toEqual([])
  })

  it('opens the closed details holding the text a fragment points at', () => {
    window.history.replaceState(null, '', '#:~:text=rotate%20the%20keys')
    const root = page(
      details('Keys', '<p>First, Rotate  the keys.</p>') + details('Other', '<p>x</p>'),
    )

    enhance(root)

    expect(openOf(root)).toEqual([true, false])
  })

  it('reads the fragment from the page’s own navigation entry when not told it', () => {
    const entries = vi
      .spyOn(window.performance, 'getEntriesByType')
      .mockReturnValue([{ name: 'https://x.test/d#:~:text=rotate' } as PerformanceEntry])
    const root = page(details('Keys', '<p>Rotate the keys.</p>'))

    enhance(root)

    expect(openOf(root)).toEqual([true])
    entries.mockRestore()
  })

  it('reads the fragment from the navigation entry, where the browser has taken it off the address', () => {
    const root = page(details('Keys', '<p>Rotate the keys.</p>'))

    enhance(root, { navigationUrl: 'https://x.test/d#:~:text=rotate' })

    expect(openOf(root)).toEqual([true])
  })
})

function toggle(element: HTMLDetailsElement | undefined, open: boolean): void {
  if (element === undefined) return
  element.open = open
  element.dispatchEvent(new Event('toggle'))
}

describe('accordions', () => {
  const accordion = (): HTMLElement =>
    page(
      details('A', 'a', ' name="user-content-faq" open') +
        details('B', 'b', ' name="user-content-faq"') +
        details('C', 'c', ' name="user-content-other" open'),
    )

  it('closes the others of a name as one opens, where the browser cannot', () => {
    const root = accordion()
    enhance(root, { exclusive: 'fallback' })

    toggle([...root.querySelectorAll('details')][1], true)

    expect(openOf(root)).toEqual([false, true, true])
  })

  it('leaves it to the browser where it can, and does nothing as one closes', () => {
    const root = accordion()
    enhance(root, { exclusive: 'native' })
    toggle([...root.querySelectorAll('details')][1], true)
    expect(openOf(root)).toEqual([true, true, true])

    const fallback = accordion()
    enhance(fallback, { exclusive: 'fallback' })
    toggle([...fallback.querySelectorAll('details')][0], false)
    expect(openOf(fallback)).toEqual([false, false, true])
  })

  it('asks the browser whether it groups details by name', () => {
    expect(exclusiveMode({ HTMLDetailsElement: { prototype: { name: '' } } })).toBe('native')
    expect(exclusiveMode({ HTMLDetailsElement: { prototype: {} } })).toBe('fallback')
    const root = accordion()
    enhance(root)
    toggle([...root.querySelectorAll('details')][1], true)
    expect(openOf(root)).toEqual(
      exclusiveMode(window) === 'native' ? [true, true, true] : [false, true, true],
    )
  })

  it('leaves details without a name alone, and what fires toggle that is no details', () => {
    const root = page(details('A', 'a', ' open') + details('B', 'b'))
    enhance(root, { exclusive: 'fallback' })
    toggle([...root.querySelectorAll('details')][1], true)
    root.dispatchEvent(new Event('toggle'))
    expect(openOf(root)).toEqual([true, true])
  })
})

describe('printing', () => {
  it('opens every details for paper, and closes again the ones it opened', () => {
    const root = page(details('A', 'a') + details('B', 'b', ' open'))
    enhance(root)

    window.dispatchEvent(new Event('beforeprint'))
    expect(openOf(root)).toEqual([true, true])

    window.dispatchEvent(new Event('afterprint'))
    expect(openOf(root)).toEqual([false, true])
  })
})

describe('taking it away', () => {
  it('stops listening, and remembers nothing', () => {
    const root = page(details('A', '<p id="user-content-a">a</p>'))
    const before = { ...window.localStorage }
    const dispose = enhanceDetails(root)
    dispose()

    window.history.replaceState(null, '', '#user-content-a')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    window.dispatchEvent(new Event('beforeprint'))

    expect(openOf(root)).toEqual([false])
    expect({ ...window.localStorage }).toEqual(before)
  })
})

describe('where it is put', () => {
  it('works on a whole document as well as on an element of one', () => {
    window.history.replaceState(null, '', '#user-content-deep')
    page(details('Outer', '<h2 id="user-content-deep">Deep</h2>'))

    enhance(document)

    expect(openOf(document)).toEqual([true])
  })

  it('does nothing in a document that is not shown, which has no window to listen on', () => {
    const detached = document.implementation.createHTMLDocument('Template')
    detached.body.innerHTML = details('Outer', '<p>x</p>')

    const dispose = enhanceDetails(detached.body)
    dispose()

    expect(openOf(detached)).toEqual([false])
  })

  it('does nothing for a click that did not land on an element', () => {
    const root = page('<p>Plain</p>' + details('Outer', 'x'))
    enhance(root)

    root.querySelector('p')?.firstChild?.dispatchEvent(new Event('click', { bubbles: true }))

    expect(openOf(root)).toEqual([false])
  })
})

describe('asking the browser whether it groups details by name', () => {
  const prototype = HTMLDetailsElement.prototype
  const held = Object.getOwnPropertyDescriptor(prototype, 'name')

  afterEach(() => {
    if (held === undefined) Reflect.deleteProperty(prototype, 'name')
    else Object.defineProperty(prototype, 'name', held)
  })

  const openSecond = (): boolean[] => {
    const root = page(
      details('A', 'a', ' name="user-content-faq" open') +
        details('B', 'b', ' name="user-content-faq"'),
    )
    enhance(root)
    toggle([...root.querySelectorAll('details')][1], true)
    return openOf(root)
  }

  it('leaves the others open when the browser does it', () => {
    Object.defineProperty(prototype, 'name', { configurable: true, get: () => '' })

    expect(openSecond()).toEqual([true, true])
  })

  it('closes the others itself when the browser cannot', () => {
    Reflect.deleteProperty(prototype, 'name')

    expect(openSecond()).toEqual([false, true])
  })
})
