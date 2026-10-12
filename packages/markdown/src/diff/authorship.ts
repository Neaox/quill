import type { Root, RootContent } from 'mdast'

import { alignBlocks } from './blocks.ts'
import { blocksOf } from './compare.ts'
import { nodeKey } from './keys.ts'
import type { RevertContext } from './revert.ts'
import { revertibleChanges } from './revert.ts'

/**
 * Who wrote what is waiting in a draft.
 *
 * A draft is one tree that several people write in turn, so nothing in it says whose a
 * block is. Each save is compared with the one before it, block by block (`alignBlocks`,
 * the engine every comparison here is built on), and the blocks that were added or edited
 * are stamped with whoever saved: the draft carries a small ledger of those stamps beside
 * the tree. Publishing clears it, because from then the draft says what is published.
 *
 * A stamp belongs to what a block says, not to where it is, so it follows a block that is
 * moved and is lost when a block is edited by someone else, which is then theirs. A removal
 * is remembered by the block it took out. The ledger is a record for the people reading
 * the comparison, never a thing the document depends on: a draft with none, or one that
 * does not match the tree, simply has changes whose author is not known.
 *
 * Persisted, so versioned (ADR-033): every reader dispatches on `version`.
 */

export interface Stamp {
  /** The user who saved. */
  readonly by: string
  /** When, as an ISO date and time. */
  readonly at: string
}

export interface Authorship {
  readonly version: 1
  /** The stamp of each block the draft has that the published page does not, by what it says. */
  readonly blocks: Readonly<Record<string, Stamp>>
  /** Blocks taken out of the draft, by what they said, newest last. */
  readonly removed: readonly (Stamp & { readonly key: string })[]
}

/** A ledger remembers this many removals; beyond that the oldest are forgotten. */
export const REMOVALS_KEPT = 500

export const NO_AUTHORSHIP: Authorship = { version: 1, blocks: {}, removed: [] }

/** A short, stable name for what a block says: the ledger is keyed by it, not by the text. */
function digest(node: RootContent): string {
  // cyrb53: 53 bits are plenty to tell the blocks of one document apart.
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (const character of nodeKey(node)) {
    const code = character.codePointAt(0) ?? 0
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

function isStamp(value: unknown): value is Stamp {
  return (
    typeof value === 'object' &&
    value !== null &&
    'by' in value &&
    typeof value.by === 'string' &&
    'at' in value &&
    typeof value.at === 'string'
  )
}

/** The ledger a draft row holds, or nothing when it holds none or one this code cannot read. */
export function readAuthorship(value: unknown): Authorship | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('version' in value) || value.version !== 1) return undefined
  const blocks = 'blocks' in value && typeof value.blocks === 'object' ? value.blocks : null
  const removed = 'removed' in value && Array.isArray(value.removed) ? value.removed : null
  if (blocks === null || removed === null) return undefined
  return {
    version: 1,
    blocks: Object.fromEntries(Object.entries(blocks).filter(([, stamp]) => isStamp(stamp))),
    removed: removed.filter(
      (entry): entry is Stamp & { key: string } =>
        isStamp(entry) && 'key' in entry && typeof entry.key === 'string',
    ),
  }
}

/**
 * The ledger after `stamp.by` saved `after` over `before`: what they added or edited is
 * theirs, what they took out is remembered, and everything else keeps the stamp it had.
 */
export function stampEdit(
  previous: Authorship | undefined,
  before: Root,
  after: Root,
  stamp: Stamp,
): Authorship {
  const known = previous ?? NO_AUTHORSHIP
  const blocks: Record<string, Stamp> = {}
  const removed: (Stamp & { key: string })[] = [...known.removed]
  for (const entry of alignBlocks(blocksOf(before), blocksOf(after))) {
    switch (entry.kind) {
      case 'unchanged':
      case 'moved': {
        const key = digest(entry.after)
        const had = known.blocks[digest(entry.before)]
        if (had !== undefined) blocks[key] = had
        break
      }
      case 'added':
      case 'changed':
        blocks[digest(entry.after)] = stamp
        break
      case 'removed':
        removed.push({ ...stamp, key: digest(entry.before) })
        break
    }
  }
  // A block that is back is no longer a removal.
  return {
    version: 1,
    blocks,
    removed: removed.filter(({ key }) => !(key in blocks)).slice(-REMOVALS_KEPT),
  }
}

/** Who last wrote this block, when the ledger knows. */
export function writtenBy(
  authorship: Authorship | undefined,
  block: RootContent,
): Stamp | undefined {
  return authorship?.blocks[digest(block)]
}

/** Who took this block out, when the ledger knows. */
export function removedBy(
  authorship: Authorship | undefined,
  block: RootContent,
): Stamp | undefined {
  const key = digest(block)
  const entry = authorship?.removed.findLast((each) => each.key === key)
  return entry === undefined ? undefined : { by: entry.by, at: entry.at }
}

/**
 * Who made each change of a comparison with the draft, for the changes the ledger can speak
 * to: an added or edited block by the stamp its place in the draft carries, a removed one by
 * the record of its removal. A draft that has drifted from what was compared (see
 * `revertibleChanges`) is not one whose places can be trusted, so none are named for it.
 */
export function attributeChanges(
  context: RevertContext,
  authorship: Authorship | undefined,
): ReadonlyMap<string, Stamp> {
  if (authorship === undefined) return new Map()
  const aligned = revertibleChanges(context)
  const draft = blocksOf(context.draft)
  const named = context.comparison.changes.flatMap((change): [string, Stamp][] => {
    if (!aligned.has(change.id)) return []
    const block = change.change === 'removed' ? change.previous : draft[change.at]
    const stamp =
      block === undefined
        ? undefined
        : change.change === 'removed'
          ? removedBy(authorship, block)
          : writtenBy(authorship, block)
    return stamp === undefined ? [] : [[change.id, stamp]]
  })
  return new Map(named)
}
