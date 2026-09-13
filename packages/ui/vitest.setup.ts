import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import '@testing-library/jest-dom/vitest'

// Registered explicitly rather than relying on Testing Library's automatic
// cleanup, which only installs itself when the global `afterEach` happens to
// exist at import time.
afterEach(cleanup)

/*
 * jsdom does not implement the layout and pointer APIs that floating and
 * focus-managing primitives rely on. These are the smallest shims that let the
 * real components run unmodified under test; production code never sees them.
 */

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverShim {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverShim,
    writable: true,
  })
}

if (!('DOMRect' in globalThis)) {
  class DOMRectShim {
    readonly x = 0
    readonly y = 0
    readonly width = 0
    readonly height = 0
    readonly top = 0
    readonly right = 0
    readonly bottom = 0
    readonly left = 0
    toJSON(): object {
      return {}
    }
  }
  Object.defineProperty(globalThis, 'DOMRect', { value: DOMRectShim, writable: true })
}

for (const name of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
  if (!(name in Element.prototype)) {
    Object.defineProperty(Element.prototype, name, { value: () => false, writable: true })
  }
}

if (!('scrollIntoView' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => {}, writable: true })
}
