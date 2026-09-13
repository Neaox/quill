/**
 * Encoding properties. Git's own CLI checks the shapes this package writes in
 * practice; these check that nothing survives a round trip by accident.
 */

import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  decodeCommit,
  encodeCommit,
  sanitiseIdentity,
  type GitCommit,
  type GitIdentity,
} from './commit.ts'
import { hashObject, parseObject, serialiseObject, type GitObjectType } from './objects.ts'
import {
  compareTreeEntries,
  decodeTree,
  encodeTree,
  MODE_EXECUTABLE,
  MODE_FILE,
  MODE_SYMLINK,
  MODE_TREE,
  type GitTreeEntry,
} from './tree.ts'
import { foldTrailerValue, formatTrailer, parseTrailers, trailerValues } from './trailers.ts'

const objectType = fc.constantFrom<GitObjectType>('blob', 'tree', 'commit', 'tag')
const oid = fc
  .uint8Array({ minLength: 20, maxLength: 20 })
  .map((bytes) => Buffer.from(bytes).toString('hex'))
const mode = fc.constantFrom(MODE_FILE, MODE_EXECUTABLE, MODE_SYMLINK, MODE_TREE)

const entryName = fc
  .string({ minLength: 1, maxLength: 12, unit: 'grapheme' })
  .filter((name) => !name.includes('/') && !name.includes('\0'))

const treeEntries = fc.uniqueArray(fc.record<GitTreeEntry>({ mode, name: entryName, oid }), {
  maxLength: 8,
  selector: (entry) => entry.name,
})

/**
 * Deliberately unfiltered: a display name is user input, so the encoder — not
 * the generator — is what has to keep `<`, `>`, and newlines out of a header.
 */
const identityText = fc.string({ maxLength: 20, unit: 'grapheme' })

const identity: fc.Arbitrary<GitIdentity> = fc.record({
  name: identityText,
  email: identityText,
  when: fc.integer({ min: 0, max: 2 ** 34 }),
  timezone: fc.constantFrom('+0000', '-0730', '+1300'),
})

const commit: fc.Arbitrary<GitCommit> = fc.record({
  tree: oid,
  parents: fc.array(oid, { maxLength: 2 }),
  author: identity,
  committer: identity,
  message: fc.string({ maxLength: 60, unit: 'grapheme' }).map((text) => `${text}\n`),
})

describe('object serialisation', () => {
  it('round-trips any body of any type', () => {
    fc.assert(
      fc.property(objectType, fc.uint8Array({ maxLength: 256 }), (type, body) => {
        const parsed = parseObject(serialiseObject(type, Buffer.from(body)))
        expect(parsed.type).toBe(type)
        expect(Uint8Array.from(parsed.body)).toEqual(body)
      }),
    )
  })

  it('gives the same body the same object id every time', () => {
    fc.assert(
      fc.property(objectType, fc.uint8Array({ maxLength: 256 }), (type, body) => {
        expect(hashObject(type, body)).toBe(hashObject(type, body))
        expect(hashObject(type, body)).toMatch(/^[0-9a-f]{40}$/)
      }),
    )
  })
})

describe('tree encoding', () => {
  it('round-trips entries in git order', () => {
    fc.assert(
      fc.property(treeEntries, (entries) => {
        expect(decodeTree(encodeTree(entries))).toEqual(entries.toSorted(compareTreeEntries))
      }),
    )
  })

  it('gives a tree the same object id whatever order it is offered in', () => {
    fc.assert(
      fc.property(treeEntries, (entries) => {
        const shuffled = entries.toReversed()
        expect(hashObject('tree', encodeTree(shuffled))).toBe(
          hashObject('tree', encodeTree(entries)),
        )
      }),
    )
  })
})

describe('commit encoding', () => {
  it('round-trips any commit the store can write, as it sanitised it', () => {
    fc.assert(
      fc.property(commit, (original) => {
        expect(decodeCommit(encodeCommit(original))).toEqual({
          ...original,
          author: sanitiseIdentity(original.author),
          committer: sanitiseIdentity(original.committer),
        })
      }),
    )
  })

  it('never lets an identity inject a commit header', () => {
    fc.assert(
      fc.property(commit, (original) => {
        const text = encodeCommit(original).toString('utf8')
        const headers = text.slice(0, text.indexOf('\n\n')).split('\n')
        expect(headers).toHaveLength(original.parents.length + 3)
        expect(headers.filter((line) => line.startsWith('parent '))).toHaveLength(
          original.parents.length,
        )
      }),
    )
  })

  it('leaves an identity that needs no sanitising alone', () => {
    const clean = { name: 'Ada Lovelace', email: 'ada@example.com', when: 1, timezone: '+0000' }
    expect(sanitiseIdentity(clean)).toEqual(clean)
  })
})

describe('trailers', () => {
  it('reads back any folded value it wrote', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]*$/),
        fc.string({ maxLength: 60, unit: 'grapheme' }),
        (key, value) => {
          const message = `Subject\n\n${formatTrailer(key, value)}\n`
          expect(trailerValues(parseTrailers(message), key)).toEqual([foldTrailerValue(value)])
        },
      ),
    )
  })

  it('never leaves a newline in a value', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60, unit: 'grapheme' }), (value) => {
        expect(foldTrailerValue(value)).not.toContain('\n')
      }),
    )
  })
})
