/**
 * The one piece of DOM the Markdown pipeline asks for inside the parse worker
 * (`markdown-parse.worker.ts`).
 *
 * micromark decodes a named character reference — `&copy;`, `&nbsp;` —
 * through `decode-named-character-reference`, whose browser build saves
 * shipping the entity table by making one element as it loads and reading
 * each reference back through its `innerHTML`. A bundler resolves the browser
 * build for a worker too, and a worker has no `document`, so the pipeline
 * would not even load.
 *
 * This stands in for that one element, answering from the entity table the
 * Node build reads (`character-entities`, already the pipeline's own
 * dependency), so a paste full of `&copy;` is parsed in the worker like any
 * other. The table costs the worker's chunk, never the page's.
 *
 * The stand-in is there only while the pipeline loads — the element is made
 * then and kept — and is taken away after, so nothing loaded later mistakes
 * the worker for a page.
 */

/** The element the browser build makes: set a reference, read the character. */
class DecodingElement {
  textContent = ''
  readonly #entities: Readonly<Record<string, string>>

  constructor(entities: Readonly<Record<string, string>>) {
    this.#entities = entities
  }

  get innerHTML(): string {
    return this.textContent
  }

  set innerHTML(reference: string) {
    const name = reference.slice(1, -1)
    // An unknown name reads back as itself, which the caller takes for "not a reference".
    const character = Object.hasOwn(this.#entities, name) ? this.#entities[name] : undefined
    this.textContent = character ?? reference
  }
}

/**
 * Gives `scope` a `document` that makes the decoding element, where it has
 * none; returns what takes it away again.
 */
export function standInForDocument(
  scope: object,
  entities: Readonly<Record<string, string>>,
): () => void {
  if ('document' in scope) return () => {}
  Object.defineProperty(scope, 'document', {
    configurable: true,
    value: { createElement: () => new DecodingElement(entities) },
  })
  return () => {
    Reflect.deleteProperty(scope, 'document')
  }
}
