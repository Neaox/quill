import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

import '@testing-library/jest-dom/vitest'

// Registered explicitly rather than relying on Testing Library's automatic
// cleanup, which only installs itself when the global `afterEach` happens to
// exist at import time.
afterEach(cleanup)

/*
 * Testing Library's own waiting, raised from its 1 s default.
 *
 * `testTimeout` in `vitest.config.ts` does not govern it: a `findBy*` or a
 * `waitFor` gives up on its own clock and reports "unable to find", which reads
 * as a broken assertion rather than as a slow machine. A test that is genuinely
 * wrong still fails; it just takes longer to say so.
 */
configure({ asyncUtilTimeout: 10_000 })

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

/**
 * `findBy*` and `waitFor` run on Testing Library's own clock, not Vitest's,
 * and its default is one second — comfortable on an idle machine, and not
 * enough when every jsdom project is rendering at once on a loaded one or a
 * small CI runner. The per-test timeout in `vitest.config.ts` is what
 * actually bounds a test that has hung; this only stops a slow render being
 * reported as a missing element.
 */
configure({ asyncUtilTimeout: 5_000 })
