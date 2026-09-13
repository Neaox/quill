import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDebouncedValue } from './use-debounced-value.ts'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDebouncedValue', () => {
  it('starts at the value it was given, with nothing to wait for', () => {
    const { result } = renderHook(() => useDebouncedValue('failover', 200))

    expect(result.current).toBe('failover')
  })

  it('holds the previous value until the pause has passed', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: 'f' },
    })

    rerender({ value: 'fail' })
    expect(result.current).toBe('f')

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(result.current).toBe('f')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('fail')
  })

  it('settles once on the last value of a burst, not once per keystroke', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: '' },
    })

    for (const value of ['f', 'fa', 'fai', 'fail', 'failo']) {
      rerender({ value })
      act(() => {
        vi.advanceTimersByTime(50)
      })
      expect(result.current).toBe('')
    }

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe('failo')
  })

  it('cancels a pending update when it is unmounted', () => {
    const { result, rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: 'f' },
    })

    rerender({ value: 'fail' })
    unmount()

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current).toBe('f')
  })
})
