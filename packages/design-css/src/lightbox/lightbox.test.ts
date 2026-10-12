// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { enhanceDiagrams, shortName } from './lightbox.ts'

/*
 * jsdom has no modal dialogs and no pointer capture, which every browser this
 * platform supports has; these stand in for the two calls.
 */
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
  article.className = 'prose'
  article.innerHTML = [
    '<figure><div class="diagram" data-diagram="svg">',
    '<svg viewBox="0 0 100 50" role="img" aria-label="The loop"><rect class="box"></rect></svg>',
    '</div><figcaption>Marks make it prompt.</figcaption></figure>',
    '<div class="diagram" data-diagram="mermaid"><pre><code>flowchart LR</code></pre></div>',
  ].join('')
  document.body.append(article)
  return article
}

const expandButtons = (root: ParentNode): HTMLButtonElement[] => [
  ...root.querySelectorAll<HTMLButtonElement>('button.diagram-expand'),
]

function pointer(type: string, init: { x: number; y: number; id: number }): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    clientX: init.x,
    clientY: init.y,
    pointerId: init.id,
  })
}

describe('enhanceDiagrams', () => {
  it('gives every diagram a button that says what it does', () => {
    const article = page()
    enhanceDiagrams(article)

    const buttons = expandButtons(article)
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Expand diagram: The loop')
    expect(buttons[1]?.getAttribute('aria-label')).toBe('Expand diagram')
    // The figure holds the button, so it sits over the drawing and its caption.
    expect(buttons[0]?.parentElement?.tagName).toBe('FIGURE')
  })

  it('gives an uncaptioned drawing no caption, and an unnamed one a plain name', () => {
    const article = document.createElement('article')
    article.className = 'prose'
    article.innerHTML = '<div class="diagram"><svg viewBox="0 0 10 10"></svg></div>'
    document.body.append(article)
    enhanceDiagrams(article)
    expandButtons(article)[0]?.click()

    const dialog = document.querySelector('dialog.lightbox')
    expect(dialog?.getAttribute('aria-label')).toBe('Diagram')
    expect(dialog?.querySelector('.lightbox-caption')).toBeNull()
    expect(dialog?.querySelector('.diagram')?.getAttribute('data-diagram')).toBe('svg')

    // A double tap or click zooms in where it lands, and again fits it.
    const stage = dialog?.querySelector('.lightbox-stage')
    const readout = dialog?.querySelector('.lightbox-readout')
    stage?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 5, clientY: 5 }))
    expect(readout?.textContent).toBe('200%')
    stage?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 5, clientY: 5 }))
    expect(readout?.textContent).toBe('100%')
  })

  it('asks a phone held upright to turn for a wide drawing, and stops once it is turned', () => {
    const listeners = new Set<() => void>()
    const portrait = { matches: true }
    const query = (media: string): MediaQueryList =>
      ({
        get matches() {
          return media === '(pointer: coarse)' || (media.includes('portrait') && portrait.matches)
        },
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      }) as unknown as MediaQueryList
    window.matchMedia = query
    const article = document.createElement('article')
    article.className = 'prose'
    article.innerHTML =
      '<div class="diagram" data-diagram="svg"><svg viewBox="0 0 1200 500" role="img" aria-label="Wide"></svg></div>'
    document.body.append(article)
    enhanceDiagrams(article)
    expandButtons(article)[0]?.click()

    const hint = document.querySelector<HTMLElement>('.lightbox-hint')
    expect(hint?.dataset['turn']).toBe('true')
    expect(hint?.querySelector('svg.lightbox-turn')).not.toBeNull()
    expect(hint?.textContent).toBe('Turn your phone for a larger view')

    portrait.matches = false
    for (const listener of listeners) listener()
    expect(hint?.dataset['turn']).toBe('false')
    expect(hint?.textContent).toBe('Pinch to zoom · drag to pan')

    document.querySelector<HTMLDialogElement>('dialog.lightbox')?.close()
    expect(listeners.size).toBe(0)
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('enhances a diagram once, however often it is asked', () => {
    const article = page()
    enhanceDiagrams(article)
    enhanceDiagrams(article)
    expect(expandButtons(article)).toHaveLength(2)
  })

  it('opens the drawing in a dialog, captioned, and puts it back on close', () => {
    const article = page()
    enhanceDiagrams(article)
    const svg = article.querySelector('.diagram > svg')
    expandButtons(article)[0]?.click()

    const dialog = document.querySelector('dialog.lightbox')
    expect(dialog?.hasAttribute('open')).toBe(true)
    // Named by its caption, which also describes it (accessibility audit F29).
    expect(dialog?.getAttribute('aria-label')).toBe('Marks make it prompt.')
    // The caption sits under the drawing, clear of the controls at the top.
    const caption = dialog?.querySelector('.lightbox-caption')
    expect(caption?.textContent).toBe('Marks make it prompt.')
    expect(dialog?.getAttribute('aria-describedby')).toBe(caption?.id)
    expect(caption?.previousElementSibling?.classList.contains('lightbox-stage')).toBe(true)
    // The drawing itself, moved, so its ids stay unique on the page and it keeps
    // the classes the reading stylesheet colours.
    expect(dialog?.querySelector('.prose .diagram[data-diagram="svg"] svg')).toBe(svg)
    expect(document.documentElement.classList.contains('lightbox-open')).toBe(true)
    expect(document.activeElement).toBe(dialog)

    dialog?.querySelector<HTMLButtonElement>('[data-action="close"]')?.click()

    expect(document.querySelector('dialog.lightbox')).toBeNull()
    expect(article.querySelector('figure .diagram svg')).toBe(svg)
    expect(document.documentElement.classList.contains('lightbox-open')).toBe(false)
    expect(document.activeElement).toBe(expandButtons(article)[0])
  })

  it('has nothing to open for a diagram that is not drawn yet', () => {
    const article = page()
    enhanceDiagrams(article)
    expandButtons(article)[1]?.click()
    expect(document.querySelector('dialog.lightbox')).toBeNull()
  })

  it('opens a Mermaid drawing once it is drawn, once per click', () => {
    const article = page()
    const mermaid = article.querySelector<HTMLElement>('.diagram[data-diagram="mermaid"]')
    const host = document.createElement('div')
    host.className = 'diagram-drawing'
    host.innerHTML = '<svg aria-label="The flow"></svg>'
    mermaid?.prepend(host)
    enhanceDiagrams(article)

    expandButtons(article)[1]?.click()
    expect(document.querySelectorAll('dialog.lightbox')).toHaveLength(1)
    expect(document.querySelector('dialog.lightbox')?.getAttribute('aria-label')).toBe('The flow')
  })

  it('opens from the drawing itself, and closes from a click outside it', () => {
    const article = page()
    enhanceDiagrams(article)
    article
      .querySelector<SVGElement>('.diagram > svg rect')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const dialog = document.querySelector<HTMLDialogElement>('dialog.lightbox')
    expect(dialog).not.toBeNull()

    dialog
      ?.querySelector('.lightbox-stage')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.querySelector('dialog.lightbox')).not.toBeNull()

    dialog?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.querySelector('dialog.lightbox')).toBeNull()
  })

  it('says the stage is being dragged, so the easing steps aside, and stops saying so after', () => {
    const article = page()
    enhanceDiagrams(article)
    expandButtons(article)[0]?.click()
    const stage = document.querySelector<HTMLElement>('.lightbox-stage')
    stage?.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, id: 1 }))
    expect(stage?.dataset['dragging']).toBe('true')
    stage?.dispatchEvent(pointer('pointerup', { x: 0, y: 0, id: 1 }))
    expect(stage?.dataset['dragging']).toBeUndefined()
  })

  it('zooms from its buttons and the keyboard, and fits again', () => {
    const article = page()
    enhanceDiagrams(article)
    expandButtons(article)[0]?.click()
    const dialog = document.querySelector<HTMLDialogElement>('dialog.lightbox')
    const canvas = dialog?.querySelector<HTMLElement>('.lightbox-canvas')
    const press = (action: string) =>
      dialog?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click()

    press('in')
    expect(canvas?.style.transform).toBe('translate(0px, 0px) scale(1.5)')
    expect(dialog?.querySelector('[data-action="zoom"]')?.textContent).toBe('150%')

    dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))
    expect(canvas?.style.transform).toBe('translate(0px, 0px) scale(2.25)')

    dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }))
    press('out')
    expect(canvas?.style.transform).toBe('translate(0px, 0px) scale(1)')

    press('in')
    dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))
    expect(canvas?.style.transform).toBe('translate(0px, 0px) scale(1)')

    press('zoom')
    expect(canvas?.style.transform).toBe('translate(0px, 0px) scale(2)')
    press('zoom')
    expect(canvas?.style.transform).toBe('translate(0px, 0px) scale(1)')

    dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }))
    expect(canvas?.style.transform).toBe('translate(0px, 0px) scale(1)')
  })

  it('zooms under the wheel, pans by dragging, and pinches with two fingers', () => {
    const article = page()
    enhanceDiagrams(article)
    expandButtons(article)[0]?.click()
    const dialog = document.querySelector<HTMLDialogElement>('dialog.lightbox')
    const stage = dialog?.querySelector<HTMLElement>('.lightbox-stage')
    const canvas = dialog?.querySelector<HTMLElement>('.lightbox-canvas')
    if (stage === null || stage === undefined || canvas === null || canvas === undefined) {
      throw new Error('the dialog has no stage')
    }

    stage.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -500, clientX: 0, clientY: 0, cancelable: true }),
    )
    const zoomed = canvas.style.transform
    expect(zoomed).toMatch(/scale\(2\.71/u)

    stage.dispatchEvent(pointer('pointerdown', { x: 10, y: 10, id: 1 }))
    stage.dispatchEvent(pointer('pointermove', { x: 30, y: 0, id: 1 }))
    stage.dispatchEvent(pointer('pointerup', { x: 30, y: 0, id: 1 }))
    expect(canvas.style.transform).toMatch(/^translate\(20px, -10px\)/u)

    stage.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, id: 1 }))
    stage.dispatchEvent(pointer('pointerdown', { x: 100, y: 0, id: 2 }))
    stage.dispatchEvent(pointer('pointermove', { x: 50, y: 0, id: 2 }))
    stage.dispatchEvent(pointer('pointercancel', { x: 50, y: 0, id: 2 }))
    stage.dispatchEvent(pointer('pointerup', { x: 0, y: 0, id: 1 }))
    expect(canvas.style.transform).toMatch(/scale\(1\.35/u)

    stage.dispatchEvent(pointer('pointermove', { x: 70, y: 70, id: 9 }))
    expect(canvas.style.transform).toMatch(/scale\(1\.35/u)

    // Two fingers that land on one spot have no spread to scale by yet.
    stage.dispatchEvent(pointer('pointerdown', { x: 40, y: 40, id: 3 }))
    stage.dispatchEvent(pointer('pointerdown', { x: 40, y: 40, id: 4 }))
    stage.dispatchEvent(pointer('pointermove', { x: 60, y: 40, id: 4 }))
    expect(canvas.style.transform).toMatch(/scale\(1\.35/u)
  })

  it('closes an open lightbox when the page takes its diagrams back', () => {
    const article = page()
    const restore = enhanceDiagrams(article)
    expandButtons(article)[0]?.click()
    expect(document.querySelector('dialog.lightbox')).not.toBeNull()

    restore()
    expect(document.querySelector('dialog.lightbox')).toBeNull()
    expect(expandButtons(article)).toHaveLength(0)

    // One the reader already closed is left alone.
    const again = enhanceDiagrams(article)
    expandButtons(article)[0]?.click()
    document.querySelector<HTMLButtonElement>('[data-action="close"]')?.click()
    expect(() => {
      again()
    }).not.toThrow()
  })

  it('closes on Escape like any dialog, and when the page is done with it', () => {
    const article = page()
    const dispose = enhanceDiagrams(article)
    expandButtons(article)[0]?.click()
    document.querySelector<HTMLDialogElement>('dialog.lightbox')?.close()
    expect(document.querySelector('dialog.lightbox')).toBeNull()

    expandButtons(article)[0]?.click()
    dispose()
    expect(document.querySelector('dialog.lightbox')).toBeNull()
    expect(expandButtons(article)).toHaveLength(0)
    expect(article.querySelector('figure .diagram svg')).not.toBeNull()
  })
})

describe('the lightbox at its limits', () => {
  it('keeps zoom out and zoom in in place at their limits, disabled with the reason', () => {
    page()
    enhanceDiagrams(document)
    document.querySelector<HTMLButtonElement>('.diagram-expand')?.click()
    const out = document.querySelector<HTMLButtonElement>('[data-action="out"]')
    const zoomIn = document.querySelector<HTMLButtonElement>('[data-action="in"]')
    if (out === null || zoomIn === null) throw new Error('no controls')

    expect(out.getAttribute('aria-disabled')).toBe('true')
    expect(out.title).toBe('Already fitted to the screen')
    expect(out.disabled).toBe(false)
    expect(zoomIn.hasAttribute('aria-disabled')).toBe(false)

    for (let step = 0; step < 8; step += 1) zoomIn.click()
    expect(zoomIn.getAttribute('aria-disabled')).toBe('true')
    expect(zoomIn.title).toBe('Already at the largest size')
    expect(out.hasAttribute('aria-disabled')).toBe(false)
    expect(out.hasAttribute('title')).toBe(false)
    document.querySelector<HTMLButtonElement>('[data-action="close"]')?.click()
  })
})

describe('the lightbox, for keyboard, speech and screen reader', () => {
  function opened(): { dialog: HTMLDialogElement; canvas: HTMLElement } {
    const article = page()
    enhanceDiagrams(article)
    document.querySelector<HTMLButtonElement>('.diagram-expand')?.click()
    const dialog = document.querySelector<HTMLDialogElement>('dialog.lightbox')
    const canvas = document.querySelector<HTMLElement>('.lightbox-canvas')
    if (dialog === null || canvas === null) throw new Error('no lightbox')
    return { dialog, canvas }
  }

  function press(dialog: HTMLDialogElement, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    dialog.dispatchEvent(event)
    return event
  }

  it('pans a zoomed drawing with the arrow keys, and fits it again with Home', () => {
    const { dialog, canvas } = opened()
    press(dialog, '+')
    const zoomed = canvas.style.transform

    const right = press(dialog, 'ArrowRight')
    expect(right.defaultPrevented).toBe(true)
    expect(canvas.style.transform).not.toBe(zoomed)
    press(dialog, 'ArrowLeft')
    expect(canvas.style.transform).toBe(zoomed)
    press(dialog, 'ArrowDown')
    press(dialog, 'ArrowUp')
    expect(canvas.style.transform).toBe(zoomed)

    press(dialog, 'Home')
    expect(canvas.style.transform).toBe('translate(0px, 0px) scale(1)')
    expect(press(dialog, 'Tab').defaultPrevented).toBe(false)
    dialog.close()
  })

  it('names the zoom readout by what it shows, and says which keys zoom', () => {
    const { dialog } = opened()
    const readout = document.querySelector<HTMLButtonElement>('[data-action="zoom"]')

    expect(readout?.getAttribute('aria-label')).toBe('100%, fit or twice the size')
    press(dialog, '+')
    expect(readout?.textContent).toBe('150%')
    expect(readout?.getAttribute('aria-label')).toBe('150%, fit or twice the size')
    expect(document.querySelector('[data-action="in"]')?.getAttribute('aria-keyshortcuts')).toBe(
      '+',
    )
    expect(document.querySelector('[data-action="out"]')?.getAttribute('aria-keyshortcuts')).toBe(
      '-',
    )
    dialog.close()
  })

  it('names a drawing by its first sentence, and reads the name again when reached', () => {
    const article = page()
    const svg = article.querySelector('.diagram > svg')
    svg?.setAttribute('aria-label', 'The loop. Every mark goes round it twice.')
    enhanceDiagrams(article)
    const expand = document.querySelector<HTMLButtonElement>('.diagram-expand')
    expect(expand?.getAttribute('aria-label')).toBe('Expand diagram: The loop.')

    svg?.setAttribute('aria-label', 'The new loop')
    expand?.dispatchEvent(new FocusEvent('focus'))
    expect(expand?.getAttribute('aria-label')).toBe('Expand diagram: The new loop')
    expect(shortName('One. Two.')).toBe('One.')
  })

  it('makes a drawing that scrolls in place a named, focusable group, and only while it does', () => {
    const article = page()
    const callbacks: (() => void)[] = []
    const disconnect = vi.fn<() => void>()
    class Observer {
      constructor(callback: () => void) {
        callbacks.push(callback)
      }
      observe = vi.fn<(target: Element) => void>()
      disconnect = disconnect
    }
    Object.defineProperty(window, 'ResizeObserver', { value: Observer, configurable: true })
    const dispose = enhanceDiagrams(article)
    const [diagram, mermaid] = article.querySelectorAll<HTMLElement>('.diagram')
    if (diagram === undefined || mermaid === undefined) throw new Error('no diagram')

    for (const each of [diagram, mermaid]) {
      Object.defineProperty(each, 'scrollWidth', { value: 900, configurable: true })
      Object.defineProperty(each, 'clientWidth', { value: 300, configurable: true })
    }
    for (const callback of callbacks) callback()
    // A Mermaid slot not yet drawn has no name of its own.
    expect(mermaid.getAttribute('aria-label')).toBe('Diagram')
    expect(diagram.tabIndex).toBe(0)
    expect(diagram.getAttribute('role')).toBe('group')
    expect(diagram.getAttribute('aria-label')).toBe('The loop')

    Object.defineProperty(diagram, 'scrollWidth', { value: 300, configurable: true })
    for (const callback of callbacks) callback()
    expect(diagram.hasAttribute('tabindex')).toBe(false)
    for (const callback of callbacks) callback()
    expect(diagram.hasAttribute('role')).toBe(false)

    dispose()
    expect(disconnect).toHaveBeenCalled()
    Reflect.deleteProperty(window, 'ResizeObserver')
  })
})

describe('the lightbox and text selection', () => {
  it('turns selection off only while a drag lasts, and leaves none behind', () => {
    const article = page()
    enhanceDiagrams(article)
    document.querySelector<HTMLButtonElement>('.diagram-expand')?.click()
    const stage = document.querySelector<HTMLElement>('.lightbox-stage')
    if (stage === null) throw new Error('no stage')
    const root = document.documentElement

    expect(root.hasAttribute('data-dragging')).toBe(false)
    stage.dispatchEvent(pointer('pointerdown', { x: 10, y: 10, id: 1 }))
    expect(root.dataset['dragging']).toBe('true')
    stage.dispatchEvent(pointer('pointermove', { x: 40, y: 10, id: 1 }))
    stage.dispatchEvent(pointer('pointercancel', { x: 40, y: 10, id: 1 }))
    expect(root.hasAttribute('data-dragging')).toBe(false)
    expect(window.getSelection()?.toString()).toBe('')
    document.querySelector<HTMLButtonElement>('[data-action="close"]')?.click()

    // The figure's own words can still be selected afterwards.
    const caption = article.querySelector('figcaption')
    const range = document.createRange()
    if (caption === null) throw new Error('no caption')
    range.selectNodeContents(caption)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    expect(window.getSelection()?.toString()).toBe('Marks make it prompt.')
    window.getSelection()?.removeAllRanges()
  })
})
