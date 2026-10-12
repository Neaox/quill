import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFloatingPlacement } from './use-floating-placement.ts'
import type { Locate } from './use-floating-placement.ts'

/**
 * jsdom lays nothing out, so the popup's size is stated: 200 wide, 500 tall.
 * The viewport is 800 tall, which is what makes "near the bottom" mean something.
 */
const SIZE = { width: 200, height: 500 }

function stubLayout(): void {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(SIZE.width)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(SIZE.height)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(SIZE.height)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(SIZE.height)
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('innerWidth', 1000)
}

function Popup({ locate, active = true }: { locate: Locate; active?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useFloatingPlacement(ref, active, locate, { limit: 600 })
  return (
    <div ref={ref} data-testid="popup">
      popup
    </div>
  )
}

const popup = (): HTMLElement => screen.getByTestId('popup')

describe('useFloatingPlacement', () => {
  beforeEach(stubLayout)
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('hangs below an anchor with room under it, as tall as it wants to be', () => {
    render(<Popup locate={() => ({ top: 100, right: 150, bottom: 120, left: 100 })} />)
    expect(popup().style.top).toBe('124px')
    expect(popup().style.left).toBe('100px')
    expect(popup().style.maxHeight).toBe('600px')
    expect(popup().dataset['side']).toBe('below')
  })

  it('flips above an anchor near the bottom, rather than running off the page', () => {
    render(<Popup locate={() => ({ top: 700, right: 150, bottom: 720, left: 100 })} />)
    expect(popup().dataset['side']).toBe('above')
    expect(popup().style.top).toBe('196px')
  })

  it('limits its height to the room there is, so what it holds can scroll', () => {
    render(<Popup locate={() => ({ top: 300, right: 150, bottom: 320, left: 100 })} />)
    // 500 does not fit below (468) or above (288): the roomier side is below.
    expect(popup().dataset['side']).toBe('below')
    expect(popup().style.maxHeight).toBe('468px')
  })

  it('follows an anchor that the page scrolls away', () => {
    let top = 100
    render(<Popup locate={() => ({ top, right: 150, bottom: top + 20, left: 100 })} />)
    expect(popup().style.top).toBe('124px')
    top = 200
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(popup().style.top).toBe('224px')
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(popup().style.top).toBe('224px')
  })

  it('stays where it was when the anchor cannot be found', () => {
    render(<Popup locate={() => null} />)
    expect(popup().style.top).toBe('')
  })

  it('does nothing while it is not showing, and stops listening when it goes', () => {
    const locate = vi.fn<Locate>(() => ({ top: 1, right: 1, bottom: 2, left: 1 }))
    const { rerender, unmount } = render(<Popup locate={locate} active={false} />)
    expect(locate).not.toHaveBeenCalled()
    rerender(<Popup locate={locate} />)
    const calls = locate.mock.calls.length
    unmount()
    window.dispatchEvent(new Event('scroll'))
    expect(locate).toHaveBeenCalledTimes(calls)
  })
})
