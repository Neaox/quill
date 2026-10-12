// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EMOJI_FRAMES_ATTRIBUTE, EMOJI_LOOP_ATTRIBUTE, REDUCED_MOTION } from '@quill/markdown'

import {
  ANIMATED_IMAGES_ATTRIBUTE,
  BRIEF_PLAY_LOOPS,
  BRIEF_PLAY_MILLISECONDS,
  enhanceAnimatedImages,
} from './animated-images.ts'

/** An animated emoji as the renderer draws it (`@quill/markdown`, `emojiElement`). */
function emoji(name: string, timing: { frames?: number; loop?: number } = {}): string {
  const frames = timing.frames === undefined ? '' : ` data-frames="${String(timing.frames)}"`
  const loop = timing.loop === undefined ? '' : ` data-loop-ms="${String(timing.loop)}"`
  return (
    `<picture class="emoji"${frames}${loop}>` +
    `<source srcset="/api/emoji/${name}.bbbbbbbbbbbbbbbb.gif" media="${REDUCED_MOTION}">` +
    `<img class="emoji" src="/api/emoji/${name}.aaaaaaaaaaaaaaaa.gif" alt=":${name}:" width="20" height="20">` +
    `</picture>`
  )
}

/**
 * An IntersectionObserver the test drives: every instance is kept, and
 * `show` and `hide` report an element entering or leaving the viewport.
 */
class FakeIntersectionObserver {
  static readonly instances: FakeIntersectionObserver[] = []
  readonly observed = new Set<Element>()
  readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }
  observe(target: Element): void {
    this.observed.add(target)
  }
  unobserve(target: Element): void {
    this.observed.delete(target)
  }
  disconnect(): void {
    this.observed.clear()
  }
  report(target: Element, isIntersecting: boolean): void {
    if (!this.observed.has(target)) return
    const entry = { target, isIntersecting } as unknown as IntersectionObserverEntry
    this.callback([entry], this as unknown as IntersectionObserver)
  }
}

function show(target: Element): void {
  for (const observer of FakeIntersectionObserver.instances) observer.report(target, true)
}

function hide(target: Element): void {
  for (const observer of FakeIntersectionObserver.instances) observer.report(target, false)
}

let reducedMotion = false

function page(html: string): HTMLElement {
  const article = document.createElement('article')
  article.innerHTML = html
  document.body.append(article)
  return article
}

function pictures(root: ParentNode): HTMLPictureElement[] {
  return [...root.querySelectorAll('picture')]
}

/** Whether a picture shows its animation to a reader who has not asked for less motion. */
function playing(picture: Element): boolean {
  return picture.querySelector('source')?.getAttribute('media') === REDUCED_MOTION
}

function stateOf(picture: Element): string | null {
  return picture.getAttribute('data-state')
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

const disposers: (() => void)[] = []

function enhance(root: Element | Document): void {
  disposers.push(enhanceAnimatedImages(root))
}

beforeEach(() => {
  vi.useFakeTimers()
  reducedMotion = false
  FakeIntersectionObserver.instances.length = 0
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === REDUCED_MOTION && reducedMotion,
      media: query,
    })),
  )
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  document.body.replaceChildren()
  document.documentElement.removeAttribute(ANIMATED_IMAGES_ATTRIBUTE)
  setVisibility('visible')
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the limits (ADR-047)', () => {
  it('are five seconds or three loops, and the renderer’s attribute names are the ones read', () => {
    expect(BRIEF_PLAY_MILLISECONDS).toBe(5000)
    expect(BRIEF_PLAY_LOOPS).toBe(3)
    expect(EMOJI_FRAMES_ATTRIBUTE).toBe('data-frames')
    expect(EMOJI_LOOP_ATTRIBUTE).toBe('data-loop-ms')
  })
})

describe('an animated emoji, played briefly', () => {
  it('rests on its still until it is first seen, and is given back as it came', () => {
    const root = page(emoji('party', { frames: 12, loop: 1200 }))
    const original = root.innerHTML
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')
    expect(playing(picture)).toBe(false)
    expect(stateOf(picture)).toBe('resting')

    for (const dispose of disposers.splice(0)) dispose()
    expect(root.innerHTML).toBe(original)
  })

  it('plays when it enters view, for three loops when they are shorter than five seconds', () => {
    const root = page(emoji('party', { frames: 12, loop: 1200 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')

    show(picture)
    expect(playing(picture)).toBe(true)
    expect(stateOf(picture)).toBe('playing')
    vi.advanceTimersByTime(3599)
    expect(playing(picture)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(playing(picture)).toBe(false)
    expect(stateOf(picture)).toBe('resting')
  })

  it('stops at five seconds when three loops would run longer', () => {
    const root = page(emoji('slow', { frames: 40, loop: 4000 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')

    show(picture)
    vi.advanceTimersByTime(4999)
    expect(playing(picture)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(playing(picture)).toBe(false)
  })

  it('plays for five seconds when its loop length was never recorded', () => {
    const root = page(emoji('old'))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')

    show(picture)
    vi.advanceTimersByTime(4999)
    expect(playing(picture)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(playing(picture)).toBe(false)
  })

  it('plays on entering view only the first time', () => {
    const root = page(emoji('party', { loop: 1000 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')

    show(picture)
    vi.advanceTimersByTime(3000)
    hide(picture)
    show(picture)
    expect(playing(picture)).toBe(false)
  })

  it('replays on hover, on focus of what holds it, and on a tap, with the same limit each time', () => {
    // A focusable cell of a table, say: a link would navigate on the tap.
    const root = page(`<p><span tabindex="0">${emoji('party', { loop: 1000 })}</span></p>`)
    enhance(root)
    const [picture] = pictures(root)
    const holder = root.querySelector('span')
    const image = root.querySelector('img')
    if (picture === undefined || holder === null || image === null) throw new Error('no picture')
    show(picture)
    vi.advanceTimersByTime(3000)
    expect(playing(picture)).toBe(false)

    image.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    expect(playing(picture)).toBe(true)
    vi.advanceTimersByTime(3000)
    expect(playing(picture)).toBe(false)

    holder.focus()
    expect(playing(picture)).toBe(true)
    vi.advanceTimersByTime(3000)
    expect(playing(picture)).toBe(false)

    image.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(playing(picture)).toBe(true)
    // A replay while playing starts the limit again rather than adding to it.
    vi.advanceTimersByTime(2000)
    image.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    vi.advanceTimersByTime(2999)
    expect(playing(picture)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(playing(picture)).toBe(false)
  })

  it('does not replay everything when the place it enhances is itself focused, as an editor is', () => {
    const root = page(emoji('party', { loop: 1000 }))
    root.setAttribute('contenteditable', 'true')
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')
    show(picture)
    vi.advanceTimersByTime(3000)
    root.focus()
    expect(playing(picture)).toBe(false)
  })

  it('does not play on focus of something that does not hold it', () => {
    const root = page(`<button type="button">Other</button>${emoji('party', { loop: 1000 })}`)
    enhance(root)
    root.querySelector('button')?.focus()
    expect(pictures(root).map(playing)).toEqual([false])
  })

  it('pauses while it is off-screen, and plays out what is left when it comes back', () => {
    const root = page(emoji('party', { loop: 1200 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')

    show(picture)
    vi.advanceTimersByTime(1000)
    hide(picture)
    expect(playing(picture)).toBe(false)
    vi.advanceTimersByTime(10_000)
    show(picture)
    expect(playing(picture)).toBe(true)
    vi.advanceTimersByTime(2599)
    expect(playing(picture)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(playing(picture)).toBe(false)
  })

  it('does not replay on hover while it is off-screen', () => {
    const root = page(emoji('party', { loop: 1200 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')
    picture.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    expect(playing(picture)).toBe(false)
    // …but what was asked for plays once it is seen.
    show(picture)
    expect(playing(picture)).toBe(true)
  })

  it('pauses while the page is hidden, and plays out what is left when it is shown', () => {
    const root = page(emoji('party', { loop: 1200 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')

    show(picture)
    vi.advanceTimersByTime(600)
    setVisibility('hidden')
    expect(playing(picture)).toBe(false)
    vi.advanceTimersByTime(60_000)
    setVisibility('visible')
    expect(playing(picture)).toBe(true)
    vi.advanceTimersByTime(3000)
    expect(playing(picture)).toBe(false)
  })

  it('does not start while the page is hidden', () => {
    setVisibility('hidden')
    const root = page(emoji('party', { loop: 1200 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')
    show(picture)
    expect(playing(picture)).toBe(false)
    setVisibility('visible')
    expect(playing(picture)).toBe(true)
  })

  it('leaves alone an animation with no still, which plays as it was uploaded', () => {
    const webp =
      '<img class="emoji" src="/api/emoji/spin.aaaaaaaaaaaaaaaa.webp" alt=":spin:" width="20" height="20">'
    const root = page(
      `${webp}<picture><img src="/elsewhere.gif" alt=""></picture>` +
        '<picture class="emoji"><img src="/api/emoji/x.aaaaaaaaaaaaaaaa.gif" alt=""></picture>' +
        '<picture class="emoji"><source srcset="/x.png" media="print"><img src="/x.gif" alt=""></picture>',
    )
    const original = root.innerHTML
    enhance(root)
    for (const picture of pictures(root)) show(picture)
    expect(root.innerHTML).toBe(original)
  })

  it('takes up an emoji drawn after it started, and lets go of one taken away', async () => {
    const root = page('<p></p>')
    enhance(root)
    root.insertAdjacentHTML('beforeend', emoji('late', { loop: 1000 }))
    root.append('text, which is no picture')
    await Promise.resolve()
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')
    expect(stateOf(picture)).toBe('resting')
    show(picture)
    expect(playing(picture)).toBe(true)

    // Moved, as the editor moves a widget: the same picture, still playing.
    root.querySelector('p')?.append(picture)
    await Promise.resolve()
    expect(playing(picture)).toBe(true)

    picture.remove()
    await Promise.resolve()
    expect(FakeIntersectionObserver.instances.every((io) => !io.observed.has(picture))).toBe(true)
    // Its timer went with it: nothing changes it after it is gone.
    vi.advanceTimersByTime(5000)
    expect(playing(picture)).toBe(true)
  })

  it('uses one IntersectionObserver for the page, however many places are enhanced', () => {
    enhance(page(emoji('one')))
    enhance(page(emoji('two')))
    expect(FakeIntersectionObserver.instances).toHaveLength(1)
    const [observer] = FakeIntersectionObserver.instances
    expect(observer?.observed.size).toBe(2)

    // Taking one place away keeps the other's observer; the last takes it down.
    disposers.shift()?.()
    expect(observer?.observed.size).toBe(1)
    disposers.shift()?.()
    enhance(page(emoji('three')))
    expect(FakeIntersectionObserver.instances).toHaveLength(2)
  })

  it('enhances a whole page, and ignores what is not an emoji', () => {
    page(`<p>Text</p>${emoji('party', { loop: 1000 })}`)
    enhance(document)
    const [picture] = pictures(document)
    const paragraph = document.querySelector('p')
    if (picture === undefined || paragraph === null) throw new Error('no picture')
    paragraph.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    paragraph.firstChild?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(playing(picture)).toBe(false)
    // An observation of something it does not play is nothing to it.
    const [observer] = FakeIntersectionObserver.instances
    observer?.callback(
      [{ target: paragraph, isIntersecting: true } as unknown as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    )
    show(picture)
    expect(playing(picture)).toBe(true)
  })

  it('plays at once where the browser cannot say what is in view', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const root = page(emoji('party', { loop: 1000 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')
    expect(playing(picture)).toBe(true)
    vi.advanceTimersByTime(3000)
    expect(playing(picture)).toBe(false)
  })
})

describe('the person’s setting', () => {
  it('plays on hover only, never on entering view, when they asked for that', () => {
    document.documentElement.setAttribute(ANIMATED_IMAGES_ATTRIBUTE, 'hover')
    const root = page(emoji('party', { loop: 1000 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')

    show(picture)
    expect(playing(picture)).toBe(false)
    picture.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    expect(playing(picture)).toBe(true)
    vi.advanceTimersByTime(3000)
    expect(playing(picture)).toBe(false)
  })

  it('never plays when they asked for never, even on hover or a tap', () => {
    document.documentElement.setAttribute(ANIMATED_IMAGES_ATTRIBUTE, 'never')
    const root = page(emoji('party', { loop: 1000 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')

    show(picture)
    picture.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    picture.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(playing(picture)).toBe(false)
  })

  it('stops what is playing when it changes to never', async () => {
    const root = page(emoji('party', { loop: 1000 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')
    show(picture)
    expect(playing(picture)).toBe(true)
    document.documentElement.setAttribute(ANIMATED_IMAGES_ATTRIBUTE, 'never')
    await Promise.resolve()
    expect(playing(picture)).toBe(false)
  })

  it('lets a play finish when it changes to anything but never', async () => {
    const root = page(emoji('party', { loop: 1000 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')
    show(picture)
    document.documentElement.setAttribute(ANIMATED_IMAGES_ATTRIBUTE, 'hover')
    await Promise.resolve()
    expect(playing(picture)).toBe(true)
  })

  it('reads anything else as the default, play briefly', () => {
    document.documentElement.setAttribute(ANIMATED_IMAGES_ATTRIBUTE, 'sometimes')
    const root = page(emoji('party', { loop: 1000 }))
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')
    show(picture)
    expect(playing(picture)).toBe(true)
  })
})

describe('reduced motion', () => {
  it('always wins: nothing plays and no timer is set, whatever the setting', () => {
    reducedMotion = true
    const before = vi.getTimerCount()
    const root = page(`<span tabindex="0">${emoji('party', { loop: 1000 })}</span>`)
    enhance(root)
    const [picture] = pictures(root)
    if (picture === undefined) throw new Error('no picture')

    show(picture)
    picture.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    picture.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(vi.getTimerCount()).toBe(before)
    // (jsdom's own focus handling sets a timer, so focus is tried last.)
    root.querySelector('span')?.focus()
    expect(playing(picture)).toBe(false)
  })

  it('needs no script: the still is the picture’s own source for that query', () => {
    const root = page(emoji('party'))
    expect(root.querySelector('source')?.getAttribute('media')).toBe(REDUCED_MOTION)
  })
})
