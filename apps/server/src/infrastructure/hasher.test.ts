import { describe, expect, it } from 'vitest'

import { createHasher } from './hasher.ts'

describe('createHasher', () => {
  it('is SHA-256 of the UTF-8 bytes, stable across calls', () => {
    const hasher = createHasher()
    expect(hasher.contentHash('# Overview')).toBe(hasher.contentHash('# Overview'))
    expect(hasher.contentHash('# Overview')).toMatch(/^[0-9a-f]{64}$/)
    expect(hasher.contentHash('# Overview')).not.toBe(hasher.contentHash('# Overview '))
    // The known digest of the empty string: the algorithm is part of the cache
    // key's meaning, so a change to it must fail this test rather than quietly
    // orphan every entry.
    expect(hasher.contentHash('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})
