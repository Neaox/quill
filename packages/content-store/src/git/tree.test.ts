import { describe, expect, it } from 'vitest'

import { GitObjectError, hashObject } from './objects.ts'
import {
  compareTreeEntries,
  decodeTree,
  encodeTree,
  isTree,
  MODE_EXECUTABLE,
  MODE_FILE,
  MODE_SYMLINK,
  MODE_TREE,
  type GitTreeEntry,
} from './tree.ts'

const OID = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
const blob = (name: string): GitTreeEntry => ({ mode: MODE_FILE, name, oid: OID })
const tree = (name: string): GitTreeEntry => ({ mode: MODE_TREE, name, oid: OID })

describe('tree ordering', () => {
  it('sorts a subtree as if its name ended in a slash', () => {
    const entries = [blob('z-x.md'), tree('z'), blob('z.md'), blob('zz.md')]
    expect(decodeTree(encodeTree(entries)).map((entry) => entry.name)).toEqual([
      'z-x.md',
      'z.md',
      'z',
      'zz.md',
    ])
  })

  it('compares names as bytes, not as UTF-16 code units', () => {
    expect(compareTreeEntries(blob('é'), blob('z'))).toBeGreaterThan(0)
  })

  it('does not mutate the entries it is given', () => {
    const entries = [blob('b'), blob('a')]
    encodeTree(entries)
    expect(entries.map((entry) => entry.name)).toEqual(['b', 'a'])
  })

  it('produces the object id git produces for a known tree', () => {
    // `git mktree` on a single empty blob named `a.md`.
    const body = encodeTree([blob('a.md')])
    expect(hashObject('tree', body)).toBe('520c9f9f61657ca1e65a288ea77d229a27a8171b')
  })
})

describe('decodeTree', () => {
  it('round-trips every mode the store can encounter', () => {
    const entries = [
      { mode: MODE_FILE, name: 'a', oid: OID },
      { mode: MODE_EXECUTABLE, name: 'b', oid: OID },
      { mode: MODE_SYMLINK, name: 'c', oid: OID },
      { mode: MODE_TREE, name: 'd', oid: OID },
    ]
    expect(decodeTree(encodeTree(entries))).toEqual(entries)
  })

  it('reads an empty tree as no entries', () => {
    expect(decodeTree(Buffer.alloc(0))).toEqual([])
  })

  it('rejects a record with no name terminator', () => {
    expect(() => decodeTree(Buffer.from('100644 a.md'))).toThrow(GitObjectError)
  })

  it('rejects a record whose object id is cut short', () => {
    expect(() => decodeTree(Buffer.from('100644 a.md\0short'))).toThrow(/Truncated tree entry id/)
  })
})

describe('isTree', () => {
  it('distinguishes a subtree from a file', () => {
    expect(isTree(tree('a'))).toBe(true)
    expect(isTree(blob('a'))).toBe(false)
  })
})
