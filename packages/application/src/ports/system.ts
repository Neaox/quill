/**
 * Time, identity, and hashing are injected so use cases and their tests never
 * call `Date.now()`, `crypto.randomUUID()`, or `node:crypto` directly
 * (ADR-021 requires an injectable clock for the locking rules, and the
 * application layer imports no Node built-ins).
 */
export interface Clock {
  now(): Date
}

export interface IdGenerator {
  uuid(): string
  /**
   * A document's short public handle (ADR-035): ten Crockford base-32
   * characters from fifty random bits. It is a port rather than a pure
   * function because it draws randomness, which is exactly what a test has
   * to be able to control — including making two draws collide.
   */
  shortId(): string
}

/**
 * Content addressing for the render cache (ADR-031).
 *
 * The cache key is a hash of everything the rendered body is a function of,
 * so the algorithm has to be stable across releases and across server
 * instances sharing one `render_cache` table: the server's adapter is
 * SHA-256. Bumping it is bumping `RENDER_VERSION`.
 */
export interface Hasher {
  /** Lower-case hex digest of the UTF-8 bytes of `text`. */
  contentHash(text: string): string
}

/**
 * Capability tokens: share links today, and anything else ADR-011 asks to be
 * random, stored hashed, and compared without leaking timing.
 *
 * It is a port for the same reason `IdGenerator` is: the randomness is the
 * part a test has to be able to fix, and the application layer imports no
 * Node built-ins. The server's adapter is `crypto.randomBytes`, SHA-256, and
 * `crypto.timingSafeEqual`.
 */
export interface TokenService {
  /** A fresh 256-bit token, URL-safe, to be shown to its creator once. */
  issue(): string

  /** Lower-case hex SHA-256 of a raw token. The only form that is ever stored. */
  hash(token: string): string

  /**
   * Whether two digests are equal, in time that does not depend on where they
   * first differ. Digests, never raw tokens: by the time anything is compared
   * the secret has already been hashed.
   */
  matches(left: string, right: string): boolean
}

/**
 * Message authentication for signed push webhooks (ADR-061, "Freshness"): a
 * forge signs the raw body of each delivery with the source's shared secret.
 * A port for the reason the others are: the application layer imports no
 * Node built-ins. The server's adapter is `crypto.createHmac`. Comparing what
 * it answers with what the forge sent is `TokenService.matches`, which does
 * not leak where they differ.
 */
export interface MessageAuthenticator {
  /** Lower-case hex HMAC-SHA-256 of `message` under the UTF-8 bytes of `key`. */
  hmacSha256(key: string, message: Uint8Array): string
}
