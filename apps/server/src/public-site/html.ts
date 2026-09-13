/**
 * The one way this server builds HTML.
 *
 * Every public page is assembled with the `html` tag, and the tag escapes
 * whatever is interpolated into it unless that value is already marked as
 * HTML. So a tenant's site name, a document title, a search query typed by a
 * stranger, and a navigation label an administrator saved all arrive as text,
 * and the only way to put markup on a page is to say so with {@link raw} —
 * which the rendered body does, because `packages/markdown` has already
 * sanitised it against an allowlist on the way into the render cache
 * (ADR-011). The rule is worth stating because the public site is the one
 * surface where an escaping mistake is a stored cross-site script on a page
 * nobody has to sign in to reach.
 *
 * Deliberately not a template engine. One tag, one escape function and a
 * handful of small functions that return `Html` is the familiar thing here
 * (`docs/architecture/patterns.md`: the well-known approach wins), and it
 * keeps every template a plain function of its view model.
 */

declare const htmlBrand: unique symbol

/** A string that is already HTML: interpolated as it stands, never escaped. */
export interface Html {
  readonly [htmlBrand]: true
  readonly value: string
}

const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
])

/**
 * Text as HTML.
 *
 * Quotes are escaped as well as angle brackets, so one function is correct in
 * element content and inside a quoted attribute alike and a caller never has
 * to pick.
 */
export function escapeHtml(value: string): string {
  /* v8 ignore next -- every character the pattern matches is in the map. */
  return value.replaceAll(/[&<>"']/gu, (character) => ESCAPES.get(character) ?? character)
}

/** Marks a string as HTML that is already safe to emit. */
export function raw(value: string): Html {
  return { value } as Html
}

export const EMPTY_HTML: Html = raw('')

/** What may be interpolated: HTML, text, a number, a list of those, or nothing. */
export type Interpolated =
  | Html
  | string
  | number
  | null
  | undefined
  | false
  | readonly Interpolated[]

function interpolate(value: Interpolated): string {
  if (value === null || value === undefined || value === false) return ''
  if (Array.isArray(value)) return value.map(interpolate).join('')
  if (typeof value === 'object') return (value as Html).value
  return escapeHtml(String(value))
}

export function html(strings: TemplateStringsArray, ...values: readonly Interpolated[]): Html {
  const parts = strings.flatMap((literal, index) => {
    const value = values[index]
    return index < values.length ? [literal, interpolate(value)] : [literal]
  })
  return raw(parts.join(''))
}

/**
 * The finished document, ready to be sent.
 *
 * Trimmed, because the templates are formatted source and their indentation
 * leaks into what they emit: a page that began or ended with the whitespace of
 * the file it was written in would have an identity that changed whenever the
 * formatter reflowed a line.
 */
export function toDocument(body: Html): string {
  return `<!doctype html>\n${body.value.trim()}\n`
}
