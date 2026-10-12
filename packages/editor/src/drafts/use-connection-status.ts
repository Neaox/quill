import { useEffect, useState } from 'react'

import type { AutosaveStatus } from './autosave-machine.ts'
import type { Clock } from './clock.ts'
import { systemClock } from './clock.ts'
import type { LockStatus } from './lock-machine.ts'

/** ADR-021: a lock expires 60 seconds after its last heartbeat. */
export const LOCK_EXPIRY_MS = 60_000

/**
 * Whether this editor has lost touch with the server (ADR-021, amendment of
 * 2026-10-11). The signal is what actually failed — a save that could not
 * be delivered, a heartbeat that did not come back — never
 * `navigator.onLine` alone, which reads "online" behind a captive portal or
 * a broken VPN. Typing never waits on any of it: this only words the status.
 */
export function isDisconnected(autosave: AutosaveStatus, lock: LockStatus): boolean {
  return (
    autosave === 'offline' ||
    autosave === 'retrying' ||
    lock === 'reconnecting' ||
    lock === 'at_risk'
  )
}

export interface ConnectionStatus {
  readonly offline: boolean
  /** When this stretch offline began, by the injected clock. */
  readonly offlineSince: number | null
  /**
   * Offline for as long as a lock lives without a heartbeat, so somebody else
   * may be able to take it and edit now.
   */
  readonly othersMayEdit: boolean
}

export interface UseConnectionStatusOptions {
  readonly autosave: AutosaveStatus
  readonly lock: LockStatus
  readonly clock?: Clock
  readonly lapseAfterMs?: number
}

/**
 * How long this editor has been out of touch, for the status line. Keeps the
 * moment the disconnection began, and wakes once when the lock would lapse.
 */
export function useConnectionStatus(options: UseConnectionStatusOptions): ConnectionStatus {
  const clock = options.clock ?? systemClock
  const lapseAfterMs = options.lapseAfterMs ?? LOCK_EXPIRY_MS
  const offline = isDisconnected(options.autosave, options.lock)

  // The start of the stretch is derived from the previous render's, the
  // pattern React gives for state that follows a prop's transitions.
  const [since, setSince] = useState<number | null>(null)
  if (offline && since === null) setSince(clock.now())
  if (!offline && since !== null) setSince(null)

  // The stretch whose minute has passed; compared with `since`, so a new
  // stretch starts without it.
  const [lapsedFor, setLapsedFor] = useState<number | null>(null)

  // Wakes on `clock` when the lock would lapse, so the status can say so
  // without anything ticking every second.
  useEffect(() => {
    if (since === null) return undefined
    const handle = clock.setTimeout(
      () => {
        setLapsedFor(since)
      },
      Math.max(0, since + lapseAfterMs - clock.now()),
    )
    return () => {
      clock.clearTimeout(handle)
    }
  }, [clock, lapseAfterMs, since])

  return {
    offline,
    offlineSince: offline ? since : null,
    othersMayEdit: offline && since !== null && lapsedFor === since,
  }
}
