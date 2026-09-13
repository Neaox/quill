/**
 * How a schema attribute survives a trip through the DOM.
 *
 * The Markdown package declares the attributes and deliberately declares no HTML
 * for them: the reading surfaces render from mdast, and only the editor needs a
 * DOM at all. ProseMirror does need one — the clipboard is HTML, so an attribute
 * with no DOM form is silently lost when an author copies a block and pastes it
 * back. These two functions are that DOM form, one pair for every attribute in
 * the schema, so nothing depends on remembering to write a rule per node.
 *
 * A handful of attributes are real HTML attributes and are written as such,
 * because a `data-src` on an `<img>` shows no image. Everything else is written
 * as `data-<kebab-name>`, where it cannot collide with an HTML attribute that
 * means something else.
 */

/** Attributes whose name in the schema is also their name in HTML. */
const HTML_ATTRIBUTES: ReadonlySet<string> = new Set([
  'src',
  'alt',
  'title',
  'href',
  'start',
  'colspan',
  'rowspan',
])

function kebab(name: string): string {
  return name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

export function domAttributeName(name: string): string {
  return HTML_ATTRIBUTES.has(name) ? name : `data-${kebab(name)}`
}

/**
 * One attribute as HTML. An unset attribute writes nothing at all, so an absent
 * attribute and an explicitly null one stay the same thing after a round trip.
 * A structured value (a directive's attribute record, the raw mdast escape hatch)
 * is JSON, because the alternative is the string `[object Object]`.
 */
export function renderAttribute(name: string, value: unknown): Record<string, string> {
  if (value === null || value === undefined || value === false) return {}
  const serialised = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return { [domAttributeName(name)]: serialised }
}

function isJsonish(value: string): boolean {
  const first = value.charAt(0)
  return first === '{' || first === '['
}

/** The inverse of `renderAttribute`, reading one attribute back off an element. */
export function parseAttribute(name: string, element: HTMLElement): unknown {
  const raw = element.getAttribute(domAttributeName(name))
  if (raw === null) return null
  if (isJsonish(raw)) return JSON.parse(raw)
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw)
  return raw
}
