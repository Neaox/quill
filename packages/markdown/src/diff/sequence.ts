/**
 * The edit script between two sequences: the one primitive every comparison
 * and merge in this package is built on — blocks, words, table rows, and lines
 * of code alike (ADR-021, amendment of 2026-10-11).
 *
 * Myers' O(ND) algorithm, after trimming the common prefix and suffix, which
 * is where almost all of a revision's sameness is. Items are compared by a
 * caller-supplied key, interned to integers once so the inner loop compares
 * numbers rather than strings.
 *
 * A comparison whose shortest script is longer than `MAX_EDIT_DISTANCE` is a
 * rewrite, not an edit: searching further costs quadratic memory to tell a
 * person that everything changed. Past that bound the remaining middle is
 * reported as removed and then added, which is what it is.
 */
import { itemAt } from './at.ts'

export type Edit =
  | { readonly kind: 'equal'; readonly before: number; readonly after: number }
  | { readonly kind: 'removed'; readonly before: number }
  | { readonly kind: 'added'; readonly after: number }

/** Beyond this many edits, the middle of a comparison is called a rewrite. */
export const MAX_EDIT_DISTANCE = 2000

export function diffSequences<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string,
): readonly Edit[] {
  const ids = new Map<string, number>()
  const intern = (item: T) => {
    const name = key(item)
    const known = ids.get(name)
    if (known !== undefined) return known
    ids.set(name, ids.size)
    return ids.size - 1
  }
  const left = Int32Array.from(before, intern)
  const right = Int32Array.from(after, intern)

  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1
  let leftEnd = left.length
  let rightEnd = right.length
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd -= 1
    rightEnd -= 1
  }

  const prefix = Array.from({ length: start }, (_, index) => equal(index, index))
  const suffix = Array.from({ length: left.length - leftEnd }, (_, index) =>
    equal(leftEnd + index, rightEnd + index),
  )
  const middle =
    myers(left.subarray(start, leftEnd), right.subarray(start, rightEnd), start) ??
    rewrite(start, leftEnd, rightEnd)

  return [...prefix, ...removalsFirst(middle), ...suffix]
}

function equal(before: number, after: number): Edit {
  return { kind: 'equal', before, after }
}

function rewrite(start: number, leftEnd: number, rightEnd: number): readonly Edit[] {
  return [
    ...Array.from({ length: leftEnd - start }, (_, index): Edit => ({
      kind: 'removed',
      before: start + index,
    })),
    ...Array.from({ length: rightEnd - start }, (_, index): Edit => ({
      kind: 'added',
      after: start + index,
    })),
  ]
}

/**
 * The frontier of furthest-reaching paths before step `d`, kept for the walk
 * back. Only diagonals `-(d+1)…d+1` can have been reached, so that is all that
 * is copied.
 */
interface Snapshot {
  readonly d: number
  readonly values: Int32Array
}

function reached(snapshot: Snapshot, diagonal: number): number {
  return itemAt(snapshot.values, diagonal + snapshot.d + 1, 0)
}

/** Myers' greedy forward search, or null when the script is longer than the bound. */
function myers(left: Int32Array, right: Int32Array, offset: number): readonly Edit[] | null {
  const n = left.length
  const m = right.length
  const max = n + m
  const centre = max + 1
  const frontier = new Int32Array(2 * max + 3)
  const trace: Snapshot[] = []

  search: for (let d = 0; d <= max; d += 1) {
    if (d > MAX_EDIT_DISTANCE) return null
    trace.push({ d, values: frontier.slice(centre - d - 1, centre + d + 2) })
    for (let k = -d; k <= d; k += 2) {
      const down = itemAt(frontier, centre + k + 1, 0)
      const rightward = itemAt(frontier, centre + k - 1, 0)
      let x = k === -d || (k !== d && rightward < down) ? down : rightward + 1
      let y = x - k
      while (x < n && y < m && left[x] === right[y]) {
        x += 1
        y += 1
      }
      frontier[centre + k] = x
      if (x >= n && y >= m) break search
    }
  }

  const edits: Edit[] = []
  let x = n
  let y = m
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const snapshot = trace[index]
    /* v8 ignore next -- the trace is indexed within its own length */
    if (snapshot === undefined) break
    const { d } = snapshot
    const k = x - y
    const previousK =
      k === -d || (k !== d && reached(snapshot, k - 1) < reached(snapshot, k + 1)) ? k + 1 : k - 1
    const previousX = reached(snapshot, previousK)
    const previousY = previousX - previousK
    while (x > previousX && y > previousY) {
      x -= 1
      y -= 1
      edits.push(equal(offset + x, offset + y))
    }
    if (d > 0) {
      if (x === previousX) edits.push({ kind: 'added', after: offset + y - 1 })
      else edits.push({ kind: 'removed', before: offset + x - 1 })
    }
    x = previousX
    y = previousY
  }
  return edits.toReversed()
}

/**
 * Within every stretch between two equal items, the removals first and then
 * the additions, each in its own order: how a person reads a change ("this
 * became that"), and the order every consumer of an edit script expects.
 */
function removalsFirst(edits: readonly Edit[]): readonly Edit[] {
  const ordered: Edit[] = []
  let removed: Edit[] = []
  let added: Edit[] = []
  const flush = () => {
    ordered.push(...removed, ...added)
    removed = []
    added = []
  }
  for (const edit of edits) {
    if (edit.kind === 'removed') removed.push(edit)
    else if (edit.kind === 'added') added.push(edit)
    else {
      flush()
      ordered.push(edit)
    }
  }
  flush()
  return ordered
}
