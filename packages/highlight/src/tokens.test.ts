import { describe, expect, it } from 'vitest'

import { TOKEN_CLASSES, resolveTokenClass } from './tokens.ts'

describe('resolveTokenClass', () => {
  it('resolves a single known class to itself', () => {
    expect(resolveTokenClass(['keyword'])).toBe('keyword')
  })

  it('picks the highest-precedence class among several', () => {
    // "number" is declared after "keyword" in TOKEN_CLASSES, so it wins.
    expect(resolveTokenClass(['keyword', 'number'])).toBe('number')
    expect(resolveTokenClass(['number', 'keyword'])).toBe('number')
  })

  it('ignores classes the theme does not know about', () => {
    expect(resolveTokenClass(['doctype', 'keyword'])).toBe('keyword')
  })

  it('returns null when no class is themed', () => {
    expect(resolveTokenClass(['language-javascript'])).toBeNull()
    expect(resolveTokenClass([])).toBeNull()
  })

  it('resolves a raw Prism class through the alias table', () => {
    expect(resolveTokenClass(['doctype'])).toBe('comment')
    expect(resolveTokenClass(['char'])).toBe('string')
    expect(resolveTokenClass(['deleted-sign', 'deleted'])).toBe('deleted')
    expect(resolveTokenClass(['coord'])).toBe('comment')
  })

  it('lets a listed class beat an alias of a lower-precedence one', () => {
    // `atrule` aliases `keyword`, which is listed before `string`.
    expect(resolveTokenClass(['atrule', 'string'])).toBe('string')
    expect(resolveTokenClass(['string', 'atrule'])).toBe('string')
  })

  it('is consistent with TOKEN_CLASSES order for every pair', () => {
    for (const [i, a] of TOKEN_CLASSES.entries()) {
      for (const [j, b] of TOKEN_CLASSES.entries()) {
        const expected = i > j ? a : b
        expect(resolveTokenClass([a, b])).toBe(expected)
      }
    }
  })

  it('memoises repeated lookups', () => {
    const first = resolveTokenClass(['string', 'template-string'])
    const second = resolveTokenClass(['string', 'template-string'])
    expect(first).toBe('template-string')
    expect(second).toBe('template-string')
  })
})
