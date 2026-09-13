/**
 * Markup presentation: escaped HTML with `<span class="tok-<class>">` around
 * each range, for the static-export path and the no-`CSS.highlights`
 * fallback (ADR-030). Pure derivation from ranges, same as `packRanges` — it
 * never re-tokenizes.
 */
import { TOKEN_CLASS_PREFIX, type TokenRange } from './tokens.ts'

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Renders `text` as escaped HTML, wrapping each of `ranges` in a themed span
 * and leaving the gaps between them as plain escaped text.
 *
 * `ranges` is what `tokenize` produces: sorted and tiling. Ranges that arrive
 * any other way — a hand-written or truncated `data-tokens` attribute, a
 * payload from an older writer — are clamped into the tiling this function
 * guarantees rather than trusted: each range is held to the text's bounds and
 * to the end of the one before it, and an empty range contributes nothing.
 * Stripping every `<span>`/`</span>` tag from the result therefore always
 * yields exactly `text`, HTML-escaped, whatever the ranges said.
 */
export function toMarkup(text: string, ranges: readonly TokenRange[]): string {
  const sorted = ranges.toSorted((a, b) => a.start - b.start)
  let html = ''
  let cursor = 0
  for (const range of sorted) {
    const start = Math.min(Math.max(range.start, cursor), text.length)
    const end = Math.min(Math.max(range.end, start), text.length)
    if (start > cursor) html += escapeHtml(text.slice(cursor, start))
    if (end > start) {
      html += `<span class="${TOKEN_CLASS_PREFIX}${range.type}">${escapeHtml(text.slice(start, end))}</span>`
    }
    cursor = end
  }
  if (cursor < text.length) html += escapeHtml(text.slice(cursor))
  return html
}
