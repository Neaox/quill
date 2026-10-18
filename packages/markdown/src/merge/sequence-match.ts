import { diffSequences } from '../diff/sequence.ts'

const identity = (key: string): string => key

/**
 * Which item of `after` each item of `before` survives as: its index there,
 * or -1 for an item that is gone. Read from the one two-way differ
 * (`diff/sequence.ts`, Myers after trimming the common prefix and suffix), so
 * what the merge calls unchanged is what the comparison view calls unchanged
 * (ADR-021, amendment of 2026-10-11: "one differ, too").
 */
export function matchSequences(before: readonly string[], after: readonly string[]): Int32Array {
  const matches = new Int32Array(before.length).fill(-1)
  for (const edit of diffSequences(before, after, identity)) {
    if (edit.kind === 'equal') matches[edit.before] = edit.after
  }
  return matches
}
