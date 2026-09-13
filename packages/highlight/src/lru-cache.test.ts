import { describe, expect, it } from 'vitest'

import { LruCache } from './lru-cache.ts'

describe('LruCache', () => {
  it('returns undefined for a missing key', () => {
    const cache = new LruCache<string>(100)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('returns the identical value stored, not a copy', () => {
    const cache = new LruCache<{ n: number }>(100)
    const value = { n: 1 }
    cache.set('a', value, 1)
    expect(cache.get('a')).toBe(value)
  })

  it('evicts the least-recently-used entry once weight is exceeded', () => {
    const cache = new LruCache<string>(10)
    cache.set('a', 'A', 4)
    cache.set('b', 'B', 4)
    cache.set('c', 'C', 4) // total would be 12 > 10, evicts "a"
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('B')
    expect(cache.get('c')).toBe('C')
    expect(cache.size).toBe(2)
  })

  it('touching an entry with get protects it from eviction', () => {
    const cache = new LruCache<string>(10)
    cache.set('a', 'A', 4)
    cache.set('b', 'B', 4)
    cache.get('a') // "a" is now most-recently-used
    cache.set('c', 'C', 4) // evicts "b", not "a"
    expect(cache.get('a')).toBe('A')
    expect(cache.get('b')).toBeUndefined()
  })

  it('replacing an existing key updates its weight without double-counting', () => {
    const cache = new LruCache<string>(10)
    cache.set('a', 'A', 8)
    cache.set('a', 'A2', 2)
    cache.set('b', 'B', 2)
    expect(cache.get('a')).toBe('A2')
    expect(cache.get('b')).toBe('B')
    expect(cache.size).toBe(2)
  })

  it('evicts as many entries as needed to fit one large entry', () => {
    const cache = new LruCache<string>(10)
    cache.set('a', 'A', 4)
    cache.set('b', 'B', 4)
    cache.set('c', 'C', 9) // total would be 17 > 10, evicts both "a" and "b"
    expect(cache.size).toBe(1)
    expect(cache.get('c')).toBe('C')
  })

  it('can evict an entry heavier than the whole budget, leaving the cache empty', () => {
    const cache = new LruCache<string>(10)
    cache.set('a', 'A', 4)
    cache.set('b', 'B', 20)
    expect(cache.size).toBe(0)
  })
})
