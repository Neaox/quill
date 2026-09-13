import type { KeyProvider, SealedSecret, SecretCipher } from '@quill/application'

import { generateDataKey, openWithKey, sealWithKey } from './aes-gcm.ts'

/**
 * Envelope encryption over a {@link KeyProvider} (ADR-034).
 *
 * Every secret gets a data key of its own, used once and then wrapped by the
 * master key. Two properties follow, and both are why it is done this way
 * rather than encrypting values with the master key directly: rotating the
 * master key re-wraps thirty-two bytes per secret instead of re-encrypting
 * every value, and the master key encrypts only high-entropy key material,
 * never anything an attacker could guess at.
 *
 * Both layers are bound to where they sit. The value is sealed against its
 * secret's name and the wrapped data key against the master key's id
 * (`key-provider.ts`), so neither half of a row can be lifted into another
 * row and used there.
 */

/**
 * The label a value is sealed against. Versioned, because it is authenticated
 * data that older rows carry: changing the shape means adding `v2` beside
 * `v1` and trying both on the way in, never editing this string.
 */
export function valueLabel(name: string): string {
  return `secret:v1:${name}`
}

export function createEnvelopeCipher(keys: KeyProvider): SecretCipher {
  return {
    get currentKeyId() {
      return keys.currentKeyId
    },

    async seal(name: string, value: string): Promise<SealedSecret> {
      const dataKey = generateDataKey()
      return {
        ciphertext: sealWithKey(dataKey, value, valueLabel(name)),
        wrappedKey: await keys.wrap(dataKey),
      }
    },

    async open(name: string, sealed: SealedSecret): Promise<string | null> {
      const dataKey = await keys.unwrap(sealed.wrappedKey)
      return dataKey === null ? null : openWithKey(dataKey, sealed.ciphertext, valueLabel(name))
    },

    async rewrap(sealed: SealedSecret): Promise<SealedSecret | null> {
      const dataKey = await keys.unwrap(sealed.wrappedKey)
      if (dataKey === null) return null
      return { ciphertext: sealed.ciphertext, wrappedKey: await keys.wrap(dataKey) }
    },
  }
}
