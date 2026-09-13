/**
 * Three-way merge of Markdown (ADR-015).
 *
 * A publish carries the revision its draft was based on. When that base is no
 * longer the head — someone else published, or a change arrived through Git
 * sync — the two sets of edits are merged against their common ancestor
 * instead of one silently overwriting the other. `node-diff3` produces the same
 * output as `git merge-file`, conflict markers included, in a fraction of the
 * time a shell-out takes (research R4).
 */

import { merge } from 'node-diff3'

export interface ThreeWayMerge {
  /** False when the result carries conflict markers and needs a human. */
  readonly clean: boolean
  readonly text: string
}

/** Labels on the conflict markers, as a merge view will show them. */
export const OURS_LABEL = 'yours'
export const THEIRS_LABEL = 'published'

export function threeWayMerge(base: string, ours: string, theirs: string): ThreeWayMerge {
  const outcome = merge(ours.split('\n'), base.split('\n'), theirs.split('\n'), {
    label: { a: OURS_LABEL, b: THEIRS_LABEL },
  })
  return { clean: !outcome.conflict, text: outcome.result.join('\n') }
}
