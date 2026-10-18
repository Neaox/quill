import { afterEach, describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../testing/axe.ts'
import {
  LIVE_REGION_SETTLE_MS,
  createPasteAnnouncer,
  createPasteStatus,
  pasteMessages,
} from './paste-status.ts'

/**
 * The card a large paste shows where it lands, the copy that floats while
 * the card is out of sight, and the live regions that say what happened
 * (quill-plan.md section 31; `docs/design/feedback.md`).
 */

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

const actions = () => ({
  cancel: vi.fn<() => void>(),
  retry: vi.fn<() => void>(),
  dismiss: vi.fn<() => void>(),
})

/** An IntersectionObserver the test reports to, as the browser would on scrolling. */
function viewport() {
  let report: ((entries: { isIntersecting: boolean }[]) => void) | undefined
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        report = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  return {
    show(inSight: boolean) {
      report?.([{ isIntersecting: inSight }])
    },
  }
}

describe('the paste card', () => {
  it('says how far the paste has landed, with Cancel, and settles on how much landed', async () => {
    const status = createPasteStatus(document, actions())
    document.body.append(status.element)
    expect(status.element.textContent).toContain(pasteMessages.landing)
    status.progress(0.4)
    expect(status.element.textContent).toContain('40%')
    expect(status.element.querySelector('[role="progressbar"]')).toHaveAttribute(
      'aria-valuenow',
      '40',
    )
    await expectNoAccessibilityViolations(status.element)
    status.landed(1)
    expect(status.element.textContent).toBe('Pasted 1 block')
    expect(status.element.dataset['state']).toBe('landed')
  })

  it('keeps the press for its own buttons rather than the document', () => {
    const status = createPasteStatus(document, actions())
    document.body.append(status.element)
    const cancel = status.element.querySelector('button')
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    cancel?.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
  })

  it('floats a copy while the card is out of sight, and takes it away when done', () => {
    const scroll = viewport()
    const status = createPasteStatus(document, actions())
    expect(status.float.isConnected).toBe(true)
    expect(status.float.hidden).toBe(true)
    scroll.show(false)
    expect(status.float.hidden).toBe(false)
    expect(status.float).toHaveAttribute('aria-hidden', 'true')
    scroll.show(true)
    expect(status.float.hidden).toBe(true)
    status.dispose()
    expect(status.float.isConnected).toBe(false)
  })

  it('keeps the copy hidden where the browser cannot say what is in sight', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const status = createPasteStatus(document, actions())
    expect(status.float.hidden).toBe(true)
    status.dispose()
  })

  it('offers Try again and Dismiss when the paste failed, and Cancel again when retried', () => {
    const pressed = actions()
    const status = createPasteStatus(document, pressed)
    document.body.append(status.element)
    status.failed()
    const buttons = () => [...status.element.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons()).toEqual(['Try again', 'DismissEsc'])
    status.element.querySelector('button')?.click()
    expect(pressed.retry).toHaveBeenCalledOnce()
    status.landing()
    expect(buttons()).toEqual(['CancelEsc'])
  })
})

describe('paste announcements', () => {
  it('put no live region in the page until a paste has something to say', () => {
    const announcer = createPasteAnnouncer(document)
    expect(document.querySelector('[data-paste-announcer]')).toBeNull()
    announcer.release()
  })

  it('share one pair of live regions for the page, gone when the last editor is', async () => {
    vi.useFakeTimers()
    const first = createPasteAnnouncer(document)
    const second = createPasteAnnouncer(document)
    first.announce('Pasting…')
    // A new region settles into the page before it speaks; the latest words win.
    first.announce('Pasting… 10%')
    expect(document.querySelector('[role="status"]')?.textContent).toBe('')
    vi.advanceTimersByTime(LIVE_REGION_SETTLE_MS)
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Pasting… 10%')
    second.announce('Failed', 'assertive')
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Failed')
    first.release()
    first.release()
    expect(document.querySelector('[role="status"]')).not.toBeNull()
    second.release()
    expect(document.querySelector('[role="status"]')).toBeNull()
    vi.useRealTimers()
  })
})
