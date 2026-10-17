/**
 * Three-way merge of Markdown (ADR-015).
 *
 * A publish carries the revision its draft was based on. When that base is no
 * longer the head — someone else published, or a change arrived through Git
 * sync — the two sets of edits are merged against their common ancestor
 * instead of one silently overwriting the other.
 *
 * Whether the two combine, and what they combine into, is decided by the one
 * merge engine in `@quill/markdown` (ADR-021, amendment of 2026-10-11), the
 * same one that merges offline drafts, so drafts and publishing cannot
 * disagree about what a conflict is. It merges by block and then by word, so
 * edits to neighbouring lines of one paragraph combine where a line merge
 * would stop.
 *
 * When they do not combine, the text shown in the merge view is what
 * `git merge-file` would write, markers included (ADR-014): `node-diff3`
 * produces the same bytes in a fraction of the time a shell-out takes
 * (research R4), and it is the form a Git user reading a synced repository
 * already knows.
 */

import { mergeMarkdown } from '@quill/markdown'
import { merge } from 'node-diff3'

export interface ThreeWayMerge {
  /** False when the result carries conflict markers and needs a human. */
  readonly clean: boolean
  readonly text: string
}

/** Labels on the conflict markers, as a merge view will show them. */
export const OURS_LABEL = 'yours'
export const THEIRS_LABEL = 'published'

/** The two sides with `git merge-file`'s conflict markers, line by line. */
export function conflictMarkers(base: string, ours: string, theirs: string): string {
  return merge(ours.split('\n'), base.split('\n'), theirs.split('\n'), {
    label: { a: OURS_LABEL, b: THEIRS_LABEL },
  }).result.join('\n')
}

/** The text as whole lines, so a marker written after it starts on a line of its own. */
const lines = (text: string): string => (text === '' || text.endsWith('\n') ? text : `${text}\n`)

/**
 * A document deleted on one side and edited on the other, as one clash.
 *
 * The merge engine reads a deletion as removing every line, which does not
 * collide with an edit it can place, so it calls the pair clean and hands back
 * the surviving side's text — a "conflict" whose text carries no markers and
 * so shows a person nothing to choose between. Only a human can pick between
 * keeping the document and removing it (ADR-015), so the whole of each side is
 * shown, one of them empty, in the form every other conflict is shown in.
 */
export function deletionMarkers(ours: string, theirs: string): string {
  return `<<<<<<< ${OURS_LABEL}\n${lines(ours)}=======\n${lines(theirs)}>>>>>>> ${THEIRS_LABEL}\n`
}

export function threeWayMerge(base: string, ours: string, theirs: string): ThreeWayMerge {
  const merged = mergeMarkdown(base, ours, theirs)
  return merged.clean
    ? { clean: true, text: merged.markdown }
    : { clean: false, text: conflictMarkers(base, ours, theirs) }
}
