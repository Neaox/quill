import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

/**
 * A module fetched when it is wanted rather than with the page: a virtual
 * proxy (the GoF pattern, not yet in `docs/architecture/patterns.md`) over a
 * dynamic `import()`, with an observer — `subscribe` returning the
 * unsubscribe, as the catalogue spells it — so a component can render without
 * the module and again once it is here.
 *
 * It exists for the overlay machinery — the menus, dialogs and popovers whose
 * focus trapping, roving focus and floating positioning a reader pays for
 * before the first paint of every document, though none of it draws anything
 * until somebody presses a control (quill-plan.md section 31). Each of those
 * components renders its closed state without the module, asks for it in idle
 * time, and holds a press that lands first (`useOnDemand`).
 */
export interface OnDemand<T> {
  /** The module, once it has arrived. */
  readonly current: () => T | undefined
  /** Fetches the module, once; safe to call any number of times. */
  readonly load: () => Promise<T>
  /** Calls `listener` when the module arrives; returns the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void
  /**
   * Fetches the module in the page's idle time, once however many components
   * ask: a sidebar of a thousand row menus schedules one fetch, not a thousand.
   */
  readonly prefetch: () => void
}

export function onDemand<T>(importer: () => Promise<T>): OnDemand<T> {
  let module: T | undefined
  let request: Promise<T> | undefined
  const listeners = new Set<() => void>()
  let prefetching = false

  const load = (): Promise<T> => {
    request ??= importer().then(
      (arrived) => {
        const focus = focusedPlace()
        module = arrived
        for (const listener of listeners) listener()
        restoreFocus(focus)
        return arrived
      },
      (error: unknown) => {
        // A failed fetch is not cached: the next press tries again.
        request = undefined
        throw error
      },
    )
    return request
  }

  return {
    current: () => module,
    load,
    prefetch: () => {
      if (prefetching || module !== undefined) return
      prefetching = true
      whenIdle(() => {
        void load().catch(() => {
          // Nobody's error yet: the next press asks again.
          prefetching = false
        })
      })
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * The module if it is here, `undefined` until it is; fetched in the page's
 * idle time from the moment the component mounts, so in practice it has
 * arrived before anybody reaches for the control.
 *
 * `now` asks for it straight away instead — a dialog that is already open, a
 * press that is waiting.
 */
export function useOnDemand<T>(source: OnDemand<T>, now = false): T | undefined {
  const module = useSyncExternalStore(source.subscribe, source.current, source.current)

  // Subscribes to the page's idle time — an external system — for the fetch.
  useEffect(() => {
    if (module !== undefined) return undefined
    if (now) {
      void source.load().catch(ignore)
      return undefined
    }
    return whenIdle(() => {
      void source.load().catch(ignore)
    })
  }, [source, module, now])

  return module
}

/**
 * The module for **one instance of a control that has many siblings**, only
 * once that instance is engaged — its menu pressed, its dialog opened, its tip
 * wanted — and never before, however early the module arrived.
 *
 * `useOnDemand` hands the module to every component that asks the moment it
 * arrives, which is right for a dialog or two and ruinous for a list: a
 * sidebar with a menu on each of twenty thousand rows re-rendered every one of
 * them into the full overlay machinery in a single synchronous commit, and the
 * page hung (2026-10-17). Here an unengaged instance does not even subscribe,
 * so the module's arrival costs it nothing; the fetch still happens once in
 * idle time (`prefetch`), so the first press finds it waiting.
 *
 * Engagement latches: an overlay that has mounted stays mounted when it
 * closes, so closing is the primitive's to animate and its focus handling to
 * finish. The caller attaches what this returns *beside* its own light
 * control rather than in place of it, so the element under the pointer is the
 * same element before and after.
 */
export function useOnDemandWhen<T>(source: OnDemand<T>, engaged: boolean): T | undefined {
  const [latched, setLatched] = useState(engaged)
  // Adjusting state to a prop during render, the documented alternative to an
  // effect: once asked for, it stays asked for.
  if (engaged && !latched) setLatched(true)
  const wanted = engaged || latched

  const subscribe = useCallback(
    (listener: () => void) => (wanted ? source.subscribe(listener) : ignoreSubscription),
    [source, wanted],
  )
  const current = useCallback(() => (wanted ? source.current() : undefined), [source, wanted])
  const module = useSyncExternalStore(subscribe, current, current)

  // The idle fetch, or the immediate one once engaged: the network is the
  // external system this synchronises with.
  useEffect(() => {
    if (wanted) void source.load().catch(ignore)
    else source.prefetch()
  }, [source, wanted])

  return module
}

function ignoreSubscription(): void {}

/**
 * A fetch that fails in idle time is nobody's error yet: the control still
 * works without it, and the press that needs it asks again.
 */
function ignore(): void {}

/** Runs `task` when the page is idle; returns what cancels it. */
function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    // Within two seconds even on a page that never settles.
    const handle = requestIdleCallback(task, { timeout: 2000 })
    return () => {
      cancelIdleCallback(handle)
    }
  }
  const handle = setTimeout(task, 1)
  return () => {
    clearTimeout(handle)
  }
}

interface FocusedPlace {
  readonly element: Element
  readonly parent: ParentNode
  readonly index: number
}

/** Where focus is, by its position among its siblings, which outlives the element. */
function focusedPlace(): FocusedPlace | undefined {
  if (typeof document === 'undefined') return undefined
  const element = document.activeElement
  const parent = element?.parentNode
  if (element === null || parent === null || parent === undefined || element === document.body) {
    return undefined
  }
  return { element, parent, index: [...parent.childNodes].indexOf(element) }
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Upgrading a control replaces its element — the closed trigger becomes the
 * one the overlay library renders — and a focused element that leaves the
 * document takes the focus with it, to the body. So when the element that had
 * focus is gone after the re-render, focus goes to its replacement: whatever
 * is focusable at the same place. Nothing moves if focus went anywhere else
 * meanwhile.
 */
function restoreFocus(place: FocusedPlace | undefined): void {
  if (place === undefined) return
  // After React has committed the re-render the listeners scheduled.
  setTimeout(() => {
    const active = document.activeElement
    if (place.element.isConnected || (active !== null && active !== document.body)) return
    const replacement = place.parent.childNodes[place.index]
    if (!(replacement instanceof HTMLElement)) return
    const target = replacement.matches(FOCUSABLE)
      ? replacement
      : replacement.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()
  }, 0)
}
