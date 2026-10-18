import { afterEach, describe, expect, it, vi } from 'vitest'

import { readableBodyLinks, routeBodyLinks, routedLinkHref } from './body-links.ts'

const HERE = new URL('http://localhost:3000/w/acme/d/first-page-k7m3q9v2rt')

function anchor(href: string, attributes: Record<string, string> = {}): HTMLAnchorElement {
  const link = document.createElement('a')
  link.setAttribute('href', href)
  link.textContent = 'words'
  for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value)
  document.body.append(link)
  return link
}

function click(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('routedLinkHref', () => {
  it('routes a link to a document by id, keeping its query and section', () => {
    const link = anchor('/d/11111111-2222-3333-4444-555555555555?rev=a1#user-content-install')

    expect(routedLinkHref(click(link), HERE)).toBe(
      '/d/11111111-2222-3333-4444-555555555555?rev=a1#user-content-install',
    )
  })

  it('routes the readable form and a share page too, and a click on words inside the link', () => {
    const strong = document.createElement('strong')
    const link = anchor('/w/acme/d/second-page-p4n8w2cx5b')
    link.append(strong)

    expect(routedLinkHref(click(strong), HERE)).toBe('/w/acme/d/second-page-p4n8w2cx5b')
    expect(routedLinkHref(click(anchor('/share/abc/d/x-p4n8w2cx5b')), HERE)).toBe(
      '/share/abc/d/x-p4n8w2cx5b',
    )
  })

  it('routes an absolute address on this origin', () => {
    const link = anchor('http://localhost:3000/d/p4n8w2cx5b')

    expect(routedLinkHref(click(link), HERE)).toBe('/d/p4n8w2cx5b')
  })

  it('leaves a modified, middle or already-handled click to the browser', () => {
    const link = anchor('/d/p4n8w2cx5b')

    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      expect(routedLinkHref(click(link, init), HERE)).toBeUndefined()
    }
    const handled = click(link)
    handled.preventDefault()
    expect(routedLinkHref(handled, HERE)).toBeUndefined()
  })

  it('leaves a link with a target or a download to do what it says', () => {
    expect(routedLinkHref(click(anchor('/d/p4n8w2cx5b', { target: '_blank' })), HERE)).toBe(
      undefined,
    )
    expect(routedLinkHref(click(anchor('/d/p4n8w2cx5b', { download: '' })), HERE)).toBe(undefined)
    expect(routedLinkHref(click(anchor('/d/p4n8w2cx5b', { target: '_self' })), HERE)).toBe(
      '/d/p4n8w2cx5b',
    )
  })

  it('leaves the web, attachments and a section of this page to the browser', () => {
    for (const href of [
      'https://example.com/d/p4n8w2cx5b',
      '/api/attachments/abc',
      '#user-content-install',
      `${HERE.pathname}#user-content-install`,
    ]) {
      expect(routedLinkHref(click(anchor(href)), HERE)).toBeUndefined()
    }
  })

  it('ignores a click that is not on a link at all', () => {
    const paragraph = document.createElement('p')
    document.body.append(paragraph)

    expect(routedLinkHref(click(paragraph), HERE)).toBeUndefined()
  })
})

describe('routeBodyLinks', () => {
  it('leaves every link to the browser while there is nothing to navigate with', () => {
    const article = document.createElement('article')
    document.body.append(article)
    const link = document.createElement('a')
    link.setAttribute('href', '/d/p4n8w2cx5b')
    article.append(link)
    const undo = routeBodyLinks(article, () => undefined)

    const followed = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(followed)

    expect(followed.defaultPrevented).toBe(false)
    undo()
  })

  it('hands a routed click to navigate instead of the browser, until undone', () => {
    const article = document.createElement('article')
    document.body.append(article)
    const link = document.createElement('a')
    link.setAttribute('href', '/d/p4n8w2cx5b#part')
    article.append(link)
    const navigate = vi.fn<(href: string) => void>()

    const undo = routeBodyLinks(article, () => navigate)
    const followed = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(followed)

    expect(navigate).toHaveBeenCalledWith('/d/p4n8w2cx5b#part')
    expect(followed.defaultPrevented).toBe(true)

    undo()
    const after = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(after)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(after.defaultPrevented).toBe(false)
  })

  it('lets a modified click through untouched', () => {
    const article = document.createElement('article')
    document.body.append(article)
    const link = document.createElement('a')
    link.setAttribute('href', '/d/p4n8w2cx5b')
    article.append(link)
    const navigate = vi.fn<(href: string) => void>()
    const undo = routeBodyLinks(article, () => navigate)

    const modified = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    })
    link.dispatchEvent(modified)

    expect(navigate).not.toHaveBeenCalled()
    expect(modified.defaultPrevented).toBe(false)
    undo()
  })
})

/** A mounted body holding the given links. */
function body(html: string): HTMLElement {
  const article = document.createElement('article')
  article.innerHTML = html
  document.body.append(article)
  return article
}

describe('readableBodyLinks', () => {
  it('asks once for every stored link in the body and shows each under its reading address', async () => {
    const article = body(
      [
        '<a href="/d/11111111-2222-3333-4444-555555555555#user-content-steps">one</a>',
        '<a href="/d/p4n8w2cx5b?tab=python">two</a>',
        '<a href="/d/p4n8w2cx5b">again</a>',
        '<a href="/d/k7m3q9v2rt">hidden</a>',
        '<a href="https://example.com/d/x">web</a>',
        '<a href="#user-content-steps">here</a>',
      ].join(''),
    )
    const load = vi.fn<
      (references: readonly string[], signal: AbortSignal) => Promise<ReadonlyMap<string, string>>
    >(() =>
      Promise.resolve(
        new Map([
          ['11111111-2222-3333-4444-555555555555', '/w/acme/d/first-page-k7m3q9v2xx'],
          ['p4n8w2cx5b', '/w/acme/d/second-page-p4n8w2cx5b'],
        ]),
      ),
    )

    readableBodyLinks(article, load)

    expect(load).toHaveBeenCalledTimes(1)
    expect(load.mock.calls[0]?.[0]).toEqual([
      '11111111-2222-3333-4444-555555555555',
      'p4n8w2cx5b',
      'k7m3q9v2rt',
    ])
    await vi.waitFor(() => {
      expect(article.querySelector('a')?.getAttribute('href')).toBe(
        '/w/acme/d/first-page-k7m3q9v2xx#user-content-steps',
      )
    })
    const hrefs = [...article.querySelectorAll('a')].map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual([
      '/w/acme/d/first-page-k7m3q9v2xx#user-content-steps',
      '/w/acme/d/second-page-p4n8w2cx5b?tab=python',
      '/w/acme/d/second-page-p4n8w2cx5b',
      // Not answered: it keeps the stored form, which the app's route resolves.
      '/d/k7m3q9v2rt',
      'https://example.com/d/x',
      '#user-content-steps',
    ])
  })

  it('asks for nothing when the body links to no document', () => {
    const load =
      vi.fn<
        (references: readonly string[], signal: AbortSignal) => Promise<ReadonlyMap<string, string>>
      >()

    readableBodyLinks(body('<a href="https://example.com">web</a>'), load)

    expect(load).not.toHaveBeenCalled()
  })

  it('cancels the request when the body goes, and keeps the stored links if it fails', async () => {
    const article = body('<a href="/d/p4n8w2cx5b">two</a>')
    let signal: AbortSignal | undefined
    const undo = readableBodyLinks(article, (_references, given) => {
      signal = given
      return Promise.reject(new Error('offline'))
    })

    undo()

    expect(signal?.aborted).toBe(true)
    await Promise.resolve()
    expect(article.querySelector('a')?.getAttribute('href')).toBe('/d/p4n8w2cx5b')
  })
})
