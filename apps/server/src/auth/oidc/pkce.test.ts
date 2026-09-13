import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { CODE_CHALLENGE_METHOD, codeChallenge, createCodeVerifier } from './pkce.ts'

describe('PKCE', () => {
  it('mints a verifier of 43 unreserved characters, which is the specification’s minimum', () => {
    expect(createCodeVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('never mints the same verifier twice', () => {
    const drawn = new Set(Array.from({ length: 50 }, () => createCodeVerifier()))
    expect(drawn.size).toBe(50)
  })

  it('challenges with the base64url SHA-256 of the verifier', () => {
    const verifier = createCodeVerifier()
    expect(codeChallenge(verifier)).toBe(
      createHash('sha256').update(verifier, 'ascii').digest('base64url'),
    )
  })

  it('is S256 and never plain: a challenge that is the verifier proves nothing', () => {
    expect(CODE_CHALLENGE_METHOD).toBe('S256')
    const verifier = createCodeVerifier()
    expect(codeChallenge(verifier)).not.toBe(verifier)
  })
})
