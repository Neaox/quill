import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { nextIndex, useMenuNavigation } from './use-menu-navigation.ts'

describe('moving through a menu', () => {
  it('wraps at both ends and jumps to either end', () => {
    expect(nextIndex(0, 3, 'ArrowDown')).toBe(1)
    expect(nextIndex(2, 3, 'ArrowDown')).toBe(0)
    expect(nextIndex(0, 3, 'ArrowUp')).toBe(2)
    expect(nextIndex(1, 3, 'Home')).toBe(0)
    expect(nextIndex(1, 3, 'End')).toBe(2)
  })

  it('has nowhere to go in an empty menu, or for a key that is not navigation', () => {
    expect(nextIndex(0, 0, 'ArrowDown')).toBeNull()
    expect(nextIndex(0, 3, 'a')).toBeNull()
  })
})

function setup(count: number) {
  const onSelect = vi.fn<(index: number) => void>()
  const onDismiss = vi.fn<() => void>()
  const view = renderHook(
    ({ items }: { items: number }) => useMenuNavigation({ count: items, onSelect, onDismiss }),
    { initialProps: { items: count } },
  )
  return { onSelect, onDismiss, view }
}

describe('the menu navigation hook', () => {
  it('starts on the first item and consumes the keys it understands', () => {
    const { view } = setup(3)
    expect(view.result.current.activeIndex).toBe(0)
    act(() => {
      expect(view.result.current.handleKey('ArrowDown')).toBe(true)
    })
    expect(view.result.current.activeIndex).toBe(1)
    expect(view.result.current.handleKey('q')).toBe(false)
  })

  it('chooses the active item on Enter and on Tab', () => {
    const { view, onSelect } = setup(3)
    act(() => {
      view.result.current.handleKey('End')
    })
    act(() => {
      expect(view.result.current.handleKey('Enter')).toBe(true)
    })
    expect(onSelect).toHaveBeenCalledWith(2)
    act(() => {
      view.result.current.handleKey('Tab')
    })
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('gives up on Escape', () => {
    const { view, onDismiss } = setup(2)
    act(() => {
      expect(view.result.current.handleKey('Escape')).toBe(true)
    })
    expect(onDismiss).toHaveBeenCalled()
  })

  it('points at nothing when there is nothing, and chooses nothing either', () => {
    const { view, onSelect } = setup(0)
    expect(view.result.current.activeIndex).toBe(-1)
    act(() => {
      expect(view.result.current.handleKey('Enter')).toBe(false)
    })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('never points past the end when the list shrinks under it', () => {
    const { view } = setup(5)
    act(() => {
      view.result.current.setActiveIndex(4)
    })
    view.rerender({ items: 2 })
    expect(view.result.current.activeIndex).toBe(1)
  })
})
