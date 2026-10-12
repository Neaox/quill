import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useRememberedChoice } from './use-remembered-choice.ts'

const KEY = 'remembered-choice.test'
const VALUES = ['one', 'two', 'three'] as const

afterEach(() => {
  globalThis.localStorage.clear()
  vi.restoreAllMocks()
})

describe('useRememberedChoice', () => {
  it('starts from the fallback and remembers a choice for next time', () => {
    const first = renderHook(() => useRememberedChoice(KEY, VALUES, 'one'))
    expect(first.result.current[0]).toBe('one')

    act(() => {
      first.result.current[1]('three')
    })
    expect(first.result.current[0]).toBe('three')

    const next = renderHook(() => useRememberedChoice(KEY, VALUES, 'one'))
    expect(next.result.current[0]).toBe('three')
  })

  it('reads a stored value it does not offer as the fallback', () => {
    globalThis.localStorage.setItem(KEY, 'four')
    const { result } = renderHook(() => useRememberedChoice(KEY, VALUES, 'two'))
    expect(result.current[0]).toBe('two')
  })

  it('still works when storage refuses to be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useRememberedChoice(KEY, VALUES, 'one'))
    expect(result.current[0]).toBe('one')

    act(() => {
      result.current[1]('two')
    })
    expect(result.current[0]).toBe('two')
  })
})
