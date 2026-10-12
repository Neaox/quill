// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { enhanceDetails, textFragments } from './details.ts'

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
    const scrolled = vi.fn()
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

  it('reads the fragment from the navigation entry, where the browser has taken it off the address', () => {
    const root = page(details('Keys', '<p>Rotate the keys.</p>'))

    enhance(root, { navigationUrl: () => 'https://x.test/d#:~:text=rotate' })

    expect(openOf(root)).toEqual([true])
  })
})

describe('accordions', () => {
  const accordion = (): HTMLElement =>
    page(
      details('A', 'a', ' name="user-content-faq" open') +
        details('B', 'b', ' name="user-content-faq"') +
        details('C', 'c', ' name="user-content-other" open'),
    )

  const toggle = (element: HTMLDetailsElement | undefined, open: boolean): void => {
    if (element === undefined) return
    element.open = open
    element.dispatchEvent(new Event('toggle'))
  }

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
    const root = accordion()
    enhance(root)
    toggle([...root.querySelectorAll('details')][1], true)
    expect(openOf(root)).toEqual(
      'name' in HTMLDetailsElement.prototype ? [true, true, true] : [false, true, true],
    )
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
