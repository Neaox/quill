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
