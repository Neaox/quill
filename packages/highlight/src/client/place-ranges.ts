/**
 * Token ranges placed over text that is split across several text nodes
 * (ADR-030).
 *
 * The reader holds a block as one text node, so a range's offsets are already
 * offsets into it. An editor does not: CodeMirror draws one element per line
 * and only the lines in view, so a range counted over the block's text has to
 * be found in whichever line's text node holds it, and a token that runs
 * across lines — a block comment — becomes one piece per line. Each piece lies
 * inside one node, which is all a `StaticRange` built by the environment's
 * `createRange(node, start, end)` needs, so both surfaces paint through the
 * same registry and the same range factory.
 */
import type { TokenRange } from '../tokens.ts'
import type { TextNodeLike } from './apply-highlighting.ts'

/** One text node, and the offset in the block's text where its first character sits. */
export interface TextSegment {
  readonly node: TextNodeLike
  readonly start: number
}

/** A token range, or the part of one, that lies inside one text node. */
export interface PlacedRange extends TokenRange {
  readonly node: TextNodeLike
  /** Where the piece starts and ends within `node`. */
  readonly from: number
  readonly to: number
}

/** The index of the first range that ends after `offset`; ranges are sorted and tile. */
function firstEndingAfter(ranges: readonly TokenRange[], offset: number): number {
  let low = 0
  let high = ranges.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const range = ranges[middle]
    if (range !== undefined && range.end <= offset) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Places sorted, non-overlapping `ranges` over `segments`, clipping each range
 * to the text the segments hold.
 *
 * Each segment finds its first range by binary search and walks only the
 * ranges that touch it, so the cost is the lines on screen and their tokens,
 * however long the block above or below them is.
 */
export function placeRanges(
  segments: readonly TextSegment[],
  ranges: readonly TokenRange[],
): PlacedRange[] {
  return segments
    .filter((segment) => segment.node.data.length > 0)
    .flatMap((segment) => {
      const end = segment.start + segment.node.data.length
      const pieces: PlacedRange[] = []
      for (let index = firstEndingAfter(ranges, segment.start); index < ranges.length; index += 1) {
        const range = ranges[index]
        if (range === undefined || range.start >= end) break
        const from = Math.max(range.start, segment.start)
        const to = Math.min(range.end, end)
        pieces.push({
          start: from,
          end: to,
          type: range.type,
          node: segment.node,
          from: from - segment.start,
          to: to - segment.start,
        })
      }
      return pieces
    })
}
