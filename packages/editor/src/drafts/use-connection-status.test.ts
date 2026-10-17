import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AutosaveStatus } from './autosave-machine.ts'
import { createFakeClock } from './clock.ts'
import type { LockStatus } from './lock-machine.ts'
import { isDisconnected, LOCK_EXPIRY_MS, useConnectionStatus } from './use-connection-status.ts'

describe('isDisconnected', () => {
  it.each([
    ['a save that could not be delivered', 'retrying', 'held'],
    ['the browser saying it is offline', 'offline', 'held'],
    ['a missed heartbeat', 'saved', 'reconnecting'],
    ['two missed heartbeats', 'idle', 'at_risk'],
  ] as const)('is true after %s', (_name, autosave, lock) => {
    expect(isDisconnected(autosave, lock)).toBe(true)
  })

  it.each([
    ['saved', 'held'],
    ['dirty', 'held'],
    ['conflict', 'held'],
    ['idle', 'held_by_other'],
  ] as const)('is false while autosave is %s and the lock %s', (autosave, lock) => {
    expect(isDisconnected(autosave, lock)).toBe(false)
  })
})

function render(clock = createFakeClock(1_000)) {
  const view = renderHook(
    (props: { autosave: AutosaveStatus; lock: LockStatus }) =>
      useConnectionStatus({ ...props, clock }),
    { initialProps: { autosave: 'saved' as AutosaveStatus, lock: 'held' as LockStatus } },
  )
  return { ...view, clock }
}

describe('useConnectionStatus', () => {
  it('is online while saves and heartbeats come back', () => {
    const { result } = render()
    expect(result.current).toEqual({ offline: false, offlineSince: null, othersMayEdit: false })
  })

  it('remembers when the disconnection began, and says after a minute that others may edit', () => {
    const { result, rerender, clock } = render()
    rerender({ autosave: 'retrying', lock: 'held' })
    expect(result.current).toEqual({ offline: true, offlineSince: 1_000, othersMayEdit: false })

    act(() => {
      clock.advance(10_000)
    })
    rerender({ autosave: 'retrying', lock: 'reconnecting' })
    expect(result.current.offlineSince).toBe(1_000)
    expect(result.current.othersMayEdit).toBe(false)

    act(() => {
      clock.advance(LOCK_EXPIRY_MS - 10_000)
    })
    expect(result.current.othersMayEdit).toBe(true)
  })

  it('starts afresh after the connection comes back', () => {
    const { result, rerender, clock } = render()
    rerender({ autosave: 'offline', lock: 'at_risk' })
    act(() => {
      clock.advance(LOCK_EXPIRY_MS)
    })
    expect(result.current.othersMayEdit).toBe(true)

    rerender({ autosave: 'saved', lock: 'held' })
    expect(result.current).toEqual({ offline: false, offlineSince: null, othersMayEdit: false })

    rerender({ autosave: 'offline', lock: 'held' })
    expect(result.current.offlineSince).toBe(1_000 + LOCK_EXPIRY_MS)
    expect(result.current.othersMayEdit).toBe(false)
  })

  it('reads the system clock when none is given', () => {
    const { result } = renderHook(() => useConnectionStatus({ autosave: 'offline', lock: 'held' }))
    expect(result.current.offline).toBe(true)
    expect(result.current.offlineSince).not.toBeNull()
  })
})
