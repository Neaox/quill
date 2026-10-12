import { LCS } from 'node-diff3'

/**
 * Which item of `after` each item of `before` survives as: its index there,
 * or -1 for an item that is gone. A longest common subsequence over the items'
 * keys, so the matched pairs are in order on both sides.
 *
 * The common prefix and suffix are matched first, by a straight walk, and only
 * the middle goes to the LCS. A merge compares a base with a side that changed
 * a few places in it, so the middle is the span between the first and last
 * change — usually a handful of items, even in a document of thousands of
 * lines. That keeps the quadratic worst case of the LCS (many equal keys:
 * blank lines in code, `the` in prose) off the common path (quill-plan.md
 * section 31).
 */
export function matchSequences(before: readonly string[], after: readonly string[]): Int32Array {
  const matches = new Int32Array(before.length).fill(-1)
  let start = 0
  const shorter = Math.min(before.length, after.length)
  while (start < shorter && before[start] === after[start]) {
    matches[start] = start
    start += 1
  }
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1
    endAfter -= 1
    matches[endBefore] = endAfter
  }
  if (endBefore === start || endAfter === start) return matches

  const middleBefore = before.slice(start, endBefore)
  const middleAfter = after.slice(start, endAfter)
  for (let link = LCS(middleBefore, middleAfter); link.chain !== null; link = link.chain) {
    matches[start + link.buffer1index] = start + link.buffer2index
  }
  return matches
}
