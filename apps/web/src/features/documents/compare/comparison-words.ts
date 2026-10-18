import type { Comparison, ComparisonChange } from '../../../lib/api/index.ts'
import { DRAFT_SIDE } from '../../../lib/api/index.ts'
import type { LabelledRevision } from '../../../lib/documents/revision-labels.ts'
import { shortRevision } from '../../../lib/documents/revision-labels.ts'

/**
 * The words the comparison view says things in, kept together so the title,
 * the summary, the list of changes and the pickers never disagree.
 */

/** A count with its noun, singular when there is one. */
function count(value: number, noun: string): string {
  return `${value} ${value === 1 ? noun : `${noun}s`}`
}

/**
 * What changed, in one line: "3 sections changed · 2 added · 1 removed ·
 * 140 words added". A part that did not happen is left out.
 */
export function summarise(summary: Comparison['summary']): string {
  const parts = [
    summary.sections > 0 ? `${count(summary.sections, 'section')} changed` : undefined,
    summary.added > 0 ? `${summary.added} added` : undefined,
    summary.removed > 0 ? `${summary.removed} removed` : undefined,
    summary.changed > 0 ? `${summary.changed} edited` : undefined,
    summary.moved > 0 ? `${summary.moved} moved` : undefined,
    summary.wordsAdded > 0 ? `${count(summary.wordsAdded, 'word')} added` : undefined,
    summary.wordsRemoved > 0 ? `${count(summary.wordsRemoved, 'word')} removed` : undefined,
  ].filter((part) => part !== undefined)
  return parts.length === 0 ? 'No differences' : parts.join(' · ')
}

/** One end of a comparison, as a reader calls it. */
export function sideLabel(revisions: readonly LabelledRevision[], side: string | null): string {
  if (side === null) return 'an empty document'
  if (side === DRAFT_SIDE) return 'your draft'
  return revisions.find((revision) => revision.revision === side)?.label ?? shortRevision(side)
}

/** The page's heading: "Changes between v1 and v2". */
export function comparisonTitle(
  revisions: readonly LabelledRevision[],
  range: { readonly from: string | null; readonly to: string },
): string {
  const to = sideLabel(revisions, range.to)
  if (range.from === null) return `Everything in ${to}`
  return `Changes between ${sideLabel(revisions, range.from)} and ${to}`
}

const BLOCK_NAMES: Readonly<Record<string, string>> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  list: 'List',
  table: 'Table',
  code: 'Code block',
  image: 'Image',
  diagram: 'Diagram',
  quote: 'Quote',
  callout: 'Callout',
  divider: 'Divider',
}

const CHANGE_NAMES: Readonly<Record<ComparisonChange['change'], string>> = {
  added: 'added',
  removed: 'removed',
  changed: 'edited',
  moved: 'moved',
}

/** What kind of block changed: "Paragraph", "Code block". */
export function blockName(block: string): string {
  return BLOCK_NAMES[block] ?? 'Block'
}

/** "Paragraph added", "Table edited". */
export function describeChange(change: Pick<ComparisonChange, 'change' | 'block'>): string {
  return `${blockName(change.block)} ${CHANGE_NAMES[change.change]}`
}

/** The kind of change alone, capitalised, for its badge. */
export function changeName(change: ComparisonChange['change']): string {
  const name = CHANGE_NAMES[change]
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`
}
