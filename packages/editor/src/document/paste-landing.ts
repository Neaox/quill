import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { canJoin } from '@tiptap/pm/transform'
import type { Mappable } from '@tiptap/pm/transform'

/**
 * Where a large paste lands while its blocks arrive in batches (quill-plan.md
 * section 31), as plain transaction steps a test applies to a state.
 *
 * A paste of blocks into the middle of a paragraph splits it, and the blocks
 * go between the halves; into an empty paragraph, they take its place; over a
 * selection, the selection goes first. The landing is made ready at once, in
 * the paste's own task, as that gap between blocks, so the placeholder can sit
 * exactly where the blocks will go; each batch then goes in at the end of the
 * one before. Landed batch by batch, the document ends up as one paste of the
 * whole would leave it (`paste-landing.test.ts` holds it to that).
 */

export interface Landing {
  /** Where the first landed block starts; `at` while nothing has landed. */
  readonly from: number
  /** Where the next batch goes: just after the last block landed. */
  readonly at: number
  /** The empty textblock at `at` the first batch takes the place of, and where it ends. */
  readonly empty: { readonly to: number } | undefined
  /** The empty textblock the first batch took the place of, put back if the paste is cancelled. */
  readonly replaced: PMNode | undefined
  /** Whether a textblock was split to make room, joined again if the paste is cancelled. */
  readonly split: boolean
  /** How many blocks have landed. */
  readonly blocks: number
}

/** A gap between blocks, where nothing has landed yet. */
function gap(at: number, extra: Partial<Landing> = {}): Landing {
  return { from: at, at, empty: undefined, replaced: undefined, split: false, blocks: 0, ...extra }
}

/** Makes the gap the paste lands in, out of the selection `tr` ends with. */
export function prepareLanding(tr: Transaction): Landing {
  if (!tr.selection.empty) tr.deleteSelection()
  const { $from } = tr.selection
  const { depth, parent } = $from
  if (!parent.isTextblock || depth === 0) return gap($from.pos)
  if (parent.content.size === 0) return gap($from.before(), { empty: { to: $from.after() } })
  if ($from.parentOffset === 0) return gap($from.before())
  if ($from.parentOffset === parent.content.size) return gap($from.after())
  tr.split($from.pos)
  // The caret stays where it was, at the end of the first half: before the
  // blocks, so they land after it without moving it, which saves the browser
  // placing it again in every batch.
  tr.setSelection(TextSelection.create(tr.doc, $from.pos))
  // The split leaves the first half's end, then the second half's start.
  return gap($from.pos + 1, { split: true })
}

/** Moves a landing through the steps of another change: an edit made while it waits. */
export function mapLanding(landing: Landing, mapping: Mappable): Landing {
  // Typed just after the paste stays after it; typed just before it stays before.
  const at = mapping.map(landing.at, -1)
  return {
    ...landing,
    at,
    from: landing.blocks === 0 ? at : Math.min(mapping.map(landing.from, 1), at),
    empty: landing.empty === undefined ? undefined : { to: mapping.map(landing.empty.to, 1) },
  }
}

/** The empty textblock still waiting at the landing, if one is: one written in is kept. */
function stillEmpty(tr: Transaction, landing: Landing): PMNode | undefined {
  if (landing.blocks > 0 || landing.empty === undefined) return undefined
  const node = tr.doc.nodeAt(landing.at)
  const intact =
    node?.isTextblock === true &&
    node.content.size === 0 &&
    landing.at + node.nodeSize === landing.empty.to
  return intact ? node : undefined
}

/**
 * Where `blocks` can go: the landing itself, or, in a container that cannot
 * hold them there — a list item must start with a paragraph — just after the
 * nearest container that can.
 */
function placeFor(
  tr: Transaction,
  at: number,
  replacing: boolean,
  blocks: Fragment,
): number | undefined {
  const $at = tr.doc.resolve(at)
  const index = $at.index()
  if ($at.parent.canReplace(index, index + (replacing ? 1 : 0), blocks)) return at
  for (let depth = $at.depth; depth > 0; depth -= 1) {
    const after = $at.after(depth)
    const $after = tr.doc.resolve(after)
    if ($after.parent.canReplace($after.index(), $after.index(), blocks)) return after
  }
  /* v8 ignore next -- the document itself holds any block. */
  return undefined
}

/** Puts a batch of blocks in at the landing; returns where the next batch goes. */
export function insertBatch(tr: Transaction, landing: Landing, blocks: Fragment): Landing {
  if (blocks.childCount === 0) return landing
  const replaced = stillEmpty(tr, landing)
  const place = placeFor(tr, landing.at, replaced !== undefined, blocks)
  /* v8 ignore next 7 -- the document holds any block, so there is always a place. */
  if (place === undefined) {
    // Nowhere it fits as it is: ProseMirror fits it in as best it can.
    const before = tr.doc.content.size
    tr.replaceWith(landing.at, landing.at, blocks)
    const at = landing.at + (tr.doc.content.size - before)
    return { ...landing, at, blocks: landing.blocks + blocks.childCount }
  }
  const to = place === landing.at && replaced !== undefined ? place + replaced.nodeSize : place
  tr.replaceWith(place, to, blocks)
  return {
    ...landing,
    from: landing.blocks === 0 ? place : landing.from,
    at: place + blocks.size,
    empty: undefined,
    replaced: landing.blocks === 0 && to > place ? replaced : landing.replaced,
    blocks: landing.blocks + blocks.childCount,
  }
}

/** Takes out what landed, and puts back what the landing took: the document as it was. */
export function cancelLanding(tr: Transaction, landing: Landing): void {
  if (landing.blocks > 0) {
    tr.replaceWith(landing.from, landing.at, landing.replaced ?? Fragment.empty)
  }
  if (landing.split && canJoin(tr.doc, landing.from)) tr.join(landing.from)
}
