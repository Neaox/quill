import { randomBytes } from 'node:crypto'

import { createPasswordSchemeRegistry } from './password-scheme.ts'
import type { PasswordSchemeRegistry } from './password-scheme.ts'
import { ARGON2ID_SCHEME_ID, argon2idScheme } from './password-schemes/argon2id.ts'

/**
 * Password hashing for the auth flows (ADR-011, NIST 800-63B).
 *
 * The algorithm itself lives in `password-schemes/`, behind the registry in
 * `password-scheme.ts`: this module is the composition of those schemes and
 * the small policy around them. What was a single hard-wired algorithm is now
 * a set keyed by the PHC identifier the stored hash already carries, so the
 * day Argon2id is superseded is a new file and a moved `current`, not a
 * migration nobody can run.
 */

export { ARGON2_PARAMETERS, readArgon2Parameters } from './password-schemes/argon2id.ts'
export type { EncodedArgon2Parameters } from './password-schemes/argon2id.ts'

/**
 * Every scheme this build can verify, and which one writes new hashes.
 *
 * Retiring one is an operational step with a cost — see the doc comment on
 * `password-scheme.ts`, which is where it is written down.
 */
export const PASSWORD_SCHEMES: PasswordSchemeRegistry = createPasswordSchemeRegistry(
  [argon2idScheme],
  ARGON2ID_SCHEME_ID,
)

/**
 * NIST 800-63B: length is the only rule. The maximum exists because a hash
 * function hashes whatever it is handed, and an unbounded password is a
 * CPU-exhaustion vector, not because long passphrases are undesirable.
 */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

/**
 * True when a stored hash should be replaced the next time the plaintext is
 * in hand.
 *
 * Three reasons, in order of seriousness: nothing registered recognises the
 * hash (a retired scheme, or a corrupt column — re-hash, and until then the
 * owner cannot sign in); a scheme that is no longer current wrote it; or the
 * current scheme judges its own parameters to have been raised since.
 */
export function needsRehash(
  passwordHash: string,
  registry: PasswordSchemeRegistry = PASSWORD_SCHEMES,
): boolean {
  const scheme = registry.schemeFor(passwordHash)
  if (scheme === null) return true
  if (scheme.id !== registry.current.id) return true
  return scheme.isWeaker(passwordHash)
}

/**
 * Everything the auth flows do with a password, as one injected dependency.
 *
 * `verifyDummy` is why this is an object rather than four free functions:
 * sign-in has to pay for exactly one verify whether or not the account
 * exists, or its latency answers "does this email exist" (ADR-011, review
 * finding 5). That needs a hash of a value nobody holds, and building one is
 * expensive — so it is built once, at composition time, rather than lazily on
 * whichever unlucky request arrives first and pays double.
 */
export interface PasswordHasher {
  hash(plainText: string): Promise<string>
  verify(passwordHash: string, plainText: string): Promise<boolean>
  /** Whether a stored hash is below the scheme or parameters in force. */
  needsRehash(passwordHash: string): boolean
  /**
   * One real verify against a hash of a random value nobody holds, so a
   * missing account costs the same as a wrong password.
   */
  verifyDummy(plainText: string): Promise<void>
}

export async function createPasswordHasher(
  registry: PasswordSchemeRegistry = PASSWORD_SCHEMES,
): Promise<PasswordHasher> {
  // From the current scheme, so the dummy verify costs what a real one costs.
  const dummyHash = await registry.current.hash(randomBytes(32).toString('base64url'))

  async function verify(passwordHash: string, plainText: string): Promise<boolean> {
    const scheme = registry.schemeFor(passwordHash)
    // Fails closed: a hash written by a scheme this build no longer carries
    // is not "probably fine", it is unverifiable, and the holder resets.
    if (scheme === null) return false
    return scheme.verify(passwordHash, plainText)
  }

  return {
    hash: (plainText) => registry.current.hash(plainText),
    verify,
    needsRehash: (passwordHash) => needsRehash(passwordHash, registry),
    async verifyDummy(plainText: string): Promise<void> {
      await verify(dummyHash, plainText)
    },
  }
}
