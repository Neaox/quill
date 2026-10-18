import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PEEK_CLOSE_DELAY_MS, PEEK_OPEN_DELAY_MS, useLinkPeek } from './use-link-peek.ts'

let host: HTMLElement
let link: HTMLAnchorElement
let other: HTMLAnchorElement

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('article')
  host.innerHTML =
    '<p><a id="one" href="https://blog.example/one"><b>one</b></a> <a id="two" href="https://blog.example/two">two</a></p>'
  document.body.append(host)
  link = host.querySelector<HTMLAnchorElement>('#one')!
  other = host.querySelector<HTMLAnchorElement>('#two')!
})

afterEach(() => {
  host.remove()
  vi.useRealTimers()
})

function pointer(
  type: string,
  target: Element,
  init: { pointerType?: string; relatedTarget?: Element } = {},
) {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget: init.relatedTarget ?? null })
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' })
  act(() => {
    target.dispatchEvent(event)
  })
}

const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

function setUp(enabled = true) {
  const ref = { current: host }
  return renderHook(() => useLinkPeek(ref, enabled))
}

describe('useLinkPeek', () => {
  it('opens for a link the pointer has rested on, and not before', () => {
    const { result } = setUp()
    pointer('pointerover', link.querySelector('b')!)
    wait(PEEK_OPEN_DELAY_MS - 1)
    expect(result.current.anchor).toBeNull()
    wait(1)
    expect(result.current.anchor).toBe(link)
  })

  it('opens nothing for a pointer that only passes over', () => {
    const { result } = setUp()
    pointer('pointerover', link)
    wait(PEEK_OPEN_DELAY_MS - 100)
    pointer('pointerout', link, { relatedTarget: host })
    wait(1000)
    expect(result.current.anchor).toBeNull()
  })

  it('does not close for the pointer moving between the parts of one link', () => {
    const { result } = setUp()
    pointer('pointerover', link)
    wait(PEEK_OPEN_DELAY_MS)
    pointer('pointerout', link.querySelector('b')!, { relatedTarget: link })
    wait(1000)
    expect(result.current.anchor).toBe(link)
  })

  it('closes shortly after the pointer leaves', () => {
    const { result } = setUp()
    pointer('pointerover', link)
    wait(PEEK_OPEN_DELAY_MS)
    pointer('pointerout', link, { relatedTarget: host })
    wait(PEEK_CLOSE_DELAY_MS)
    expect(result.current.anchor).toBeNull()
  })

  it('stays open while the pointer is on the card, and closes when it leaves it', () => {
    const { result } = setUp()
    pointer('pointerover', link)
    wait(PEEK_OPEN_DELAY_MS)
    pointer('pointerout', link, { relatedTarget: host })
    act(() => result.current.hold())
    wait(1000)
    expect(result.current.anchor).toBe(link)
    act(() => result.current.release())
    wait(PEEK_CLOSE_DELAY_MS)
    expect(result.current.anchor).toBeNull()
  })

  it('moves to the next link without a gap', () => {
    const { result } = setUp()
    pointer('pointerover', link)
    wait(PEEK_OPEN_DELAY_MS)
    pointer('pointerout', link, { relatedTarget: other })
    pointer('pointerover', other)
    wait(PEEK_OPEN_DELAY_MS)
    expect(result.current.anchor).toBe(other)
  })

  it('opens for keyboard focus, and closes when it leaves', () => {
    const { result } = setUp()
    act(() => {
      link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    wait(PEEK_OPEN_DELAY_MS)
    expect(result.current.anchor).toBe(link)
    act(() => {
      link.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    })
    wait(PEEK_CLOSE_DELAY_MS)
    expect(result.current.anchor).toBeNull()
  })

  it('closes at once on Escape', () => {
    const { result } = setUp()
    pointer('pointerover', link)
    wait(PEEK_OPEN_DELAY_MS)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(result.current.anchor).toBeNull()
  })

  it('closes when the page scrolls', () => {
    const { result } = setUp()
    pointer('pointerover', link)
    wait(PEEK_OPEN_DELAY_MS)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(result.current.anchor).toBeNull()
  })

  it('opens nothing for a touch, which has no resting pointer', () => {
    const { result } = setUp()
    pointer('pointerover', link, { pointerType: 'touch' })
    wait(1000)
    expect(result.current.anchor).toBeNull()
  })

  it('opens nothing when it is switched off', () => {
    const { result } = setUp(false)
    pointer('pointerover', link)
    wait(1000)
    expect(result.current.anchor).toBeNull()
  })

  it('stops listening when it is unmounted', () => {
    const { result, unmount } = setUp()
    pointer('pointerover', link)
    unmount()
    wait(1000)
    expect(result.current.anchor).toBeNull()
  })
})
