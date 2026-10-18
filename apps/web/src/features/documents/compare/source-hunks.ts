import type { SourceLine } from '../../../lib/api/index.ts'

/**
 * The source view's two arrangements of a line comparison: folded into
 * hunks with context, and paired side by side. Pure, so a 4,000-line
 * document is arranged once per answer and only its hunks are drawn.
 */

/** Unchanged lines kept on each side of a change. */
export const CONTEXT_LINES = 3

/** A folded stretch shorter than this is shown instead: a button would be longer than it. */
const MINIMUM_FOLD = 4

export type SourcePart =
  | { readonly kind: 'hunk'; readonly index: number; readonly lines: readonly SourceLine[] }
  | { readonly kind: 'gap'; readonly index: number; readonly lines: readonly SourceLine[] }

export function foldSource(lines: readonly SourceLine[]): readonly SourcePart[] {
  const distance = distanceToChange(lines.map((line) => line.change !== 'equal'))
  const anyChange = distance.some((value) => value === 0)
  const near = (index: number) => (distance[index] ?? Infinity) <= CONTEXT_LINES

  const parts: { kind: SourcePart['kind']; lines: SourceLine[] }[] = []
  for (const [index, line] of lines.entries()) {
    const kind = near(index) ? 'hunk' : 'gap'
    const last = parts.at(-1)
    if (last?.kind === kind) last.lines.push(line)
    else parts.push({ kind, lines: [line] })
  }

  // A gap too short to fold joins the hunks around it.
  const merged: { kind: SourcePart['kind']; lines: SourceLine[] }[] = []
  for (const part of parts) {
    const kind =
      part.kind === 'gap' && part.lines.length < MINIMUM_FOLD && anyChange ? 'hunk' : part.kind
    const last = merged.at(-1)
    if (last?.kind === 'hunk' && kind === 'hunk') last.lines.push(...part.lines)
    else merged.push({ kind, lines: [...part.lines] })
  }
  return merged.map((part, index) => ({ ...part, index }))
}

/**
 * How far each item is from the nearest changed one, in two linear sweeps,
 * so a rewrite of thousands of lines is arranged in linear time.
 */
export function distanceToChange(changed: readonly boolean[]): readonly number[] {
  const distance = changed.map((isChanged) => (isChanged ? 0 : Infinity))
  for (let index = 1; index < distance.length; index += 1) {
    distance[index] = Math.min(distance[index] ?? Infinity, (distance[index - 1] ?? Infinity) + 1)
  }
  for (let index = distance.length - 2; index >= 0; index -= 1) {
    distance[index] = Math.min(distance[index] ?? Infinity, (distance[index + 1] ?? Infinity) + 1)
  }
  return distance
}

export interface SideBySideRow {
  readonly before?: SourceLine | undefined
  readonly after?: SourceLine | undefined
}

/**
 * Lines as rows of two columns: an unchanged line on both sides, and within
 * each stretch of change the removed lines beside the added ones, in order.
 */
export function sideBySide(lines: readonly SourceLine[]): readonly SideBySideRow[] {
  const rows: SideBySideRow[] = []
  let removed: SourceLine[] = []
  let added: SourceLine[] = []
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index += 1) {
      rows.push({ before: removed[index], after: added[index] })
    }
    removed = []
    added = []
  }
  for (const line of lines) {
    if (line.change === 'removed') removed.push(line)
    else if (line.change === 'added') added.push(line)
    else {
      flush()
      rows.push({ before: line, after: line })
    }
  }
  flush()
  return rows
}
