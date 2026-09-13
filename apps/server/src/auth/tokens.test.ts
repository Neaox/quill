import { describe, expect, it } from 'vitest'

import { generateToken, hashToken } from './tokens.ts'

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
    expect(hashToken(token)).not.toBe(token)
  })
})
