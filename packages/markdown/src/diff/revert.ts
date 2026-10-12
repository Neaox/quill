import type { Root } from 'mdast'

import type { ComparedChange, DocumentComparison } from './compare.ts'
import { blockPositions, blocksOf } from './compare.ts'
import { shapeKey } from './keys.ts'

/**
 * Putting some of a comparison's changes back, in the draft that was compared.
 *
 * A comparison counts the newer document's blocks as the draft would be published, and
 * the draft being edited is not always that document: publishing writes links in their
 * canonical form and takes authoring blocks out. A change is only put back where the
 * draft's block is the very one the comparison saw, so a draft that has drifted from it
 * (a template with parts left in, a link written in its readable form) is never edited
 * at a place that has moved. What cannot be put back is said so, not guessed at.
 *
 * Each change is one block: an added block is taken out, a changed block is replaced by
 * the older one, and a removed block is put back before the block that followed it. A
 * move is not undone here, because where it came from has no place in the newer document.
 */

export interface RevertContext {
  /** The draft, as it is being edited. */
  readonly draft: Root
  /** The newer side of the comparison, as it was parsed: what the draft would publish. */
  readonly after: Root
  readonly comparison: DocumentComparison
}

/** Whether the draft has, at a place, the block the comparison saw there. */
function sameBlock(context: RevertContext, at: number): boolean {
  const there = blocksOf(context.draft)[at]
  const compared = blocksOf(context.after)[at]
  return there !== undefined && compared !== undefined && shapeKey(there) === shapeKey(compared)
}

function canPutBack(context: RevertContext, change: ComparedChange): boolean {
  if (change.change === 'moved') return false
  if (change.change === 'removed') {
    // Nothing of it is in the draft; the blocks around where it goes must be as compared.
    const end = blocksOf(context.draft).length
    return (
      change.previous !== undefined &&
      (change.at >= end || sameBlock(context, change.at)) &&
      (change.at === 0 || sameBlock(context, change.at - 1))
    )
  }
  return (
    (change.change === 'added' || change.previous !== undefined) && sameBlock(context, change.at)
  )
}

/** The ids of the changes that can be put back in this draft. */
export function revertibleChanges(context: RevertContext): ReadonlySet<string> {
  const sameLength = blocksOf(context.draft).length === blocksOf(context.after).length
  if (!sameLength) return new Set()
  return new Set(
    context.comparison.changes.filter((change) => canPutBack(context, change)).map(({ id }) => id),
  )
}

/**
 * The draft with the named changes put back; any that cannot be are left as they are.
 * Applied from the end of the document backwards, so that a place counted in the newer
 * document is still the place when the changes before it are made.
 */
export function revertChanges(context: RevertContext, ids: readonly string[]): Root {
  const allowed = revertibleChanges(context)
  const wanted = new Set(ids)
  const chosen = context.comparison.changes
    .filter(({ id }) => wanted.has(id) && allowed.has(id))
    .toReversed()
    .toSorted((first, second) => second.at - first.at)

  // The draft's own children, blank lines and front matter included: a change is counted
  // among its blocks, and put back at the place that block has among them.
  const children = [...context.draft.children]
  const places = blockPositions(context.draft)
  for (const change of chosen) {
    const older = change.previous === undefined ? [] : [structuredClone(change.previous)]
    // A removal goes in without taking anything out; the others take their block out.
    children.splice(
      places[change.at] ?? children.length,
      change.change === 'removed' ? 0 : 1,
      ...older,
    )
  }
  return { ...context.draft, children }
}
