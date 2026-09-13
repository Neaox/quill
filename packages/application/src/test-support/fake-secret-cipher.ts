import type { SealedSecret, SecretCipher } from '../ports/secrets.ts'

/**
 * An envelope cipher with the structure and none of the cryptography.
 *
 * The use cases care about three things and none of them is AES: which key a
 * row is wrapped with, whether the key that wrapped it is still available, and
 * that a value never travels anywhere but through `open`. So this fake models
 * exactly that — the real AES-256-GCM envelope, its round trip, and its
 * behaviour under a wrong key are tested where they are implemented, in the
 * server's `envelope-cipher`.
 */

export interface FakeSecretCipher extends SecretCipher {
  /** Start wrapping with a new key, keeping the old one available. */
  rotateTo(keyId: string): void
  /** Lose a key, as an operator who replaced it without rotating would have. */
  forget(keyId: string): void
  /** What has been sealed, so a test can prove a value is not stored as itself. */
  readonly sealed: readonly string[]
}

const scramble = (text: string): string => [...text].toReversed().join('')

export function createFakeSecretCipher(initialKeyId = 'key-1'): FakeSecretCipher {
  const known = new Set([initialKeyId])
  const sealed: string[] = []
  let current = initialKeyId

  return {
    get currentKeyId() {
      return current
    },
    get keyIds() {
      return [...known]
    },
    rotateTo(keyId) {
      known.add(keyId)
      current = keyId
    },
    forget(keyId) {
      known.delete(keyId)
    },
    sealed,

    async seal(name, value) {
      // Reversed, not encrypted, and prefixed with the name it was sealed
      // under: enough for a test to prove that what is stored is neither the
      // value nor something another row could claim, and no more than those
      // two claims deserve.
      const ciphertext = `${name}|${scramble(value)}`
      sealed.push(ciphertext)
      return { ciphertext, wrappedKey: { keyId: current, wrapped: `wrapped:${current}` } }
    },

    async open(name, secret) {
      if (!known.has(secret.wrappedKey.keyId)) return null
      const prefix = `${name}|`
      return secret.ciphertext.startsWith(prefix)
        ? scramble(secret.ciphertext.slice(prefix.length))
        : null
    },

    async rewrap(secret: SealedSecret) {
      return known.has(secret.wrappedKey.keyId)
        ? {
            ciphertext: secret.ciphertext,
            wrappedKey: { keyId: current, wrapped: `wrapped:${current}` },
          }
        : null
    },
  }
}
