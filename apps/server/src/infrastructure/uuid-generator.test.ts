import { describe, expect, it } from 'vitest'
import { canonicalShortId, isShortId, isUuid } from '@quill/domain'

import { createUuidGenerator } from './uuid-generator.ts'

describe('createUuidGenerator', () => {
  it('generates distinct, valid UUIDs', () => {
    const ids = createUuidGenerator()
    const a = ids.uuid()
    const b = ids.uuid()
    expect(a).not.toBe(b)
    expect(isUuid(a)).toBe(true)
    expect(isUuid(b)).toBe(true)
  })

  it('generates distinct, canonical short keys', () => {
    const ids = createUuidGenerator()
    const keys = Array.from({ length: 32 }, () => ids.shortId())
    for (const key of keys) {
      expect(isShortId(key)).toBe(true)
      // Drawn, not normalised: a generated key is already its canonical form.
      expect(canonicalShortId(key)).toBe(key)
    }
    expect(new Set(keys).size).toBe(keys.length)
  })
})
