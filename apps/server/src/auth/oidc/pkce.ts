import { createHash, randomBytes } from 'node:crypto'

/**
 * Proof Key for Code Exchange, S256 only (RFC 7636; ADR-011 allows
 * "Authorization Code with PKCE only").
 *
 * The verifier is 32 bytes of `crypto.randomBytes` rendered as base64url,
 * which is 43 characters — the specification's minimum, and every character
 * is already in its unreserved alphabet, so nothing has to be escaped.
 *
 * `plain` is not implemented and never will be: a challenge that *is* the
 * verifier proves nothing to an attacker who saw the authorisation request.
 */

/** 43 characters of base64url: 256 bits, the specification's minimum length. */
export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

export const CODE_CHALLENGE_METHOD = 'S256'
