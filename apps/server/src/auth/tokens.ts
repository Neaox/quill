import { createHash, randomBytes } from 'node:crypto'

/** A raw, single-use token to embed in a link. Never stored directly — see `hashToken`. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** SHA-256 of a raw token, hex-encoded. What gets stored, so a database leak alone can't be replayed. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
