/**
 * The one piece of DOM the Markdown pipeline asks for inside the parse worker
 * (`markdown-parse.worker.ts`).
 *
 * micromark decodes a named character reference — `&copy;`, `&nbsp;` —
 * through `decode-named-character-reference`, whose browser build saves
 * shipping the entity table by setting an element's `innerHTML` and reading
 * the text back. A bundler resolves the browser build for a worker too, and a
 * worker has no `document`, so the pipeline would not even load. This stands
 * in for the single element that build makes. It cannot decode — that needs
 * the table — so it refuses, the parse fails, and the page parses that one
 * paste itself (`markdown-parser.ts` falls back on any failure). A paste with a
 * named reference in it is parsed correctly, just not off the main thread;
 * one without, which is nearly all of them, never asks.
 */

export class NamedReferenceInWorker extends Error {
  constructor() {
    super('A named character reference needs the page to decode it.')
    this.name = 'NamedReferenceInWorker'
  }
}

const standInElement = {
  set innerHTML(_reference: string) {
    throw new NamedReferenceInWorker()
  },
  textContent: '',
}

/** Gives `scope` a `document` that makes the stand-in element, where it has none; whether it did. */
export function standInForDocument(scope: object): boolean {
  if ('document' in scope) return false
  Object.defineProperty(scope, 'document', {
    configurable: true,
    value: { createElement: () => standInElement },
  })
  return true
}

/** Installed as this module evaluates, so whoever imports it first has a `document` to find. */
export const standInInstalled = standInForDocument(globalThis)
