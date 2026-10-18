/**
 * Text from someone else's page, made safe to store and show (ADR-042).
 *
 * A title is whatever a stranger typed into a `<meta>` tag. Rendering is the
 * UI's job and React escapes it, but a preview is also stored, indexed,
 * logged, and shown in places that do not escape (a notification, a tooltip,
 * an export), so the cleaning happens once, here, at the door:
 *
 * - whitespace and control characters become single spaces, so a title cannot
 *   break a line, forge a second one, or push the layout around;
 * - bidirectional overrides and zero-width characters are removed, since a
 *   right-to-left override reverses what follows it and makes one domain read
 *   as another. Zero-width *joiners* stay: emoji sequences need them;
 * - the length is capped at a code point, never mid-surrogate.
 *
 * The patterns are built from escaped strings because the characters they
 * name are invisible: written literally, nobody reviewing this file could see
 * what it removes.
 */

export const TITLE_LIMIT = 200
export const DESCRIPTION_LIMIT = 400
export const SITE_NAME_LIMIT = 80

/** C0 and C1 controls as whitespace; `\s` already covers line and paragraph separators. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const WHITESPACE_AND_CONTROLS = new RegExp('[\\s\\u0000-\\u001F\\u007F-\\u009F]+', 'gu')
/** Bidi embeddings, overrides and isolates; zero-width space, non-joiner and marks; the BOM. */
export const INVISIBLE_FORMATTING = new RegExp(
  '[\\u200B\\u200C\\u200E\\u200F\\u202A-\\u202E\\u2060\\u2066-\\u2069\\uFEFF]',
  'gu',
)

const ELLIPSIS = '…'

/** The cleaned text, or `null` when nothing is left of it. */
export function cleanText(raw: string | null | undefined, limit: number): string | null {
  if (raw === null || raw === undefined) return null
  const text = raw.replace(INVISIBLE_FORMATTING, '').replace(WHITESPACE_AND_CONTROLS, ' ').trim()
  if (text === '') return null
  // Code points, not UTF-16 units: `Array.from` walks the string by the former.
  const codePoints = text.length > limit ? Array.from(text) : null
  if (codePoints === null || codePoints.length <= limit) return text
  return `${codePoints
    .slice(0, limit - 1)
    .join('')
    .trimEnd()}${ELLIPSIS}`
}
