/**
 * Tree encoding.
 *
 * A tree is a sequence of `<mode> <name>\0<20 raw oid bytes>` records ordered
 * by name, except that a subtree sorts as if its name ended in `/`. Getting
 * that ordering wrong produces a tree `git fsck --strict` rejects, so it is the
 * most delicate encoding in the package.
 */

import { GitObjectError } from './objects.ts'

export const MODE_FILE = '100644'
export const MODE_EXECUTABLE = '100755'
export const MODE_SYMLINK = '120000'
export const MODE_TREE = '40000'

export interface GitTreeEntry {
  readonly mode: string
  readonly name: string
  readonly oid: string
}

export function isTree(entry: GitTreeEntry): boolean {
  return entry.mode === MODE_TREE
}

function sortKey(entry: GitTreeEntry): Buffer {
  return Buffer.from(isTree(entry) ? `${entry.name}/` : entry.name, 'utf8')
}

export function compareTreeEntries(a: GitTreeEntry, b: GitTreeEntry): number {
  return Buffer.compare(sortKey(a), sortKey(b))
}

export function encodeTree(entries: readonly GitTreeEntry[]): Buffer {
  const records = entries
    .toSorted(compareTreeEntries)
    .map((entry) =>
      Buffer.concat([
        Buffer.from(`${entry.mode} ${entry.name}\0`, 'utf8'),
        Buffer.from(entry.oid, 'hex'),
      ]),
    )
  return Buffer.concat(records)
}

export function decodeTree(body: Buffer): GitTreeEntry[] {
  const entries: GitTreeEntry[] = []
  let cursor = 0
  while (cursor < body.length) {
    const space = body.indexOf(0x20, cursor)
    const terminator = body.indexOf(0, space)
    if (space === -1 || terminator === -1) throw new GitObjectError('Truncated tree record')
    const end = terminator + 21
    if (end > body.length) throw new GitObjectError('Truncated tree entry id')
    entries.push({
      mode: body.subarray(cursor, space).toString('utf8'),
      name: body.subarray(space + 1, terminator).toString('utf8'),
      oid: body.subarray(terminator + 1, end).toString('hex'),
    })
    cursor = end
  }
  return entries
}
