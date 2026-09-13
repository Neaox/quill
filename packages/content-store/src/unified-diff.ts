/**
 * Unified diff of two revisions of one document's Markdown.
 *
 * The line matching is `node-diff3`'s longest-common-subsequence pass, which is
 * already a dependency for three-way merge; this module adds only the hunk
 * grouping and the `diff -u` rendering the compare view expects.
 *
 * Text is compared as newline-terminated lines: a single trailing newline is
 * not a line of its own, which is how a Markdown serialiser writes a document.
 * A side that *lacks* that terminator is not the same file as one that has it,
 * so it is marked the way `diff -u` and `git diff` mark it, with a
 * `\ No newline at end of file` line under the line it applies to.
 */

import { diffIndices, type IDiffIndicesResult } from 'node-diff3'

export interface UnifiedDiff {
  /** Empty when the two revisions are identical. */
  readonly text: string
  readonly added: number
  readonly removed: number
}

export const DEFAULT_CONTEXT = 3

/** `diff -u`'s marker for a file whose last line has no terminator. */
export const NO_NEWLINE = '\\ No newline at end of file'

interface Hunk {
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
  readonly changes: Array<IDiffIndicesResult<string>>
}

/** Whether a side's last line is unterminated, which `''` never is. */
function isOpen(text: string): boolean {
  return text !== '' && !text.endsWith('\n')
}

function toLines(text: string): string[] {
  return text === '' ? [] : text.replace(/\n$/, '').split('\n')
}

export function unifiedDiff(
  path: string,
  before: string,
  after: string,
  context = DEFAULT_CONTEXT,
): UnifiedDiff {
  const a = toLines(before)
  const b = toLines(after)
  const open = { a: isOpen(before), b: isOpen(after) }
  const changes = withTerminatorChange(diffIndices(a, b), a, b, open)
  const hunks = toHunks(changes, context)
  if (hunks.length === 0) return { text: '', added: 0, removed: 0 }
  const lines = [`--- a/${path}`, `+++ b/${path}`]
  for (const hunk of hunks) lines.push(...renderHunk(a, b, hunk, context, open))
  return {
    text: `${lines.join('\n')}\n`,
    added: changes.reduce((total, change) => total + change.buffer2[1], 0),
    removed: changes.reduce((total, change) => total + change.buffer1[1], 0),
  }
}

/**
 * Two texts that differ only in the final newline have no differing lines, so
 * the last line is restated on both sides to carry the marker — which is how
 * `git diff` renders the same change.
 */
function withTerminatorChange(
  changes: Array<IDiffIndicesResult<string>>,
  a: string[],
  b: string[],
  open: { a: boolean; b: boolean },
): Array<IDiffIndicesResult<string>> {
  if (open.a === open.b) return changes
  const last = changes.at(-1)
  if (last !== undefined && last.buffer1[0] + last.buffer1[1] === a.length) return changes
  return [
    ...changes,
    {
      buffer1: [a.length - 1, 1],
      buffer1Content: a.slice(a.length - 1),
      buffer2: [b.length - 1, 1],
      buffer2Content: b.slice(b.length - 1),
    },
  ]
}

/** Changes closer than two context widths share a hunk, as `diff -u` does. */
function toHunks(changes: Array<IDiffIndicesResult<string>>, context: number): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | null = null
  for (const change of changes) {
    const [aStart, aLength] = change.buffer1
    const [bStart, bLength] = change.buffer2
    if (current !== null && aStart - current.aEnd > context * 2) {
      hunks.push(current)
      current = null
    }
    current ??= { aStart, aEnd: aStart, bStart, bEnd: bStart, changes: [] }
    current.changes.push(change)
    current.aEnd = aStart + aLength
    current.bEnd = bStart + bLength
  }
  if (current !== null) hunks.push(current)
  return hunks
}

function renderHunk(
  a: string[],
  b: string[],
  hunk: Hunk,
  context: number,
  open: { a: boolean; b: boolean },
): string[] {
  const aFrom = Math.max(0, hunk.aStart - context)
  const aTo = Math.min(a.length, hunk.aEnd + context)
  const bFrom = Math.max(0, hunk.bStart - context)
  const bTo = Math.min(b.length, hunk.bEnd + context)
  const lines = [`@@ -${range(aFrom, aTo)} +${range(bFrom, bTo)} @@`]
  let cursor = aFrom
  for (const change of hunk.changes) {
    const [aStart, aLength] = change.buffer1
    const [bStart, bLength] = change.buffer2
    emit(lines, ' ', a, cursor, aStart, open.a)
    emit(lines, '-', a, aStart, aStart + aLength, open.a)
    emit(lines, '+', b, bStart, bStart + bLength, open.b)
    cursor = aStart + aLength
  }
  emit(lines, ' ', a, cursor, aTo, open.a)
  return lines
}

/**
 * A run of lines from one side, with the no-terminator marker under the last
 * of them when the run really does reach the end of an unterminated side.
 */
function emit(
  lines: string[],
  prefix: string,
  source: string[],
  from: number,
  to: number,
  open: boolean,
): void {
  for (const line of source.slice(from, to)) lines.push(`${prefix}${line}`)
  if (open && to === source.length && to > from) lines.push(NO_NEWLINE)
}

/** `diff -u` numbers lines from one, and writes an empty range as `0,0`. */
function range(from: number, to: number): string {
  const length = to - from
  return `${length === 0 ? 0 : from + 1},${length}`
}
