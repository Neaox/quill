import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Argon2 from '@node-rs/argon2'

/**
 * The real Argon2id, exercised once. Everything else in the suite uses the
 * fake hasher in `test-support/fakes.ts`, because the *rules* (one verify per
 * sign-in, re-hash when parameters are raised) are about when hashing happens,
 * not about the hash.
 *
 * `verify` is a pass-through spy so the last test can see what `verifyDummy`
 * actually handed the library, without changing what it does.
 */
const verifySpy = vi.fn<(passwordHash: string, plainText: string) => void>()

vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof Argon2>()
  return {
    ...actual,
    verify: (...args: Parameters<typeof actual.verify>) => {
      verifySpy(args[0] as string, args[1] as string)
      return actual.verify(...args)
    },
  }
})

import { createPasswordSchemeRegistry } from './password-scheme.ts'
import type { PasswordScheme } from './password-scheme.ts'

const {
  ARGON2_PARAMETERS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  createPasswordHasher,
  needsRehash,
  readArgon2Parameters,
} = await import('./password.ts')

const PASSWORD = 'correct horse battery staple'
const PHC_ARGON2ID = /^\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$/

beforeEach(() => {
  verifySpy.mockClear()
})

describe('the password hasher', () => {
  it('produces an argon2id hash distinct from the plaintext', async () => {
    const passwords = await createPasswordHasher()
    const hash = await passwords.hash(PASSWORD)
    expect(hash).not.toBe(PASSWORD)
    expect(hash).toMatch(/^\$argon2id\$/)
  })

  /**
   * Review finding 13: the parameters used to be the library's defaults, so
   * a dependency bump could have dropped the instance below the OWASP floor
   * with nothing to notice. This reads them back out of the hash itself.
   */
  it('encodes the OWASP-minimum parameters in the hash it writes', async () => {
    const passwords = await createPasswordHasher()
    const encoded = readArgon2Parameters(await passwords.hash(PASSWORD))
    expect(encoded).toEqual({ memoryCost: 19_456, timeCost: 2, parallelism: 1 })
    expect(encoded).toEqual({ ...ARGON2_PARAMETERS })
    expect(ARGON2_PARAMETERS.memoryCost).toBeGreaterThanOrEqual(19 * 1024)
    expect(ARGON2_PARAMETERS.timeCost).toBeGreaterThanOrEqual(2)
    expect(ARGON2_PARAMETERS.parallelism).toBeGreaterThanOrEqual(1)
  })

  it('verifies a correct password and rejects an incorrect one', async () => {
    const passwords = await createPasswordHasher()
    const hash = await passwords.hash(PASSWORD)
    expect(await passwords.verify(hash, PASSWORD)).toBe(true)
    expect(await passwords.verify(hash, 'wrong password')).toBe(false)
  })

  it('treats an unparseable stored hash as a failed verification, not an error', async () => {
    const passwords = await createPasswordHasher()
    // Nothing registered claims this prefix, so it never reaches a scheme.
    expect(await passwords.verify('not a hash at all', PASSWORD)).toBe(false)
    // And one that *does* claim the prefix but is malformed inside reaches
    // Argon2id and comes back false rather than throwing a 500 at a caller
    // who must not be able to tell the two apart anyway.
    expect(await passwords.verify('$argon2id$v=19$m=19456,t=2,p=1$not-base64$nope', PASSWORD)).toBe(
      false,
    )
  })

  /**
   * The registry's failure mode, stated (see `password-scheme.ts`): a hash
   * written by a scheme this build no longer carries is unverifiable, not
   * "probably fine". Its holder resets rather than signing in.
   */
  it('fails closed on a hash from a scheme that is no longer registered', async () => {
    const passwords = await createPasswordHasher()
    expect(await passwords.verify('$scrypt$ln=16,r=8,p=1$abc$def', PASSWORD)).toBe(false)
    expect(passwords.needsRehash('$scrypt$ln=16,r=8,p=1$abc$def')).toBe(true)
  })

  it('accepts any Unicode, up to the documented maximum', async () => {
    const passwords = await createPasswordHasher()
    const passphrase = '🐈‍⬛ ταὐτὰ πάσχειν 日本語 — a very long one'
    expect(await passwords.verify(await passwords.hash(passphrase), passphrase)).toBe(true)
    expect(PASSWORD_MIN_LENGTH).toBe(12)
    expect(PASSWORD_MAX_LENGTH).toBe(128)
  })

  /**
   * Review finding 5: sign-in used to skip Argon2id entirely when there was
   * no account, which is a latency oracle for "does this email exist". The
   * dummy hash is built when the hasher is, so no request pays to create it,
   * and `verifyDummy` really does run the same work a real verify does.
   */
  describe('verifyDummy', () => {
    it('runs a genuine verify against a real argon2id hash', async () => {
      const passwords = await createPasswordHasher()
      verifySpy.mockClear()

      await passwords.verifyDummy('whatever was submitted')

      expect(verifySpy).toHaveBeenCalledTimes(1)
      const [passwordHash, plainText] = verifySpy.mock.calls[0] as [string, string]
      expect(passwordHash).toMatch(PHC_ARGON2ID)
      expect(readArgon2Parameters(passwordHash)).toEqual({ ...ARGON2_PARAMETERS })
      expect(plainText).toBe('whatever was submitted')
    })

    it('costs one verify every time, not one on the first call', async () => {
      const passwords = await createPasswordHasher()
      verifySpy.mockClear()

      await passwords.verifyDummy('first')
      await passwords.verifyDummy('second')

      expect(verifySpy).toHaveBeenCalledTimes(2)
      // The same hash both times: it was built once, when the hasher was.
      const [first, second] = verifySpy.mock.calls as [[string, string], [string, string]]
      expect(second[0]).toBe(first[0])
    })

    it('gives two hashers different dummy hashes', async () => {
      const [a, b] = await Promise.all([createPasswordHasher(), createPasswordHasher()])
      verifySpy.mockClear()
      await a.verifyDummy('x')
      await b.verifyDummy('x')
      const [first, second] = verifySpy.mock.calls as [[string, string], [string, string]]
      expect(second[0]).not.toBe(first[0])
    })
  })
})

describe('readArgon2Parameters', () => {
  it('returns null for anything that is not an argon2id PHC string', () => {
    expect(readArgon2Parameters('')).toBeNull()
    expect(readArgon2Parameters('$argon2i$v=19$m=19456,t=2,p=1$abc$def')).toBeNull()
    expect(readArgon2Parameters('$2b$12$saltsaltsaltsaltsaltsa')).toBeNull()
  })
})

describe('needsRehash', () => {
  it('is false for a hash at the current parameters', async () => {
    const passwords = await createPasswordHasher()
    expect(passwords.needsRehash(await passwords.hash(PASSWORD))).toBe(false)
  })

  it('is true for a hash below any one of them', () => {
    expect(needsRehash('$argon2id$v=19$m=4096,t=2,p=1$abc$def')).toBe(true)
    expect(needsRehash('$argon2id$v=19$m=19456,t=1,p=1$abc$def')).toBe(true)
    expect(needsRehash('$argon2id$v=19$m=19456,t=2,p=0$abc$def')).toBe(true)
  })

  it('is true for a hash this build cannot read at all', () => {
    expect(needsRehash('$2b$12$something')).toBe(true)
    // Argon2id's own prefix, but nothing this build can parse after it: the
    // scheme owns it and says it is not at the parameters in force.
    expect(needsRehash('$argon2id$something-else-entirely')).toBe(true)
  })

  it('is false for a hash above them, which is someone raising the floor', () => {
    expect(needsRehash('$argon2id$v=19$m=65536,t=4,p=2$abc$def')).toBe(false)
  })

  /**
   * The registry's other reason to re-hash: the algorithm itself moved on.
   * A hash a *registered but no longer current* scheme wrote still verifies,
   * and is replaced the next time the plaintext is in hand.
   */
  it('is true for a hash a registered scheme wrote that is no longer current', () => {
    const superseded: PasswordScheme = {
      id: '$argon2id$',
      hash: async (plainText) => `$argon2id$${plainText}`,
      verify: async () => true,
      isWeaker: () => false,
    }
    const next: PasswordScheme = {
      id: '$balloon$',
      hash: async (plainText) => `$balloon$${plainText}`,
      verify: async () => true,
      isWeaker: () => false,
    }
    const registry = createPasswordSchemeRegistry([superseded, next], '$balloon$')

    expect(needsRehash('$argon2id$v=19$m=19456,t=2,p=1$abc$def', registry)).toBe(true)
    expect(needsRehash('$balloon$whatever', registry)).toBe(false)
  })
})
