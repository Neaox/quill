import { describe, expect, it } from 'vitest'

import {
  GitObjectError,
  hashObject,
  isGitObjectType,
  parseObject,
  serialiseObject,
  toBuffer,
} from './objects.ts'

/** Object ids the real git CLI produces; they are the arbiter of correctness. */
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
const HELLO_BLOB = 'ce013625030ba8dba906f756967f9e9ca394464a'
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

describe('hashObject', () => {
  it('agrees with git on the empty blob', () => {
    expect(hashObject('blob', Buffer.alloc(0))).toBe(EMPTY_BLOB)
  })

  it('agrees with git on a blob with content', () => {
    expect(hashObject('blob', Buffer.from('hello\n', 'utf8'))).toBe(HELLO_BLOB)
  })

  it('agrees with git on the empty tree', () => {
    expect(hashObject('tree', Buffer.alloc(0))).toBe(EMPTY_TREE)
  })
})

describe('serialiseObject', () => {
  it('writes the type, the byte length, and a NUL before the body', () => {
    expect(serialiseObject('blob', Buffer.from('hi'))).toEqual(Buffer.from('blob 2\0hi', 'utf8'))
  })

  it('counts bytes, not characters', () => {
    const body = Buffer.from('é', 'utf8')
    expect(serialiseObject('blob', body).subarray(0, 7).toString()).toBe('blob 2\0')
  })
})

describe('parseObject', () => {
  it('round-trips every object type', () => {
    for (const type of ['blob', 'tree', 'commit', 'tag'] as const) {
      const body = Buffer.from(`body of a ${type}`, 'utf8')
      expect(parseObject(serialiseObject(type, body))).toEqual({ type, body })
    }
  })

  it('accepts a plain Uint8Array from a backend that does not use Buffer', () => {
    const bytes = Uint8Array.from(serialiseObject('blob', Buffer.from('hi')))
    expect(parseObject(bytes).body.toString()).toBe('hi')
  })

  it('rejects bytes with no header terminator', () => {
    expect(() => parseObject(Buffer.from('blob 2'))).toThrow(GitObjectError)
  })

  it('rejects an unknown object type', () => {
    expect(() => parseObject(Buffer.from('widget 2\0hi'))).toThrow(/Unknown object type/)
  })

  it('rejects a header whose length disagrees with the body', () => {
    expect(() => parseObject(Buffer.from('blob 9\0hi'))).toThrow(/does not match/)
  })
})

describe('isGitObjectType', () => {
  it('knows the four git object types', () => {
    expect(isGitObjectType('commit')).toBe(true)
    expect(isGitObjectType('widget')).toBe(false)
  })
})

describe('toBuffer', () => {
  it('adopts a Uint8Array without copying its bytes', () => {
    const source = Uint8Array.of(1, 2, 3)
    expect(toBuffer(source).at(1)).toBe(2)
  })

  it('returns a Buffer unchanged', () => {
    const source = Buffer.from('x')
    expect(toBuffer(source)).toBe(source)
  })
})
