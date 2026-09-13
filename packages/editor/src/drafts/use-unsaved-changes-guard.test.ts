import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useUnsavedChangesGuard } from './use-unsaved-changes-guard.ts'

const beforeUnload = (): Event => new Event('beforeunload', { cancelable: true })

function dispatch(target: EventTarget): Event {
  const event = beforeUnload()
  target.dispatchEvent(event)
  return event
}

describe('useUnsavedChangesGuard', () => {
  it('asks the browser to confirm while an edit is unsent', () => {
    const target = new EventTarget()
    renderHook(() => useUnsavedChangesGuard(true, target))

    expect(dispatch(target).defaultPrevented).toBe(true)
  })

  it('lets a clean document close without a prompt', () => {
    const target = new EventTarget()
    renderHook(() => useUnsavedChangesGuard(false, target))

    expect(dispatch(target).defaultPrevented).toBe(false)
  })

  it('stops prompting once the edit has been saved', () => {
    const target = new EventTarget()
    const { rerender } = renderHook(
      ({ unsaved }: { unsaved: boolean }) => useUnsavedChangesGuard(unsaved, target),
      { initialProps: { unsaved: true } },
    )
    expect(dispatch(target).defaultPrevented).toBe(true)

    rerender({ unsaved: false })
    expect(dispatch(target).defaultPrevented).toBe(false)
  })

  it('detaches on unmount', () => {
    const target = new EventTarget()
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true, target))

    unmount()
    expect(dispatch(target).defaultPrevented).toBe(false)
  })

  it('guards the window when no target is injected', () => {
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true))

    expect(dispatch(globalThis.window).defaultPrevented).toBe(true)

    unmount()
    expect(dispatch(globalThis.window).defaultPrevented).toBe(false)
  })
})
