import type { Change, TextSegment } from './runs.ts'
import { changeRuns, diffText, wordCount, tokenize } from './runs.ts'

/**
 * Text compared by line, with the words that changed inside each changed
 * line: how a code block is compared (ADR-021's amendment, "code blocks by
 * line") and how the comparison's source view shows a document's Markdown.
 *
 * Within each stretch of change the removed lines come first and the added
 * lines after, and the two are paired in order for their word-level
 * differences, so `const b = 2` becoming `const b = 3` marks the digit and
 * not the line.
 */

export interface LineChange {
  readonly change: Change
  /** The line's number in the older text, from 1; absent for an added line. */
  readonly before?: number | undefined
  /** The line's number in the newer text, from 1; absent for a removed line. */
  readonly after?: number | undefined
  /** The line's text in parts, each marked as it compares; never a newline. */
  readonly segments: readonly TextSegment[]
}

export interface LineComparison {
  readonly lines: readonly LineChange[]
  readonly wordsAdded: number
  readonly wordsRemoved: number
}

export function compareLines(before: readonly string[], after: readonly string[]): LineComparison {
  const runs = changeRuns(before, after, (text) => text)
  const lines: LineChange[] = []
  let older = 1
  let newer = 1
  let wordsAdded = 0
  let wordsRemoved = 0

  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]
    /* v8 ignore next -- indexed within its own length */
    if (run === undefined) continue
    if (run.change === 'equal') {
      for (const text of run.items) {
        lines.push({
          change: 'equal',
          before: older,
          after: newer,
          segments: [{ change: 'equal', text }],
        })
        older += 1
        newer += 1
      }
      continue
    }
    // `changeRuns` coalesces each stretch into a removal followed by the
    // addition that replaced it, if any, so the two are read together.
    const next = runs[index + 1]
    const removed = run.change === 'removed' ? run.items : []
    const added = run.change === 'added' ? run.items : next?.change === 'added' ? next.items : []
    if (run.change === 'removed' && next?.change === 'added') index += 1

    for (const [position, text] of removed.entries()) {
      const partner = added[position]
      const segments: readonly TextSegment[] =
        partner === undefined
          ? [{ change: 'removed', text }]
          : diffText(text, partner).segments.filter((part) => part.change !== 'added')
      wordsRemoved += changedWords(segments)
      lines.push({ change: 'removed', before: older, segments })
      older += 1
    }
    for (const [position, text] of added.entries()) {
      const partner = removed[position]
      const segments: readonly TextSegment[] =
        partner === undefined
          ? [{ change: 'added', text }]
          : diffText(partner, text).segments.filter((part) => part.change !== 'removed')
      wordsAdded += changedWords(segments)
      lines.push({ change: 'added', after: newer, segments })
      newer += 1
    }
  }
  return { lines, wordsAdded, wordsRemoved }
}

/** The words a line's changed parts hold: what the line contributes to a count of words changed. */
function changedWords(segments: readonly TextSegment[]): number {
  return segments
    .filter((segment) => segment.change !== 'equal')
    .reduce((total, segment) => total + wordCount(tokenize(segment.text)), 0)
}

/** A text's lines, without the empty one a trailing newline would make. */
export function linesOf(text: string): readonly string[] {
  if (text === '') return []
  const lines = text.split('\n')
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines
}
