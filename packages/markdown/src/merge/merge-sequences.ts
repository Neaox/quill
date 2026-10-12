import { matchSequences } from './sequence-match.ts'

/**
 * The three-way merge of one sequence — a document's blocks, a list's items,
 * a table's rows, a paragraph's words, a code block's lines — against the
 * sequence both sides started from (ADR-021, amendment of 2026-10-11).
 *
 * Each side is first described as an edit of the base: every base item is
 * kept, modified, deleted or moved, and every gap between base items may have
 * new items inserted into it. The two descriptions are then combined item by
 * item and gap by gap, so edits to different items never touch, and only two
 * edits of the *same* item or the *same* gap can disagree. That is finer than
 * a line merge, where edits to neighbouring lines conflict, and it is what
 * lets two people's changes to neighbouring paragraphs combine.
 *
 * Disagreements come back as conflicts carrying the base, mine and theirs of
 * their span; nothing either side did is dropped without one (the property
 * tests state this).
 */

export interface SequenceMergeOptions<T> {
  /** Equal keys mean equal items: the content, without positions. */
  readonly key: (item: T) => string
  /**
   * Within a run of base items one side replaced, items with equal pair keys
   * (a block's type) are taken to be the same item, modified. Without it, a
   * replaced run is a deletion and an insertion, which is right for words and
   * lines.
   */
  readonly pairKey?: (item: T) => string
  /**
   * How alike a replaced item and a new one are, from 0 (nothing shared) to 1.
   * Anything above 0 can pair as an edit within a replaced run, and an item
   * deleted in one place is taken to have moved, edited, to wherever the one
   * most like it was inserted, if each is the other's closest match. A false
   * move is harmless where the other side left the item alone (it lands as
   * written), and where the other side touched it, a merge or a conflict is
   * what a person would want to see; a missed one would let the other side's
   * edit or deletion of it be dropped without a word.
   */
  readonly similarity?: (before: T, after: T) => number
  /**
   * Merges an item both sides modified. Undefined means the two cannot be
   * combined, which makes the item a conflict.
   */
  readonly mergeItem?: (base: T, mine: T, theirs: T) => T | undefined
  /** Recognise an item one side moved, so the other side's edit follows it. */
  readonly detectMoves?: boolean
}

export type MergeSegment<T> =
  | { readonly kind: 'merged'; readonly items: readonly T[] }
  | {
      readonly kind: 'conflict'
      readonly base: readonly T[]
      readonly mine: readonly T[]
      readonly theirs: readonly T[]
    }

/** What one side did to one base item. */
type Fate<T> =
  | { readonly kind: 'keep' }
  | { readonly kind: 'modify'; readonly item: T }
  | { readonly kind: 'delete' }
  /** Deleted here and inserted, unchanged, somewhere else by the same side. */
  | { readonly kind: 'move' }

/** An item one side inserted; `from` is the base index of a moved item. */
interface Insertion<T> {
  readonly item: T
  readonly from?: number
}

interface EditScript<T> {
  readonly fates: Fate<T>[]
  /** `gaps[g]` is inserted before base item `g`; `gaps[base.length]` at the end. */
  readonly gaps: Insertion<T>[][]
}

interface Hunk {
  readonly baseStart: number
  readonly baseEnd: number
  readonly sideStart: number
  readonly sideEnd: number
}

const KEEP: Fate<never> = { kind: 'keep' }
const DELETE: Fate<never> = { kind: 'delete' }
const MOVE: Fate<never> = { kind: 'move' }

/** An index the caller has already bounds-checked; the check is the loop around it. */
function at<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index]
  /* v8 ignore next -- every caller indexes inside the bounds it is looping over. */
  if (item === undefined) throw new RangeError(`No item at ${index}`)
  return item
}

/** How a side's replaced runs are paired up, and which items are left out of pairing. */
interface Pairing<T> {
  readonly pairKey: ((item: T) => string) | undefined
  readonly key: (item: T) => string
  /** Content one side moved: such an item is a move, never half of a modification. */
  readonly moved: ReadonlySet<string>
  readonly similarity: ((before: T, after: T) => number) | undefined
}

/**
 * Above this many candidate pairs in one replaced run, pairing falls back to
 * block types alone: a run that large is a rewrite, and comparing every pair
 * of its blocks would cost more than the merge it serves (plan section 31).
 */
export const PAIRING_LIMIT = 4096

/**
 * The longest in-order pairing of `from` with `to` under `compatible`: a
 * longest common subsequence where "equal" is any relation, by the textbook
 * table, filled from the end so the walk that reads it goes forwards.
 */
function longestPairing(
  from: number,
  to: number,
  compatible: (left: number, right: number) => boolean,
): Int32Array {
  const width = to + 1
  const table = new Int32Array((from + 1) * width)
  const cell = (row: number, column: number) => at(table, row * width + column)
  const pairs = new Uint8Array(from * to)
  for (let row = from - 1; row >= 0; row -= 1) {
    for (let column = to - 1; column >= 0; column -= 1) {
      const pairable = compatible(row, column)
      pairs[row * to + column] = pairable ? 1 : 0
      const skip = Math.max(cell(row + 1, column), cell(row, column + 1))
      table[row * width + column] = pairable ? Math.max(skip, cell(row + 1, column + 1) + 1) : skip
    }
  }
  const partners = new Int32Array(from).fill(-1)
  let row = 0
  let column = 0
  while (row < from && column < to) {
    if (pairs[row * to + column] === 1 && cell(row, column) === cell(row + 1, column + 1) + 1) {
      partners[row] = column
      row += 1
      column += 1
    } else if (cell(row + 1, column) >= cell(row, column + 1)) row += 1
    else column += 1
  }
  return partners
}

/**
 * Which item of `added` each item of `removed` is a modification of, or -1.
 * Items pair in order when their pair keys (block types) agree and, where the
 * caller says how, when they are related (share some of their words): a
 * paragraph deleted next to one written from scratch is not mistaken for an
 * edit of it. A moved item pairs with nothing, so a paragraph moved away is
 * not mistaken for the one written in its place.
 */
function pairUp<T>(removed: readonly T[], added: readonly T[], pairing: Pairing<T>): Int32Array {
  const partners = new Int32Array(removed.length).fill(-1)
  const { pairKey, key, moved, similarity } = pairing
  if (pairKey === undefined) return partners
  const candidates = (items: readonly T[]) =>
    [...items.keys()].filter((index) => !moved.has(key(at(items, index))))
  const from = candidates(removed)
  const to = candidates(added)
  const pairs =
    similarity === undefined || from.length * to.length > PAIRING_LIMIT
      ? matchSequences(
          from.map((index) => pairKey(at(removed, index))),
          to.map((index) => pairKey(at(added, index))),
        )
      : longestPairing(from.length, to.length, (left, right) => {
          const [before, after] = [at(removed, at(from, left)), at(added, at(to, right))]
          return pairKey(before) === pairKey(after) && similarity(before, after) > 0
        })
  for (const [position, partner] of pairs.entries()) {
    if (partner !== -1) partners[at(from, position)] = at(to, partner)
  }
  return partners
}

/** The base items one side replaced between two matches. */
function describeHunk<T>(
  script: EditScript<T>,
  base: readonly T[],
  side: readonly T[],
  hunk: Hunk,
  pairing: Pairing<T>,
): void {
  const removed = base.slice(hunk.baseStart, hunk.baseEnd)
  const added = side.slice(hunk.sideStart, hunk.sideEnd)
  const insert = (gap: number, index: number) => {
    at(script.gaps, gap).push({ item: at(added, index) })
  }

  let next = 0
  for (const [offset, partner] of pairUp(removed, added, pairing).entries()) {
    const index = hunk.baseStart + offset
    if (partner === -1) {
      script.fates[index] = DELETE
      continue
    }
    for (; next < partner; next += 1) insert(index, next)
    script.fates[index] = { kind: 'modify', item: at(added, partner) }
    next = partner + 1
  }
  for (; next < added.length; next += 1) insert(hunk.baseEnd, next)
}

/** Content that left the base unmatched exactly once and arrived unmatched exactly once. */
function movedContent(
  baseKeys: readonly string[],
  sideKeys: readonly string[],
  matches: Int32Array,
): ReadonlySet<string> {
  const matchedSide = new Set(matches)
  const count = (keys: Iterable<string>) => {
    const counts = new Map<string, number>()
    for (const itemKey of keys) counts.set(itemKey, (counts.get(itemKey) ?? 0) + 1)
    return counts
  }
  const left = count(baseKeys.filter((_, index) => at(matches, index) === -1))
  const arrived = count(sideKeys.filter((_, index) => !matchedSide.has(index)))
  return new Set(
    [...left]
      .filter(([itemKey, times]) => times === 1 && arrived.get(itemKey) === 1)
      .map(([itemKey]) => itemKey),
  )
}

/**
 * A base item this side deleted and inserted unchanged somewhere else, once,
 * is a move. Recording where it came from lets the other side's edit of it
 * follow it to its new place instead of conflicting with a deletion.
 */
function markMoves<T>(
  script: EditScript<T>,
  base: readonly T[],
  baseKeys: readonly string[],
  options: SequenceMergeOptions<T>,
): void {
  const { key, pairKey, similarity } = options
  const inserted = new Map<string, { readonly gap: number; readonly slot: number } | null>()
  for (const [gap, insertions] of script.gaps.entries()) {
    for (const [slot, insertion] of insertions.entries()) {
      const itemKey = key(insertion.item)
      inserted.set(itemKey, inserted.has(itemKey) ? null : { gap, slot })
    }
  }
  const deleted = new Map<string, number | null>()
  for (const [index, fate] of script.fates.entries()) {
    if (fate.kind !== 'delete') continue
    const baseKey = at(baseKeys, index)
    deleted.set(baseKey, deleted.has(baseKey) ? null : index)
  }
  const markMove = (from: number, gapIndex: number, slot: number) => {
    script.fates[from] = MOVE
    const gap = at(script.gaps, gapIndex)
    gap[slot] = { item: at(gap, slot).item, from }
  }
  for (const [itemKey, from] of deleted) {
    const to = inserted.get(itemKey)
    if (from === null || to === null || to === undefined) continue
    markMove(from, to.gap, to.slot)
  }
  if (similarity === undefined || pairKey === undefined) return

  // Then the moves that were edited on the way: a deleted item and an
  // inserted one that are each other's closest match, and alike enough.
  const left = [...script.fates.keys()].filter((index) => at(script.fates, index).kind === 'delete')
  const arrived = script.gaps.flatMap((insertions, gap) =>
    insertions.flatMap((insertion, slot) =>
      insertion.from === undefined ? [{ gap, slot, item: insertion.item }] : [],
    ),
  )
  if (left.length * arrived.length > PAIRING_LIMIT) return
  const score = (from: number, to: { readonly item: T }) => {
    const original = at(base, from)
    return pairKey(original) === pairKey(to.item) ? similarity(original, to.item) : 0
  }
  for (const from of left) {
    const to = closest(arrived, (candidate) => score(from, candidate))
    if (to === undefined || closest(left, (other) => score(other, to)) !== from) continue
    markMove(from, to.gap, to.slot)
  }
}

/** The first candidate rated highest, if any is rated above nothing. */
function closest<C>(candidates: readonly C[], rate: (candidate: C) => number): C | undefined {
  let chosen: C | undefined
  let top = 0
  for (const candidate of candidates) {
    const rating = rate(candidate)
    if (rating > top) {
      chosen = candidate
      top = rating
    }
  }
  return chosen
}

function editScript<T>(
  base: readonly T[],
  baseKeys: readonly string[],
  side: readonly T[],
  options: SequenceMergeOptions<T>,
): EditScript<T> {
  const sideKeys = side.map(options.key)
  const matches = matchSequences(baseKeys, sideKeys)
  const pairing: Pairing<T> = {
    pairKey: options.pairKey,
    key: options.key,
    similarity: options.similarity,
    moved: options.detectMoves === true ? movedContent(baseKeys, sideKeys, matches) : new Set(),
  }
  const script: EditScript<T> = {
    fates: Array.from({ length: base.length }, () => KEEP),
    gaps: Array.from({ length: base.length + 1 }, () => []),
  }
  let baseStart = 0
  let sideStart = 0
  for (let index = 0; index <= base.length; index += 1) {
    // The end of both sequences is a match too, closing the last hunk.
    const partner = index === base.length ? side.length : at(matches, index)
    if (partner === -1) continue
    if (index > baseStart || partner > sideStart) {
      describeHunk(
        script,
        base,
        side,
        { baseStart, baseEnd: index, sideStart, sideEnd: partner },
        pairing,
      )
    }
    baseStart = index + 1
    sideStart = partner + 1
  }
  if (options.detectMoves === true) markMoves(script, base, baseKeys, options)
  return script
}

/** Builds the merged sequence one span at a time, joining neighbouring conflicts. */
class SegmentWriter<T> {
  readonly segments: MergeSegment<T>[] = []

  emit(items: readonly T[]): void {
    if (items.length === 0) return
    const last = this.segments.at(-1)
    if (last?.kind === 'merged') {
      this.segments[this.segments.length - 1] = { kind: 'merged', items: [...last.items, ...items] }
    } else this.segments.push({ kind: 'merged', items })
  }

  conflict(base: readonly T[], mine: readonly T[], theirs: readonly T[]): void {
    const last = this.segments.at(-1)
    if (last?.kind === 'conflict') {
      this.segments[this.segments.length - 1] = {
        kind: 'conflict',
        base: [...last.base, ...base],
        mine: [...last.mine, ...mine],
        theirs: [...last.theirs, ...theirs],
      }
    } else this.segments.push({ kind: 'conflict', base, mine, theirs })
  }
}

/** What one side leaves at a base item's place, ignoring where a move took it. */
function contentOf<T>(fate: Fate<T>, original: T): readonly T[] {
  switch (fate.kind) {
    case 'keep':
      return [original]
    case 'modify':
      return [fate.item]
    case 'delete':
    case 'move':
      return []
  }
}

/** Whether a fate leaves the item in existence for the other side's move to carry. */
const survives = (fate: Fate<unknown>): boolean => fate.kind === 'keep' || fate.kind === 'modify'

export function mergeSequences<T>(
  base: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
  options: SequenceMergeOptions<T>,
): MergeSegment<T>[] {
  const baseKeys = base.map(options.key)
  const ours = editScript(base, baseKeys, mine, options)
  const other = editScript(base, baseKeys, theirs, options)
  const writer = new SegmentWriter<T>()

  const sameKeys = (left: readonly T[], right: readonly T[]) =>
    left.length === right.length &&
    left.every((item, index) => options.key(item) === options.key(at(right, index)))

  const combine = (original: T, left: T, right: T): T | undefined => {
    const leftKey = options.key(left)
    const rightKey = options.key(right)
    if (leftKey === rightKey) return left
    const originalKey = options.key(original)
    // Only a move reaches here with one side unchanged, and it is always the
    // mover's: the other side's item is a modification.
    if (leftKey === originalKey) return right
    return options.mergeItem?.(original, left, right)
  }
  /**
   * Where one side moved an item the other side modified, the modification
   * lands in the item's new place: the mover did not change its content.
   */
  const landed = ({ item, from }: Insertion<T>, otherFates: readonly Fate<T>[]): T | undefined => {
    if (from === undefined) return item
    const otherFate = at(otherFates, from)
    return otherFate.kind === 'modify' ? combine(at(base, from), item, otherFate.item) : item
  }

  /** One side's insertions into a gap the other side left alone. */
  const writeInsertions = (
    insertions: readonly Insertion<T>[],
    otherFates: readonly Fate<T>[],
    mineSide: boolean,
  ) => {
    for (const insertion of insertions) {
      const { item, from } = insertion
      if (from === undefined) {
        writer.emit([item])
        continue
      }
      const arrival = landed(insertion, otherFates)
      if (arrival !== undefined && survives(at(otherFates, from))) {
        writer.emit([arrival])
        continue
      }
      // Moved here by one side and deleted, moved elsewhere, or edited
      // differently by the other: only a person can say which.
      const original = at(base, from)
      const otherFate = at(otherFates, from)
      const others = otherFate.kind === 'modify' ? [otherFate.item] : []
      if (mineSide) writer.conflict([original], [item], others)
      else writer.conflict([original], others, [item])
    }
  }

  // Gaps both sides inserted different things into are conflicts. A move
  // into one is contested: the item leaves its old place only if the person
  // resolving says so, so the old place becomes a conflict too, and whichever
  // way each is resolved, nothing either side wrote disappears unasked.
  const gaps = ours.gaps.map((mineGap, index) => {
    const theirGap = at(other.gaps, index)
    const mineItems = mineGap.map((insertion) => landed(insertion, other.fates) ?? insertion.item)
    const theirItems = theirGap.map((insertion) => landed(insertion, ours.fates) ?? insertion.item)
    const contested = mineGap.length > 0 && theirGap.length > 0 && !sameKeys(mineItems, theirItems)
    return { mineGap, theirGap, mineItems, theirItems, contested }
  })
  const contested = new Set(
    gaps
      .filter((gap) => gap.contested)
      .flatMap(({ mineGap, theirGap }) => [...mineGap, ...theirGap])
      .flatMap(({ from }) => (from === undefined ? [] : [from])),
  )

  for (let index = 0; index <= base.length; index += 1) {
    const gap = at(gaps, index)
    if (gap.mineGap.length === 0) writeInsertions(gap.theirGap, ours.fates, false)
    else if (gap.theirGap.length === 0) writeInsertions(gap.mineGap, other.fates, true)
    else if (gap.contested) writer.conflict([], gap.mineItems, gap.theirItems)
    else writer.emit(gap.mineItems)
    if (index === base.length) break

    const original = at(base, index)
    const mineFate = at(ours.fates, index)
    const theirFate = at(other.fates, index)
    if (contested.has(index)) {
      const [mineContent, theirContent] = [
        contentOf(mineFate, original),
        contentOf(theirFate, original),
      ]
      if (!sameKeys(mineContent, theirContent))
        writer.conflict([original], mineContent, theirContent)
      continue
    }
    // A move the other side let stand is settled where the item lands.
    if (mineFate.kind === 'move' && survives(theirFate)) continue
    if (theirFate.kind === 'move' && survives(mineFate)) continue
    const mineContent = contentOf(mineFate, original)
    const theirContent = contentOf(theirFate, original)
    if (mineFate.kind === 'keep') writer.emit(theirContent)
    else if (theirFate.kind === 'keep') writer.emit(mineContent)
    else if (mineContent.length === 0 && theirContent.length === 0) continue
    else if (mineContent.length === 0 || theirContent.length === 0) {
      writer.conflict([original], mineContent, theirContent)
    } else {
      const mineItem = at(mineContent, 0)
      const theirItem = at(theirContent, 0)
      const merged = combine(original, mineItem, theirItem)
      if (merged === undefined) writer.conflict([original], [mineItem], [theirItem])
      else writer.emit([merged])
    }
  }
  return writer.segments
}

/** The items of a merge that came out clean, or undefined if any of it conflicted. */
export function cleanItems<T>(segments: readonly MergeSegment<T>[]): T[] | undefined {
  const items: T[] = []
  for (const segment of segments) {
    if (segment.kind === 'conflict') return undefined
    items.push(...segment.items)
  }
  return items
}
