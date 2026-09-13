import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

import '@testing-library/jest-dom/vitest'

// Registered explicitly rather than relying on Testing Library's automatic
// cleanup, which only installs itself when the global `afterEach` happens to
// exist at import time.
afterEach(cleanup)

/*
 * ProseMirror and CodeMirror measure the document to place the caret, the
 * selection, and every floating surface. jsdom implements none of that: it has
 * no layout, so ranges and elements report no geometry at all. These are the
 * smallest shims that let the real views run unmodified under test. Production
 * code never sees them, and none of them fakes a measurement — they return an
 * empty geometry, which is what an unlaid-out document honestly has.
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

function defineMissing(target: object, name: string, value: unknown): void {
  if (name in target) return
  Object.defineProperty(target, name, { value, writable: true, configurable: true })
}

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

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverShim {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  defineMissing(globalThis, 'ResizeObserver', ResizeObserverShim)
}

if (!('IntersectionObserver' in globalThis)) {
  class IntersectionObserverShim {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): [] {
      return []
    }
  }
  defineMissing(globalThis, 'IntersectionObserver', IntersectionObserverShim)
}

/*
 * jsdom implements neither the clipboard payload nor the event that carries it,
 * and the editor reads Markdown out of both. These are the two smallest classes
 * that behave the way the specification says for what a paste actually uses.
 */

if (!('DataTransfer' in globalThis)) {
  class DataTransferShim {
    readonly #entries = new Map<string, string>()
    dropEffect = 'none'
    effectAllowed = 'uninitialized'
    readonly files: readonly File[] = []

    get types(): readonly string[] {
      return [...this.#entries.keys()]
    }

    getData(format: string): string {
      return this.#entries.get(format) ?? ''
    }

    setData(format: string, data: string): void {
      this.#entries.set(format, data)
    }

    clearData(): void {
      this.#entries.clear()
    }
  }
  defineMissing(globalThis, 'DataTransfer', DataTransferShim)
}

if (!('ClipboardEvent' in globalThis)) {
  class ClipboardEventShim extends Event {
    readonly clipboardData: DataTransfer | null

    constructor(type: string, init: ClipboardEventInit = {}) {
      super(type, init)
      this.clipboardData = init.clipboardData ?? null
    }
  }
  defineMissing(globalThis, 'ClipboardEvent', ClipboardEventShim)
}

/**
 * `findBy*` and `waitFor` run on Testing Library's own clock, not Vitest's,
 * and its default is one second — comfortable on an idle machine, and not
 * enough when every jsdom project is rendering at once on a loaded one or a
 * small CI runner. The per-test timeout in `vitest.config.ts` is what
 * actually bounds a test that has hung; this only stops a slow render being
 * reported as a missing element.
 */
configure({ asyncUtilTimeout: 5_000 })
