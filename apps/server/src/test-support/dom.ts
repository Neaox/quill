/**
 * The handful of DOM shapes the server's jsdom tests read.
 *
 * The server is compiled without the DOM library on purpose — nothing in it
 * may reach for `document` — so a test that runs in jsdom (`// @vitest-environment
 * jsdom`) to check the public site's markup or its script declares the little
 * it uses here, instead of widening the whole program's globals.
 */

export interface TestElement {
  readonly id: string
  readonly textContent: string | null
  open: boolean
  innerHTML: string
  getAttribute(name: string): string | null
  hasAttribute(name: string): boolean
  querySelector(selector: string): TestElement | null
  querySelectorAll(selector: string): Iterable<TestElement>
  dispatchEvent(event: unknown): boolean
  focus(): void
}

export interface TestDocument {
  readonly body: TestElement
  readonly activeElement: TestElement | null
  querySelector(selector: string): TestElement | null
  querySelectorAll(selector: string): Iterable<TestElement>
}

type EventConstructor = new (type: string, init?: Record<string, unknown>) => unknown

/** A global the jsdom environment provides, typed as the little a test reads of it. */
function global<T>(name: string): T {
  return Reflect.get(globalThis, name) as T
}

/** Markup parsed as a whole document, the way a browser would. */
export function parseHtml(markup: string): TestDocument {
  const Parser =
    global<new () => { parseFromString(text: string, type: string): TestDocument }>('DOMParser')
  return new Parser().parseFromString(`<!doctype html><body>${markup}</body>`, 'text/html')
}

/** The environment's own document. */
export function currentDocument(): TestDocument {
  return global<TestDocument>('document')
}

/** An event of one of the DOM's own kinds: `KeyboardEvent`, `MouseEvent`, `FocusEvent`. */
export function domEvent(
  kind: 'KeyboardEvent' | 'MouseEvent' | 'FocusEvent',
  type: string,
  init: Record<string, unknown> = {},
): unknown {
  const Constructor = global<EventConstructor>(kind)
  return new Constructor(type, { bubbles: true, ...init })
}

/**
 * Stands in for `matchMedia`, which jsdom does not implement: an answer and
 * nothing more, so a test that needs to hear a query change says so here.
 */
export function stubMatchMedia(matches = false): void {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => ({ matches }),
  })
}
