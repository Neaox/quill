// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { enhanceImages } from './images.ts'

/* jsdom has no modal dialogs and no pointer capture; these stand in for the calls. */
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
  Element.prototype.setPointerCapture = () => undefined
})

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.classList.remove('lightbox-open')
})

function page(): HTMLElement {
  const article = document.createElement('article')
  article.innerHTML = [
    '<figure><img src="/api/a.png" alt="The architecture" width="800" height="400">',
    '<figcaption>How it fits together.</figcaption></figure>',
    '<p>A picture without words <img src="/api/b.png" alt=""> in a line.</p>',
    '<p><a href="/elsewhere"><img src="/api/linked.png" alt="Linked"></a></p>',
    '<p>An emoji <img class="emoji" src="/api/emoji/x.0123456789abcdef.png" alt="x"></p>',
    '<div class="diagram"><img src="/api/in-diagram.png" alt="Drawn"></div>',
  ].join('')
  document.body.append(article)
  return article
}

const openers = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLImageElement>('img[data-expandable]'),
]
const viewer = () => document.querySelector<HTMLDialogElement>('dialog.lightbox')

describe('enhanceImages', () => {
  it('makes each picture in the text a button that says what it does, and leaves the rest alone', () => {
    const article = page()

    enhanceImages(article)

    expect(openers(article).map((image) => image.getAttribute('aria-label'))).toEqual([
      'Open image: The architecture',
      'Open image',
    ])
    for (const image of openers(article)) {
      expect(image.getAttribute('role')).toBe('button')
      expect(image.tabIndex).toBe(0)
    }
    // A picture that is a link goes where it links; an emoji is text; a drawing has its own viewer.
    expect(article.querySelector('a img')?.hasAttribute('data-expandable')).toBe(false)
    expect(article.querySelector('.emoji')?.hasAttribute('data-expandable')).toBe(false)
    expect(article.querySelector('.diagram img')?.hasAttribute('data-expandable')).toBe(false)
  })

  it('opens the picture in the lightbox on a click, named by its caption, with a copy of it', () => {
    const article = page()
    enhanceImages(article)

    openers(article)[0]?.click()

    const dialog = viewer()
    expect(dialog?.getAttribute('aria-label')).toBe('How it fits together.')
    expect(dialog?.querySelector('.lightbox-canvas img')?.getAttribute('src')).toBe('/api/a.png')
    expect(dialog?.querySelector('.lightbox-canvas img')?.getAttribute('alt')).toBe(
      'The architecture',
    )
    // The picture in the text stays where it is: a copy is what is zoomed.
    expect(article.querySelector('figure > img')).not.toBeNull()
  })

  it('names the lightbox by the picture’s words when there is no caption, and by "Image" when it has none', () => {
    const article = page()
    enhanceImages(article)

    openers(article)[1]?.click()

    expect(viewer()?.getAttribute('aria-label')).toBe('Image')
  })

  it.each(['Enter', ' '])('opens on %s from the keyboard, as a button does', (key) => {
    const article = page()
    enhanceImages(article)
    const image = openers(article)[0]

    image?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

    expect(viewer()).not.toBeNull()
  })

  it('leaves other keys alone', () => {
    const article = page()
    enhanceImages(article)

    openers(article)[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))

    expect(viewer()).toBeNull()
  })

  it('returns focus to the picture when the lightbox closes', () => {
    const article = page()
    enhanceImages(article)
    const image = openers(article)[0]
    image?.click()

    viewer()?.close()

    expect(viewer()).toBeNull()
    expect(document.activeElement).toBe(image)
  })

  it('tells a touch screen held upright to turn for a wide picture, and not for one that is not', () => {
    const article = page()
    window.matchMedia = (query: string) =>
      ({
        // A touch screen held upright.
        matches: query.includes('portrait') || query.includes('coarse'),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList
    enhanceImages(article)

    openers(article)[0]?.click()
    expect(viewer()?.querySelector('.lightbox-hint')?.getAttribute('data-turn')).toBe('true')
    viewer()?.close()

    openers(article)[1]?.click()
    expect(viewer()?.querySelector('.lightbox-hint')?.getAttribute('data-turn')).toBe('false')
  })

  it('takes it all away again, closing an open lightbox first', () => {
    const article = page()
    const undo = enhanceImages(article)
    openers(article)[0]?.click()

    undo()

    expect(viewer()).toBeNull()
    expect(openers(article)).toEqual([])
    const image = article.querySelector('figure > img')
    expect(image?.hasAttribute('role')).toBe(false)
    expect(image?.hasAttribute('aria-label')).toBe(false)
    expect(image?.hasAttribute('tabindex')).toBe(false)
  })

  it('does not enhance a picture twice', () => {
    const article = page()
    enhanceImages(article)
    enhanceImages(article)

    openers(article)[0]?.click()

    expect(document.querySelectorAll('dialog.lightbox')).toHaveLength(1)
  })
})
