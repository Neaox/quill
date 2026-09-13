import { describe, expect, it } from 'vitest'

import { createTokenService, generateToken, hashToken, tokenHashesMatch } from './tokens.ts'

describe('tokens', () => {
  it('generates distinct, URL-safe tokens', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThan(30)
  })

  it('hashes deterministically', () => {
    const token = generateToken()
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('hashes distinct tokens to distinct hashes', () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()))
  })

  it('never stores the raw token as its own hash', () => {
    const token = generateToken()
    const hash = hashToken(token)
    expect(hash).not.toBe(token)
    // A database leak yields the digest and nothing replayable: the token is
    // nowhere inside it (ADR-011).
    expect(hash).not.toContain(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('compares digests for equality, and refuses ones of different lengths', () => {
    const hash = hashToken(generateToken())
    expect(tokenHashesMatch(hash, hash)).toBe(true)
    expect(tokenHashesMatch(hash, hashToken(generateToken()))).toBe(false)
    expect(tokenHashesMatch(hash, `${hash}0`)).toBe(false)
  })
})

describe('createTokenService', () => {
  it('is the same three functions behind the port', () => {
    const tokens = createTokenService()
    const token = tokens.issue()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(tokens.hash(token)).toBe(hashToken(token))
    expect(tokens.matches(tokens.hash(token), hashToken(token))).toBe(true)
    expect(tokens.matches(tokens.hash(token), hashToken(tokens.issue()))).toBe(false)
  })
})
