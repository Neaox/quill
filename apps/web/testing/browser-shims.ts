/**
 * The browser APIs jsdom does not implement, in the smallest form that lets
 * the real components run unmodified under test.
 *
 * This lives outside `src` on purpose: it is test scaffolding, not part of
 * the application. Nothing here fakes a measurement — the geometry shims
 * return an empty rectangle, which is what an unlaid-out document honestly
 * has — and the observer shims record their subscriptions so a test can
 * deliver the entries the browser would, rather than assert against a
 * pretend one.
 */

const EMPTY_RECT = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
} satisfies DOMRect

/** One live `IntersectionObserver`, as the test that wants to drive it sees it. */
export interface ObservedIntersections {
  readonly elements: Set<Element>
  /** Delivers entries for the observed elements, as the browser would on a scroll. */
  intersect(visible: Readonly<Record<string, boolean>>): void
}

export const intersectionObservers: ObservedIntersections[] = []

function defineMissing(target: object, name: string, value: unknown): void {
  if (name in target) return
  Object.defineProperty(target, name, { value, writable: true, configurable: true })
}

export function installBrowserShims(): void {
  for (const prototype of [Range.prototype, Element.prototype]) {
    Object.defineProperty(prototype, 'getBoundingClientRect', {
      value: () => EMPTY_RECT,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(prototype, 'getClientRects', {
      value: () => Object.assign([], { item: () => null }),
      writable: true,
      configurable: true,
    })
  }

  defineMissing(Element.prototype, 'scrollIntoView', () => {})
  defineMissing(Element.prototype, 'scrollTo', () => {})
  defineMissing(document, 'elementFromPoint', () => null)

  for (const name of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture']) {
    defineMissing(Element.prototype, name, () => false)
  }

  class ResizeObserverShim {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  defineMissing(globalThis, 'ResizeObserver', ResizeObserverShim)

  class IntersectionObserverShim {
    readonly #elements = new Set<Element>()

    constructor(callback: IntersectionObserverCallback) {
      const record: ObservedIntersections = {
        elements: this.#elements,
        intersect: (visible) => {
          const entries = [...this.#elements]
            .filter((element) => element.id in visible)
            .map((element) => ({
              target: element,
              isIntersecting: visible[element.id] === true,
            }))
          // The real API hands the observer itself to the callback; nothing
          // under test reads it, so the shim passes its own instance.
          callback(entries as unknown as IntersectionObserverEntry[], this as never)
        },
      }
      intersectionObservers.push(record)
    }

    observe(element: Element): void {
      this.#elements.add(element)
    }

    unobserve(element: Element): void {
      this.#elements.delete(element)
    }

    disconnect(): void {
      this.#elements.clear()
    }

    takeRecords(): [] {
      return []
    }
  }
  defineMissing(globalThis, 'IntersectionObserver', IntersectionObserverShim)
}

/** Forgets the observers of the previous test, so each one drives its own. */
export function resetObservers(): void {
  intersectionObservers.length = 0
}
