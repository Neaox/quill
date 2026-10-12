import type { Comparison } from '../../lib/api/types.ts'
import { counted } from '../../lib/text/plural.ts'

/**
 * What is waiting to be published, in words.
 *
 * The comparison of the draft with the published page already knows what differs;
 * this says it the way a person asks the question before pressing Publish: is there
 * anything, how much, and where. It is data in and strings out, so what the button's
 * panel shows and what a screen reader is told (`text`) can never be two different
 * accounts of the same draft.
 */

export interface ChangeItem {
  /** The comparison's name for the change, to open it by; absent for a property. */
  readonly id?: string
  /** `Added`, `Changed`, `Removed`, `Moved`, or `Property`. */
  readonly kind: string
  /** The section it is in, `The start` before the first heading, or the property's name. */
  readonly where: string
  readonly excerpt: string
  /** Who made it, when that is known and it is a change to the page (not a property). */
  readonly by?: string
}

export interface DescribedChanges {
  /** Nothing differs: there is nothing to publish. */
  readonly empty: boolean
  readonly headline: string
  /** `+42 words, −5 words`, or nothing when no words changed. */
  readonly words: string
  readonly items: readonly ChangeItem[]
  /** How many more there were than `items` lists. */
  readonly more: number
  /** The same, as one sentence. */
  readonly text: string
}

/** How many changes the panel lists before it says how many more. */
export const LISTED = 5

/** What a person whose account is gone is called. */
const UNNAMED = 'Someone'

const KINDS = ['added', 'changed', 'removed', 'moved'] as const

const LABELS: Readonly<Record<(typeof KINDS)[number], string>> = {
  added: 'Added',
  changed: 'Changed',
  removed: 'Removed',
  moved: 'Moved',
}

const WORD = { one: 'word', other: 'words' }
const BLOCK = { one: 'block', other: 'blocks' }
const PROPERTY = { one: 'property', other: 'properties' }

function wordsSaid({ wordsAdded, wordsRemoved }: Comparison['summary']): string {
  return [
    ...(wordsAdded === 0 ? [] : [`+${counted(wordsAdded, WORD)}`]),
    ...(wordsRemoved === 0 ? [] : [`−${counted(wordsRemoved, WORD)}`]),
  ].join(', ')
}

function propertyItem(property: Comparison['properties'][number]): ChangeItem {
  return {
    kind: 'Property',
    where: property.name,
    excerpt: `${property.before ?? 'none'} → ${property.after ?? 'none'}`,
  }
}

export function describeChanges(comparison: Comparison): DescribedChanges {
  const { summary, changes, properties } = comparison
  const edits = KINDS.flatMap((kind) =>
    summary[kind] === 0 ? [] : [`${counted(summary[kind], BLOCK)} ${kind}`],
  )
  const empty = edits.length === 0 && properties.length === 0
  const propertySaid =
    properties.length === 0 ? [] : [`${counted(properties.length, PROPERTY)} changed`]
  const headline = empty ? 'Nothing to publish' : [...edits, ...propertySaid].join(', ')
  const all: ChangeItem[] = [
    ...changes.map((each) => ({
      id: each.id,
      kind: LABELS[each.change],
      where: each.section?.title ?? 'The start',
      excerpt: each.excerpt,
      ...(each.author === undefined ? {} : { by: each.author.name ?? UNNAMED }),
    })),
    ...properties.map(propertyItem),
  ]
  const items = all.slice(0, LISTED)
  const saidWords = wordsSaid(summary)
  const first = items.map(
    (item) =>
      `${item.kind} in ${item.where}${item.by === undefined ? '' : ` by ${item.by}`}: ${item.excerpt}.`,
  )
  return {
    empty,
    headline,
    words: saidWords,
    items,
    more: all.length - items.length,
    text: empty
      ? headline
      : [`${headline}${saidWords === '' ? '' : `, ${saidWords}`}.`, ...first].join(' '),
  }
}

export interface OtherAuthor {
  readonly id: string
  readonly name: string
  /** How many of the changes waiting are theirs. */
  readonly changes: number
}

/**
 * The people other than `me` whose changes would be published with the next publish, each
 * with how many. Changes whose author is not known are no one's here: a warning is for
 * what is known, and a draft with no record has nothing to warn of.
 */
export function othersChanges(comparison: Comparison, me: string): readonly OtherAuthor[] {
  const byPerson = Map.groupBy(
    comparison.changes.flatMap(({ author }) =>
      author === undefined || author.id === me ? [] : [author],
    ),
    ({ id }) => id,
  )
  return [...byPerson].map(([id, theirs]) => ({
    id,
    name: theirs.find(({ name }) => name !== undefined)?.name ?? UNNAMED,
    changes: theirs.length,
  }))
}
