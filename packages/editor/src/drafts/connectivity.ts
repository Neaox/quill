/**
 * Whether the browser is online and the tab is visible, as an injected port
 * (like `Clock`), so the autosave and heartbeat loops can pause while there is
 * no point trying and resume the moment there is — and tests can flip both by
 * hand.
 */
export interface Connectivity {
  isOnline(): boolean
  isVisible(): boolean
  /** Called on `online`, `offline` and `visibilitychange`. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void
}

/** The real browser, which is the only place this package runs. */
export const browserConnectivity: Connectivity = {
  isOnline: () => navigator.onLine,
  isVisible: () => document.visibilityState !== 'hidden',
  subscribe(listener) {
    window.addEventListener('online', listener)
    window.addEventListener('offline', listener)
    document.addEventListener('visibilitychange', listener)
    return () => {
      window.removeEventListener('online', listener)
      window.removeEventListener('offline', listener)
      document.removeEventListener('visibilitychange', listener)
    }
  },
}

export interface FakeConnectivity extends Connectivity {
  setOnline(online: boolean): void
  setVisible(visible: boolean): void
}

/** A connectivity a test controls; ships beside `createFakeClock` for the same reason. */
export function createFakeConnectivity(): FakeConnectivity {
  let online = true
  let visible = true
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  return {
    isOnline: () => online,
    isVisible: () => visible,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setOnline(next) {
      online = next
      notify()
    },
    setVisible(next) {
      visible = next
      notify()
    },
  }
}
