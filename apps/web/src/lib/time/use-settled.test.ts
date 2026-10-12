import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettled } from './use-settled.ts'

describe('useSettled', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts as the value it is given, so the first answer is not waited for', () => {
    const { result } = renderHook(() => useSettled(3, 1000))

    expect(result.current).toBe(3)
  })

  it('takes a new value only once it has stopped changing for the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useSettled(value, 1000), {
      initialProps: { value: 1 },
    })

    rerender({ value: 2 })
    act(() => vi.advanceTimersByTime(600))
    rerender({ value: 3 })
    act(() => vi.advanceTimersByTime(600))
    expect(result.current).toBe(1)

    act(() => vi.advanceTimersByTime(400))
    expect(result.current).toBe(3)
  })
})
