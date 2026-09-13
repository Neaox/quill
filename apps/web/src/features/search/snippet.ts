import type { SearchSnippet } from '../../lib/api/index.ts'

/**
 * Turning a hit's snippet into something renderable.
 *
 * The server sends plain text plus the matched spans as offsets into it, and
 * never HTML (ADR-010): marking up the matches is the client's job precisely
 * so that a document's own words can never become markup on the way to a
 * screen. This module is the whole of that job, and it is a pure function so
 * it is tested without rendering anything (ADR-013).
 */

export interface SnippetSegment {
  readonly text: string
  /** Rendered inside `<mark>` when true. */
  readonly marked: boolean
  /**
   * Where the run starts in the snippet's text. Unique across the segments and
   * stable for a given snippet, so it is the React key — an index would be one
   * too, but this says why it is safe rather than leaving a reader to work it
   * out.
   */
  readonly start: number
}

/**
 * The ranges as the text can actually be cut by: sorted, clamped to the
 * text, emptied of anything inverted or zero-width, and overlapping ones
 * merged.
 *
 * All four are defensive rather than expected — the engine emits sorted,
 * disjoint, in-bounds spans — but a snippet is untrusted text from a
 * document, its offsets travel over the wire, and a bad one must produce a
 * readable snippet rather than scrambled or duplicated words.
 */
function usableRanges(
  text: string,
  ranges: SearchSnippet['ranges'],
): readonly { start: number; end: number }[] {
  const sorted = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(range.start, text.length)),
      end: Math.max(0, Math.min(range.end, text.length)),
    }))
    .filter((range) => range.end > range.start)
    .toSorted((left, right) => left.start - right.start)

  const merged: { start: number; end: number }[] = []
  for (const range of sorted) {
    const last = merged.at(-1)
    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

/**
 * The snippet as alternating plain and matched runs, in order.
 *
 * Empty runs are never emitted, so a match at the very start or the very end
 * does not produce a blank segment for a renderer to think about.
 */
export function snippetSegments(snippet: SearchSnippet): readonly SnippetSegment[] {
  const segments: SnippetSegment[] = []
  let at = 0

  for (const range of usableRanges(snippet.text, snippet.ranges)) {
    if (range.start > at) {
      segments.push({ text: snippet.text.slice(at, range.start), marked: false, start: at })
    }
    segments.push({
      text: snippet.text.slice(range.start, range.end),
      marked: true,
      start: range.start,
    })
    at = range.end
  }

  if (at < snippet.text.length) {
    segments.push({ text: snippet.text.slice(at), marked: false, start: at })
  }
  return segments
}
