import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * The secret behind a session cookie (ADR-011).
 *
 * The cookie carries a 256-bit random token; the `sessions` row stores only
 * its SHA-256, so a database read — a backup, a replica, an over-broad
 * support query — never yields a usable cookie. The row keeps its own opaque
 * `id`, which is what `document_locks.holder_session_id` and the session
 * management routes refer to, so nothing outside this module ever handles
 * the raw token.
 */

const SESSION_TOKEN_BYTES = 32

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url')
}

/** SHA-256 of a raw session token, hex-encoded: what is stored and what lookups key on. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Compares two hex digests without leaking where they first differ.
 *
 * The lookup itself is an indexed equality on the hash, which is already
 * safe; this guards the confirmation step, so the comparison a reviewer
 * looks for is present and constant-time rather than implied.
 */
export function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
