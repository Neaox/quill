import { parseDocument } from '@quill/markdown'
import { describe, expect, it } from 'vitest'

import { createKeptByText, createParsedTrees } from './parsed-trees.ts'

describe('values kept by their text', () => {
  it('gives a value back once, by its exact text', () => {
    const kept = createKeptByText<number>(100)
    kept.keep('# A', 1)
    expect(kept.take('# a')).toBeUndefined()
    expect(kept.take('# A')).toBe(1)
    expect(kept.take('# A')).toBeUndefined()
  })

  it('keeps at most its bound of text, dropping the oldest first', () => {
    const kept = createKeptByText<string>(10)
    kept.keep('aaaa', 'a')
    kept.keep('bbbb', 'b')
    // Kept again, so it is the newest and `bbbb` is the oldest.
    kept.keep('aaaa', 'a again')
    kept.keep('cccc', 'c')
    expect(kept.take('bbbb')).toBeUndefined()
    expect(kept.take('aaaa')).toBe('a again')
    expect(kept.take('cccc')).toBe('c')
    // Taking gives the room back.
    kept.keep('dddddddddd', 'd')
    expect(kept.take('dddddddddd')).toBe('d')
  })

  it('does not keep a text longer than its bound, and forgets everything when cleared', () => {
    const kept = createKeptByText<string>(4)
    kept.keep('too long', 'x')
    expect(kept.take('too long')).toBeUndefined()
    kept.keep('abc', 'y')
    kept.clear()
    expect(kept.take('abc')).toBeUndefined()
    kept.keep('abcd', 'z')
    expect(kept.take('abcd')).toBe('z')
  })

  it('keeps parsed trees with the default bound', () => {
    const trees = createParsedTrees()
    const parsed = parseDocument('# Tree\n')
    trees.keep('# Tree\n', parsed)
    expect(trees.take('# Tree\n')).toBe(parsed)
  })
})
