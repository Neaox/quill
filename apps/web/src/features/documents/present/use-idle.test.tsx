import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useIdle } from './use-idle.ts'

describe('useIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts awake and falls idle once nothing has happened', () => {
    const { result } = renderHook(() => useIdle(2000))

    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current).toBe(true)
  })

  it('comes back on pointer movement and on a key', () => {
    const { result } = renderHook(() => useIdle(2000))

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('pointermove'))
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(2000)
      window.dispatchEvent(new Event('keydown'))
    })
    expect(result.current).toBe(false)
  })

  it('restarts the wait on every movement rather than fading mid-gesture', () => {
    const { result } = renderHook(() => useIdle(2000))

    for (let tick = 0; tick < 4; tick += 1) {
      act(() => {
        vi.advanceTimersByTime(1500)
        window.dispatchEvent(new Event('pointermove'))
      })
    }

    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current).toBe(true)
  })

  it('stops listening when the presentation is left', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useIdle(2000))

    unmount()

    expect(remove.mock.calls.map(([event]) => event)).toEqual(
      expect.arrayContaining(['pointermove', 'pointerdown', 'keydown', 'wheel']),
    )
  })
})
