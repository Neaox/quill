import { diffSequences } from './sequence.ts'

/**
 * Edit scripts as runs a person can read: "this became that", not a word
 * salad of single-token flips.
 *
 * The same grouping serves words in a paragraph, inline atoms carrying their
 * formatting, and lines of code, so it is written once over any item.
 */

export type Change = 'equal' | 'added' | 'removed'

export interface Run<T> {
  readonly change: Change
  readonly items: readonly T[]
}

export interface RunOptions<T> {
  /**
   * How much of an item a reader sees, for the semantic clean-up: an equal
   * stretch no heavier than the changes on both sides of it is folded into
   * them, so "a {-quick} {-brown}{+slow} {+red} fox" reads as
   * "a {-quick brown}{+slow red} fox". Without it nothing is folded.
   */
  readonly weight?: ((item: T) => number) | undefined
}

/** A stretch of the script before it is tidied: equal runs keep both sides' items. */
interface RawRun<T> {
  readonly change: Change
  readonly before: readonly T[]
  readonly after: readonly T[]
}

export function changeRuns<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string,
  options: RunOptions<T> = {},
): readonly Run<T>[] {
  const raw: RawRun<T>[] = []
  for (const edit of diffSequences(before, after, key)) {
    const last = raw.at(-1)
    const fromBefore = edit.kind === 'added' ? [] : [before[edit.before]]
    const fromAfter = edit.kind === 'removed' ? [] : [after[edit.after]]
    const items = {
      before: fromBefore.filter((item) => item !== undefined),
      after: fromAfter.filter((item) => item !== undefined),
    }
    if (last !== undefined && last.change === edit.kind) {
      raw[raw.length - 1] = {
        change: last.change,
        before: [...last.before, ...items.before],
        after: [...last.after, ...items.after],
      }
    } else {
      raw.push({ change: edit.kind, ...items })
    }
  }

  const tidied = options.weight === undefined ? raw : foldThinEqualities(raw, options.weight)
  return coalesce(tidied)
}

/**
 * The semantic clean-up of diff-match-patch, over items: an equality is
 * dissolved into the changes around it when it is no heavier than the larger
 * side of the change before it and of the change after it.
 */
function foldThinEqualities<T>(
  runs: readonly RawRun<T>[],
  weight: (item: T) => number,
): readonly RawRun<T>[] {
  const heaviest = (stretch: readonly RawRun<T>[]) =>
    Math.max(
      sum(
        stretch.flatMap((run) => (run.change === 'removed' ? run.before : [])),
        weight,
      ),
      sum(
        stretch.flatMap((run) => (run.change === 'added' ? run.after : [])),
        weight,
      ),
    )
  const changedStretch = (from: number, step: 1 | -1) => {
    const stretch: RawRun<T>[] = []
    for (let index = from; index >= 0 && index < runs.length; index += step) {
      const run = runs[index]
      if (run === undefined || run.change === 'equal') break
      stretch.push(run)
    }
    return stretch
  }

  return runs.flatMap((run, index): RawRun<T>[] => {
    if (run.change !== 'equal' || index === 0 || index === runs.length - 1) return [run]
    const own = sum(run.after, weight)
    const left = heaviest(changedStretch(index - 1, -1))
    const right = heaviest(changedStretch(index + 1, 1))
    if (left === 0 || right === 0 || own > left || own > right) return [run]
    return [
      { change: 'removed', before: run.before, after: [] },
      { change: 'added', before: [], after: run.after },
    ]
  })
}

/** Every stretch between equalities as one removal followed by one addition. */
function coalesce<T>(runs: readonly RawRun<T>[]): readonly Run<T>[] {
  const result: Run<T>[] = []
  let removed: T[] = []
  let added: T[] = []
  const flush = () => {
    if (removed.length > 0) result.push({ change: 'removed', items: removed })
    if (added.length > 0) result.push({ change: 'added', items: added })
    removed = []
    added = []
  }
  for (const run of runs) {
    if (run.change === 'removed') removed.push(...run.before)
    else if (run.change === 'added') added.push(...run.after)
    else {
      flush()
      result.push({ change: 'equal', items: run.after })
    }
  }
  flush()
  return result
}

function sum<T>(items: readonly T[], weight: (item: T) => number): number {
  return items.reduce((total, item) => total + weight(item), 0)
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

/**
 * Text as the tokens a reader compares: words, each run of white space, and
 * each punctuation mark. `Intl.Segmenter` rather than a pattern, so words in
 * scripts without spaces between them are still words.
 */
export function tokenize(text: string): readonly string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment)
}

const WORD = /[\p{L}\p{N}]/u

export function isWord(token: string): boolean {
  return WORD.test(token)
}

export function wordCount(tokens: readonly string[]): number {
  return tokens.filter(isWord).length
}

export interface TextSegment {
  readonly change: Change
  readonly text: string
}

export interface TextDiff {
  readonly segments: readonly TextSegment[]
  /** Words in the newer text that the older did not have. */
  readonly added: number
  /** Words in the older text that the newer no longer has. */
  readonly removed: number
}

/** A word-level comparison of two texts, tidied for reading. */
export function diffText(before: string, after: string): TextDiff {
  const runs = changeRuns(tokenize(before), tokenize(after), (token) => token, {
    weight: (token) => token.length,
  })
  return {
    segments: runs.map((run) => ({ change: run.change, text: run.items.join('') })),
    added: wordCount(runs.flatMap((run) => (run.change === 'added' ? run.items : []))),
    removed: wordCount(runs.flatMap((run) => (run.change === 'removed' ? run.items : []))),
  }
}
