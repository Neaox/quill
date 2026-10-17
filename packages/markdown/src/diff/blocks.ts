import type { Nodes } from 'mdast'

import { nodeKey } from './keys.ts'
import { plainText } from './text.ts'
import { isWord, tokenize } from './runs.ts'
import { diffSequences } from './sequence.ts'

/**
 * Block matching: which block of the older sequence each block of the newer
 * one is (ADR-021's amendment, "block level first").
 *
 * 1. Blocks are matched by content key, as a longest common subsequence, so a
 *    block inserted or removed on one side leaves the rest matched in place.
 * 2. A block that left one place and arrived, unchanged, at another is a
 *    **move**, wherever in the document it went.
 * 3. Between two matched blocks, what is left on each side is paired by
 *    similarity — the same kind of block, sharing at least half its words —
 *    as an order-preserving alignment, so an edited paragraph is one changed
 *    block rather than a removal and an addition.
 *
 * The result follows the newer sequence, with each removal placed where it
 * was, before whatever replaced it. The comparison view reads it to draw a
 * document; the merge engine reads it to decide which blocks two sides both
 * changed. It is generic over the node so containers' children — list items,
 * table rows, a callout's body — are matched by the same code.
 */

export type BlockAlignment<T extends Nodes> =
  | { readonly kind: 'unchanged'; readonly before: T; readonly after: T }
  | { readonly kind: 'added'; readonly after: T }
  | { readonly kind: 'removed'; readonly before: T }
  | { readonly kind: 'changed'; readonly before: T; readonly after: T }
  | { readonly kind: 'moved'; readonly before: T; readonly after: T }

/** Blocks sharing less than this much of their words are different blocks. */
export const PAIRING_THRESHOLD = 0.5

/** A block shorter than this is not worth calling a move: a rule, a one-word line. */
const MOVE_MINIMUM_CHARACTERS = 12

/** Past this many candidate pairs between two anchors, pairing falls back to position. */
const PAIRING_BUDGET = 40_000

export interface AlignOptions<T> {
  /** Defaults to `nodeKey`; a caller that already holds keys passes them. */
  readonly key?: ((node: T) => string) | undefined
}

export function alignBlocks<T extends Nodes>(
  before: readonly T[],
  after: readonly T[],
  options: AlignOptions<T> = {},
): readonly BlockAlignment<T>[] {
  const key = options.key ?? nodeKey
  const beforeKeys = before.map(key)
  const afterKeys = after.map(key)
  const edits = diffSequences(
    before.map((_, index) => index),
    after.map((_, index) => index + before.length),
    (index) => (index < before.length ? beforeKeys[index] : afterKeys[index - before.length]) ?? '',
  )

  // Regions between anchors: the unmatched indices on each side.
  interface Region {
    readonly removed: number[]
    readonly added: number[]
    readonly anchor: { readonly before: number; readonly after: number } | undefined
  }
  const regions: Region[] = [{ removed: [], added: [], anchor: undefined }]
  for (const edit of edits) {
    const region = regions.at(-1)
    /* v8 ignore next -- the list starts with a region */
    if (region === undefined) break
    if (edit.kind === 'removed') region.removed.push(edit.before)
    else if (edit.kind === 'added') region.added.push(edit.after)
    else {
      regions.push({ removed: [], added: [], anchor: { before: edit.before, after: edit.after } })
    }
  }

  // Moves: an unmatched block that arrives, unchanged, somewhere else.
  const departed = new Map<string, number[]>()
  for (const region of regions) {
    for (const index of region.removed) {
      const node = before[index]
      if (node === undefined || !substantial(node)) continue
      const name = beforeKeys[index] ?? ''
      departed.set(name, [...(departed.get(name) ?? []), index])
    }
  }
  const movedFrom = new Map<number, number>()
  const movedAway = new Set<number>()
  for (const region of regions) {
    for (const index of region.added) {
      const candidates = departed.get(afterKeys[index] ?? '')
      const origin = candidates?.shift()
      if (origin === undefined) continue
      movedFrom.set(index, origin)
      movedAway.add(origin)
    }
  }

  const alignment: BlockAlignment<T>[] = []
  for (const region of regions) {
    if (region.anchor !== undefined) {
      const older = before[region.anchor.before]
      const newer = after[region.anchor.after]
      if (older !== undefined && newer !== undefined) {
        alignment.push({ kind: 'unchanged', before: older, after: newer })
      }
    }
    const removed = region.removed.filter((index) => !movedAway.has(index))
    alignment.push(...alignRegion(before, after, removed, region.added, movedFrom))
  }
  return alignment
}

/** A block long enough that finding it elsewhere means it was moved. */
function substantial(node: Nodes): boolean {
  return plainText(node).length >= MOVE_MINIMUM_CHARACTERS
}

/**
 * Pairs the leftovers between two anchors, preserving order on both sides:
 * the alignment that pairs the most similarity, with removals emitted before
 * the additions that follow them.
 */
function alignRegion<T extends Nodes>(
  before: readonly T[],
  after: readonly T[],
  removed: readonly number[],
  added: readonly number[],
  movedFrom: ReadonlyMap<number, number>,
): BlockAlignment<T>[] {
  const pairable = added.filter((index) => !movedFrom.has(index))
  const scores = pairScores(before, after, removed, pairable)
  const pairs = new Map<number, number>()
  for (const [older, newer] of scores) pairs.set(newer, older)
  const paired = new Set(pairs.values())

  const result: BlockAlignment<T>[] = []
  let cursor = 0
  const emitRemovedUpTo = (limit: number | undefined) => {
    while (cursor < removed.length) {
      const index = removed[cursor]
      if (index === undefined || (limit !== undefined && index >= limit)) return
      cursor += 1
      const node = before[index]
      if (node !== undefined && !paired.has(index)) result.push({ kind: 'removed', before: node })
    }
  }

  for (const index of added) {
    const node = after[index]
    /* v8 ignore next -- indices come from the sequence itself */
    if (node === undefined) continue
    const origin = movedFrom.get(index)
    const partner = pairs.get(index)
    if (partner !== undefined) emitRemovedUpTo(partner)
    const older = origin ?? partner
    const olderNode = older === undefined ? undefined : before[older]
    if (olderNode === undefined) {
      result.push({ kind: 'added', after: node })
    } else {
      result.push({
        kind: origin === undefined ? 'changed' : 'moved',
        before: olderNode,
        after: node,
      })
    }
  }
  emitRemovedUpTo(undefined)
  // Removals emitted after the last addition belong before it, in reading
  // order, only when nothing paired them; the loop above already put each
  // paired block's predecessors in front of it.
  return removalsBeforeTrailingAdditions(result)
}

/**
 * Additions with no partner, followed by removals with none, read better the
 * other way round: "this went, that came".
 */
function removalsBeforeTrailingAdditions<T extends Nodes>(
  entries: readonly BlockAlignment<T>[],
): BlockAlignment<T>[] {
  const result: BlockAlignment<T>[] = []
  let additions: BlockAlignment<T>[] = []
  for (const entry of entries) {
    if (entry.kind === 'added') {
      additions.push(entry)
    } else if (entry.kind === 'removed') {
      result.push(entry)
    } else {
      result.push(...additions, entry)
      additions = []
    }
  }
  return [...result, ...additions]
}

/**
 * The order-preserving pairing of maximum total similarity, as
 * `[before index, after index]` pairs. A dynamic programme over the region,
 * which is a handful of blocks in any real edit; a region too large to score
 * every pair is paired by position instead.
 */
function pairScores<T extends Nodes>(
  before: readonly T[],
  after: readonly T[],
  removed: readonly number[],
  added: readonly number[],
): readonly (readonly [number, number])[] {
  if (removed.length === 0 || added.length === 0) return []
  const score = (i: number, j: number) => {
    const older = before[removed[i] ?? -1]
    const newer = after[added[j] ?? -1]
    if (older === undefined || newer === undefined || older.type !== newer.type) return 0
    const value = similarity(older, newer)
    return value >= PAIRING_THRESHOLD ? value : 0
  }

  if (removed.length * added.length > PAIRING_BUDGET) {
    return Array.from({ length: Math.min(removed.length, added.length) }, (_, index) => index)
      .filter((index) => score(index, index) > 0)
      .map((index): readonly [number, number] => [removed[index] ?? -1, added[index] ?? -1])
  }

  const rows = removed.length + 1
  const columns = added.length + 1
  const best = new Float64Array(rows * columns)
  for (let i = removed.length - 1; i >= 0; i -= 1) {
    for (let j = added.length - 1; j >= 0; j -= 1) {
      const pair = score(i, j)
      best[i * columns + j] = Math.max(
        best[(i + 1) * columns + j] ?? 0,
        best[i * columns + j + 1] ?? 0,
        pair > 0 ? pair + (best[(i + 1) * columns + j + 1] ?? 0) : 0,
      )
    }
  }

  const pairs: (readonly [number, number])[] = []
  let i = 0
  let j = 0
  while (i < removed.length && j < added.length) {
    const here = best[i * columns + j] ?? 0
    const pair = score(i, j)
    if (pair > 0 && here === pair + (best[(i + 1) * columns + j + 1] ?? 0)) {
      pairs.push([removed[i] ?? -1, added[j] ?? -1])
      i += 1
      j += 1
    } else if (here === (best[(i + 1) * columns + j] ?? 0)) {
      i += 1
    } else {
      j += 1
    }
  }
  return pairs
}

/** A block's words, lower-cased, for comparing how alike two blocks are. */
function words(node: Nodes): string[] {
  return tokenize(plainText(node))
    .filter(isWord)
    .map((word) => word.toLowerCase())
}

/**
 * How much two blocks share: the Dice coefficient of their words, as a
 * multiset and ignoring case. Two blocks with no words at all — two rules,
 * two images with no description — are the same thing in a different state.
 */
export function similarity(left: Nodes, right: Nodes): number {
  const leftWords = words(left)
  const rightWords = words(right)
  if (leftWords.length === 0 && rightWords.length === 0) return 1
  const counts = new Map<string, number>()
  for (const word of leftWords) counts.set(word, (counts.get(word) ?? 0) + 1)
  let shared = 0
  for (const word of rightWords) {
    const remaining = counts.get(word) ?? 0
    if (remaining > 0) {
      shared += 1
      counts.set(word, remaining - 1)
    }
  }
  return (2 * shared) / (leftWords.length + rightWords.length)
}
