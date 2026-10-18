import type { Transaction } from '@tiptap/pm/state'

import { changedBlocks } from '../document/changed-blocks.ts'
import type { BlockRange } from '../document/changed-blocks.ts'
import { MAX_MATCHES, findMatches } from './find-matches.ts'
import type { Found, FoundMatch, Match } from './find-matches.ts'
import type { CompiledPattern } from './find-pattern.ts'

/**
 * Finding again after an edit, where the edit was (quill-plan.md section 31).
 *
 * A match never leaves its line of text, and every line is inside one top-level block, so a match
 * in a block the edit did not touch is still a match once it has been mapped through the edit:
 * only the touched blocks (`changedBlocks`, as the decorations of labels and emoji use) are
 * searched again. A keystroke with the find bar open costs one block, however long the document.
 *
 * The one exception is a search that stopped at its limit: what lay past the limit was never
 * looked for, so an edit that removes a match cannot know what comes in after the last, and the
 * search is done again from the start (still lazily, to the limit).
 */

export interface Refound {
  readonly found: Found
  /** The blocks searched again; undefined when the whole document was. */
  readonly changed: readonly BlockRange[] | undefined
  /** What was found in them. */
  readonly fresh: readonly FoundMatch[]
}

const inside = (match: Match, range: BlockRange): boolean =>
  match.from >= range.from && match.to <= range.to

/** Where a match is after the edit, or undefined where the edit took it away. */
function mapped(match: FoundMatch, transaction: Transaction): FoundMatch | undefined {
  const from = transaction.mapping.mapResult(match.from, 1)
  const to = transaction.mapping.mapResult(match.to, -1)
  if (from.deleted || to.deleted || to.pos - from.pos !== match.to - match.from) return undefined
  return { from: from.pos, to: to.pos, captured: match.captured }
}

/** The part of a block within the stretch searched, or undefined where they do not meet. */
function within(range: BlockRange, scope: Match | undefined): BlockRange | undefined {
  if (scope === undefined) return range
  const from = Math.max(range.from, scope.from)
  const to = Math.min(range.to, scope.to)
  return from < to ? { from, to } : undefined
}

export function refindChanged(
  previous: Found,
  transaction: Transaction,
  pattern: CompiledPattern,
  scope: Match | undefined,
  limit: number = MAX_MATCHES,
): Refound {
  const { doc } = transaction
  if (previous.truncated) {
    const found = findMatches(doc, pattern, scope, limit)
    return { found, changed: undefined, fresh: found.matches }
  }
  const changed = changedBlocks(transaction)
  const kept = previous.matches.flatMap((match) => {
    const moved = mapped(match, transaction)
    return moved === undefined || changed.some((range) => inside(moved, range)) ? [] : [moved]
  })
  const fresh = changed.flatMap((range) => {
    const searched = within(range, scope)
    return searched === undefined ? [] : findMatches(doc, pattern, searched, limit + 1).matches
  })
  const matches = [...kept, ...fresh].toSorted((a, b) => a.from - b.from)
  const truncated = matches.length > limit
  return {
    found: { matches: truncated ? matches.slice(0, limit) : matches, truncated },
    changed,
    fresh,
  }
}
