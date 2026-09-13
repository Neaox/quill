import type { BreachedPasswordChecker, BreachedPasswordResult } from '../auth/breached-password.ts'
import type { AccountExistsEmail, MagicLinkEmail, Mailer } from '../auth/mailer.ts'
import { ARGON2_PARAMETERS, needsRehash } from '../auth/password.ts'
import type { PasswordHasher } from '../auth/password.ts'

/**
 * The clock and id generator are the application layer's own fakes, so the
 * server's unit tests and the use-case tests behave identically. Only the
 * mailer, which is a server-side port, is faked here.
 */
export type { FakeClock } from '@quill/application/test-support'
export { createFakeClock, createFakeIdGenerator } from '@quill/application/test-support'

export interface RecordingMailer extends Mailer {
  readonly sent: MagicLinkEmail[]
  /** "You already have an account" notices, which sign-up sends instead of enumerating. */
  readonly accountExists: AccountExistsEmail[]
}

/** Captures every magic-link email instead of sending it, so a test can pull the token back out. */
export function createRecordingMailer(): RecordingMailer {
  const sent: MagicLinkEmail[] = []
  const accountExists: AccountExistsEmail[] = []
  return {
    sent,
    accountExists,
    async sendMagicLink(email: MagicLinkEmail): Promise<void> {
      sent.push(email)
    },
    async sendAccountExists(email: AccountExistsEmail): Promise<void> {
      accountExists.push(email)
    },
  }
}

export interface FakeBreachedPasswordChecker extends BreachedPasswordChecker {
  /** Every password the checker was asked about, in order. */
  readonly asked: string[]
  /** Adds a password to the in-memory corpus. */
  breach(password: string, count?: number): void
  /** Makes every later check report the corpus as unreachable, so callers fail open. */
  makeUnavailable(reason?: string): void
}

/**
 * The in-memory breached-password corpus (ADR-011) — the fake every test
 * uses, so nothing in the suite reaches the real range API.
 */
export function createFakeBreachedPasswordChecker(
  seed: Iterable<string> = [],
): FakeBreachedPasswordChecker {
  const corpus = new Map<string, number>()
  for (const password of seed) corpus.set(password, 1)
  const asked: string[] = []
  let unavailable: string | null = null

  return {
    asked,
    breach(password: string, count = 1): void {
      corpus.set(password, count)
    },
    makeUnavailable(reason = 'test'): void {
      unavailable = reason
    },
    async check(password: string): Promise<BreachedPasswordResult> {
      asked.push(password)
      if (unavailable !== null) return { status: 'unavailable', reason: unavailable }
      const count = corpus.get(password)
      return count === undefined ? { status: 'ok' } : { status: 'breached', count }
    },
  }
}

export interface FakePasswordHasher extends PasswordHasher {
  /** Every verify this hasher performed, dummy verifies included. */
  readonly verifies: readonly string[]
  /**
   * Every hash it produced. Sign-up has to hash exactly once whether or not
   * the address already has an account, and counting is how that is proved
   * (review finding H2).
   */
  readonly hashes: readonly string[]
  /** Forgets what it has recorded, so a test can set the scene and then measure. */
  reset(): void
  /** Makes the next hash report the parameters of an older release. */
  useWeakParameters(): void
}

/**
 * Argon2id, without Argon2id.
 *
 * The auth service's rules — one verify per sign-in whatever the outcome,
 * re-hash when the stored parameters are below the current ones — are about
 * *when* hashing happens, not about the hash. Testing them against the real
 * function costs about 40 ms a call and says nothing extra; `password.test.ts`
 * is where the real one is exercised. The fake still produces a PHC-shaped
 * string, so `needsRehash` is the production rule, not a stub.
 */
export function createFakePasswordHasher(): FakePasswordHasher {
  const verifies: string[] = []
  const hashes: string[] = []
  let weak = false

  const phc = (plainText: string): string => {
    const { memoryCost, timeCost, parallelism } = weak
      ? { memoryCost: 4096, timeCost: 1, parallelism: 1 }
      : ARGON2_PARAMETERS
    return `$argon2id$v=19$m=${memoryCost},t=${timeCost},p=${parallelism}$c2FsdA$${plainText}`
  }

  return {
    verifies,
    hashes,
    reset(): void {
      verifies.length = 0
      hashes.length = 0
    },
    useWeakParameters(): void {
      weak = true
    },
    async hash(plainText: string): Promise<string> {
      hashes.push(plainText)
      const hashed = phc(plainText)
      weak = false
      return hashed
    },
    async verify(passwordHash: string, plainText: string): Promise<boolean> {
      verifies.push(plainText)
      return passwordHash.endsWith(`$${plainText}`)
    },
    // The real rule: it is pure, and a fake that reimplemented it would be
    // testing the fake rather than the policy.
    needsRehash,
    async verifyDummy(plainText: string): Promise<void> {
      verifies.push(plainText)
    },
  }
}
