import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import type { TokenService } from '@quill/application'

/** A raw, single-use token to embed in a link. Never stored directly — see `hashToken`. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** SHA-256 of a raw token, hex-encoded. What gets stored, so a database leak alone can't be replayed. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Whether two digests are the same, in time that does not depend on where
 * they first differ.
 *
 * `timingSafeEqual` refuses buffers of different lengths, which is itself an
 * answer, so a length mismatch is reported before it is asked — two SHA-256
 * digests are always the same length, and anything else is a caller error
 * rather than a secret worth protecting.
 */
export function tokenHashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The `TokenService` port (ADR-011): 256 random bits, stored only as their
 * SHA-256, compared without leaking timing.
 *
 * It wraps the three functions above rather than replacing them, so magic
 * links and share links draw their tokens from exactly one implementation.
 */
export function createTokenService(): TokenService {
  return {
    issue: generateToken,
    hash: hashToken,
    matches: tokenHashesMatch,
  }
}
