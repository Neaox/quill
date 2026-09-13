import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { generateSessionToken, hashSessionToken, hashesMatch } from './session-token.ts'

describe('generateSessionToken', () => {
  it('is 256 bits of randomness, base64url encoded', () => {
    const token = generateSessionToken()
    // 32 bytes base64url-encode to 43 characters with no padding.
    expect(token).toHaveLength(43)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  })

  it('never repeats itself', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateSessionToken))
    expect(tokens.size).toBe(500)
  })
})

describe('hashSessionToken', () => {
  it('is the SHA-256 of the token, so the stored value is not the token', () => {
    const token = generateSessionToken()
    const hash = hashSessionToken(token)
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(hash).not.toBe(token)
    expect(hash).toHaveLength(64)
  })
})

describe('hashesMatch', () => {
  it('accepts equal digests and rejects different ones', () => {
    const token = generateSessionToken()
    expect(hashesMatch(hashSessionToken(token), hashSessionToken(token))).toBe(true)
    expect(hashesMatch(hashSessionToken(token), hashSessionToken('other'))).toBe(false)
  })

  it('rejects digests of different lengths without throwing', () => {
    // `timingSafeEqual` throws on a length mismatch, so the length check has
    // to come first — otherwise a malformed cookie is a 500, not a refusal.
    expect(hashesMatch('abcd', 'ab')).toBe(false)
  })
})
