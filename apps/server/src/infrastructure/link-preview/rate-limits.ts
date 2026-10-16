import type { Clock, LinkPreviewRateLimits } from '@quill/application'

/**
 * Courtesy and protection for link previews (ADR-042): how fast Quill may ask
 * anyone's server for anything.
 *
 * Three ceilings apply to a fetch, and all three must have room:
 * - **per host**, so a page with fifty links to one site does not become fifty
 *   requests to it in a second, whoever pasted them;
 * - **per scope** (an organisation's own, or the shared one), so one
 *   organisation's import cannot use the whole instance's allowance;
 * - **globally**, so the instance as a whole is a polite client.
 * A forced refresh is limited per person on top.
 *
 * A request that finds no room is not failed: the outbox retries it with
 * backoff, which spreads a burst out over time at no cost to the author.
 *
 * Pattern: token bucket. Counters in memory, per process: with several
 * processes the allowance is per process, which errs towards more traffic by
 * the number of processes, and a shared store replaces `BucketSet` when there
 * are many.
 */

export interface BucketConfig {
  /** Requests allowed in a burst, and how many a quiet bucket holds. */
  readonly capacity: number
  readonly refillPerSecond: number
  /** The most distinct keys remembered; the least recently used is forgotten first. */
  readonly maxKeys: number
}

interface Bucket {
  tokens: number
  at: number
}

/** Token buckets by key, bounded in memory however many keys strangers invent. */
export class BucketSet {
  readonly #config: BucketConfig
  readonly #clock: Clock
  readonly #buckets = new Map<string, Bucket>()

  constructor(config: BucketConfig, clock: Clock) {
    this.#config = config
    this.#clock = clock
  }

  #bucketAt(key: string): Bucket {
    const now = this.#clock.now().getTime()
    const existing = this.#buckets.get(key)
    const refilled =
      existing === undefined
        ? this.#config.capacity
        : Math.min(
            this.#config.capacity,
            existing.tokens + ((now - existing.at) / 1000) * this.#config.refillPerSecond,
          )
    const bucket = { tokens: refilled, at: now }
    // Re-inserting keeps the map in order of last use, so the first key is the stalest.
    this.#buckets.delete(key)
    this.#buckets.set(key, bucket)
    if (this.#buckets.size > this.#config.maxKeys) {
      for (const stalest of this.#buckets.keys()) {
        this.#buckets.delete(stalest)
        break
      }
    }
    return bucket
  }

  /**
   * Takes one token if there is one, and answers 0. If there is not, takes
   * nothing and answers how many milliseconds until there will be.
   */
  take(key: string): number {
    const bucket = this.#bucketAt(key)
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return 0
    }
    return Math.ceil(((1 - bucket.tokens) / this.#config.refillPerSecond) * 1000)
  }

  /** Takes as many of `count` tokens as there are, whole ones only, and answers how many. */
  takeUpTo(key: string, count: number): number {
    const bucket = this.#bucketAt(key)
    const taken = Math.min(count, Math.floor(bucket.tokens))
    bucket.tokens -= taken
    return taken
  }

  /** Puts back a token taken for a request that was then refused elsewhere. */
  refund(key: string): void {
    const bucket = this.#bucketAt(key)
    bucket.tokens = Math.min(this.#config.capacity, bucket.tokens + 1)
  }
}

export interface LinkPreviewRateLimitConfig {
  readonly perHost: Omit<BucketConfig, 'maxKeys'>
  readonly perScope: Omit<BucketConfig, 'maxKeys'>
  readonly global: Omit<BucketConfig, 'maxKeys'>
  readonly refreshPerPerson: Omit<BucketConfig, 'maxKeys'>
  /** How often one person may ask about a page of links. */
  readonly readsPerPerson: Omit<BucketConfig, 'maxKeys'>
  /** How many new fetches one person may cause. */
  readonly queuedPerPerson: Omit<BucketConfig, 'maxKeys'>
}

export const DEFAULT_RATE_LIMITS: LinkPreviewRateLimitConfig = {
  perHost: { capacity: 5, refillPerSecond: 0.5 },
  perScope: { capacity: 60, refillPerSecond: 2 },
  global: { capacity: 30, refillPerSecond: 5 },
  // Five forced refreshes in a burst, then one every twelve seconds.
  refreshPerPerson: { capacity: 5, refillPerSecond: 1 / 12 },
  // A page polled every couple of seconds is well under this; a script hammering the endpoint is not.
  readsPerPerson: { capacity: 30, refillPerSecond: 5 },
  // A document of a hundred links is previewed within a minute; a loop inventing addresses is not.
  queuedPerPerson: { capacity: 100, refillPerSecond: 2 },
}

/** Hosts and scopes strangers can invent are bounded; the global bucket has one key. */
const MAX_REMEMBERED_KEYS = 10_000

export function createLinkPreviewRateLimits(
  clock: Clock,
  config: LinkPreviewRateLimitConfig = DEFAULT_RATE_LIMITS,
): LinkPreviewRateLimits {
  const bounded = (limit: Omit<BucketConfig, 'maxKeys'>) =>
    new BucketSet({ ...limit, maxKeys: MAX_REMEMBERED_KEYS }, clock)
  const hosts = bounded(config.perHost)
  const scopes = bounded(config.perScope)
  const everyone = bounded(config.global)
  const refreshes = bounded(config.refreshPerPerson)
  const reads = bounded(config.readsPerPerson)
  const queued = bounded(config.queuedPerPerson)

  return {
    allowFetch({ host, scope }) {
      const waits = [
        { bucket: hosts, key: host, wait: hosts.take(host) },
        { bucket: scopes, key: scope, wait: scopes.take(scope) },
        { bucket: everyone, key: '*', wait: everyone.take('*') },
      ]
      const wait = Math.max(...waits.map((entry) => entry.wait))
      if (wait === 0) return { allowed: true }
      // All three or none: whatever was taken for a fetch that cannot go is given back.
      for (const entry of waits) if (entry.wait === 0) entry.bucket.refund(entry.key)
      return { allowed: false, retryAfterMs: wait }
    },
    allowRefresh(userId) {
      return refreshes.take(userId) === 0
    },
    allowRead(userId) {
      return reads.take(userId) === 0
    },
    allowQueued(userId, count) {
      return queued.takeUpTo(userId, count)
    },
  }
}
