import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
} from '@tiptap/pm/transform'
import type { Step } from '@tiptap/pm/transform'
import type { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * The top-level blocks a transaction touched, so a derived view of the
 * document is redone for those and mapped everywhere else (quill-plan.md
 * section 31: a keystroke costs a frame however long the document is).
 *
 * A keystroke changes one block. A decoration that is a pure function of its
 * block — an unknown label, an emoji, a required section's marker — is
 * therefore still right everywhere else once it has been mapped through the
 * transaction, and only the touched blocks need looking at again. Ranges are
 * whole top-level blocks because that is the unit those views are computed
 * over: a label's warning depends on nothing outside its paragraph.
 */

export interface BlockRange {
  readonly from: number
  readonly to: number
}

/** Where a step changed its own output document; null when it cannot say. */
function stepRanges(step: Step): readonly (readonly [number, number])[] | null {
  const ranges: (readonly [number, number])[] = []
  step.getMap().forEach((_oldStart, _oldEnd, start, end) => {
    ranges.push([start, end])
  })
  if (ranges.length > 0) return ranges
  // A mark or an attribute changes the document without moving a position,
  // so its map is empty; the step itself says where it applies.
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return [[step.from, step.to]]
  if (
    step instanceof AttrStep ||
    step instanceof AddNodeMarkStep ||
    step instanceof RemoveNodeMarkStep
  ) {
    return [[step.pos, step.pos]]
  }
  return null
}

/** From the start of the block `from` is in to the end of the block `to` is in or begins. */
function blockRange(doc: PMNode, from: number, to: number): BlockRange {
  const size = doc.content.size
  const start = doc.resolve(Math.min(from, size))
  const end = doc.resolve(Math.min(to, size))
  const last = end.index(0)
  return {
    from: start.posAtIndex(start.index(0), 0),
    to: last < doc.childCount ? end.posAtIndex(last, 0) + doc.child(last).nodeSize : size,
  }
}

/** The changed top-level blocks of `transaction.doc`, in order, overlapping ones merged. */
export function changedBlocks(transaction: Transaction): readonly BlockRange[] {
  if (!transaction.docChanged) return []
  const { doc, mapping, steps } = transaction
  const ranges: BlockRange[] = []
  for (const [index, step] of steps.entries()) {
    const touched = stepRanges(step)
    if (touched === null) return [{ from: 0, to: doc.content.size }]
    const later = mapping.slice(index + 1)
    for (const [start, end] of touched) {
      ranges.push(blockRange(doc, later.map(start, -1), later.map(end, 1)))
    }
  }
  return ranges
    .toSorted((a, b) => a.from - b.from)
    .reduce<BlockRange[]>((merged, range) => {
      const previous = merged.at(-1)
      if (previous !== undefined && range.from <= previous.to) {
        merged[merged.length - 1] = { from: previous.from, to: Math.max(previous.to, range.to) }
      } else {
        merged.push(range)
      }
      return merged
    }, [])
}

/** The decorations a view puts on the blocks between two positions. */
export type DecorateBlocks = (doc: PMNode, from: number, to: number) => readonly Decoration[]

/**
 * A decoration set brought up to date with a transaction: mapped through it,
 * with the decorations of each changed block dropped and drawn again.
 */
export function redecorateChangedBlocks(
  set: DecorationSet,
  transaction: Transaction,
  decorate: DecorateBlocks,
): DecorationSet {
  const changed = changedBlocks(transaction)
  if (changed.length === 0) return set
  const { doc } = transaction
  return changed.reduce(
    (next, { from, to }) => {
      const stale = next.find(from, to).filter((item) => item.from >= from && item.to <= to)
      return next.remove(stale).add(doc, [...decorate(doc, from, to)])
    },
    set.map(transaction.mapping, doc),
  )
}
