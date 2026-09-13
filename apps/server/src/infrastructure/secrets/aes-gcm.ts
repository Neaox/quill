import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM, the one symmetric primitive this product uses (ADR-034).
 *
 * A sealed value is `nonce || tag || ciphertext`, base64. The nonce is twelve
 * random bytes per encryption — never a counter, because a repeated nonce
 * under one key destroys GCM's guarantees outright — and the tag is
 * authenticated, so a modified ciphertext fails to open rather than decrypting
 * to something else.
 *
 * Every seal states **associated data**: a label authenticated with the
 * ciphertext but not carried in it, which the opener has to state again. It is
 * what binds a ciphertext to where it is stored. Without it, a row's bytes are
 * interchangeable with any other row's under the same key, so somebody who can
 * write to the table — but not read the key — can move the SMTP password into
 * the OIDC client secret's row and have the application use it as one. GCM
 * cannot tell those apart; the label can.
 */

const ALGORITHM = 'aes-256-gcm'
export const KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BYTES = 16

export function generateDataKey(): Uint8Array {
  return randomBytes(KEY_BYTES)
}

export class KeyLengthError extends Error {
  constructor(bytes: number) {
    super(`An AES-256 key is ${KEY_BYTES} bytes; this one is ${bytes}`)
    this.name = 'KeyLengthError'
  }
}

export function sealWithKey(key: Uint8Array, plaintext: string, associatedData: string): string {
  if (key.length !== KEY_BYTES) throw new KeyLengthError(key.length)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, nonce)
  cipher.setAAD(Buffer.from(associatedData, 'utf8'))
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64')
}

/**
 * The plaintext, or null when this key and this label do not open it.
 *
 * Null rather than a thrown error because both failures are expected here: a
 * rotation asks every key it has whether it opens a row, and a key that does
 * not is the normal case; and a label that does not match is a row that has
 * been moved, which is a finding to report rather than a fault to crash on.
 */
export function openWithKey(
  key: Uint8Array,
  sealed: string,
  associatedData: string,
): string | null {
  if (key.length !== KEY_BYTES) throw new KeyLengthError(key.length)
  const bytes = Buffer.from(sealed, 'base64')
  if (bytes.length < NONCE_BYTES + TAG_BYTES) return null
  const nonce = bytes.subarray(0, NONCE_BYTES)
  const tag = bytes.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES)
  const body = bytes.subarray(NONCE_BYTES + TAG_BYTES)
  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce)
    decipher.setAAD(Buffer.from(associatedData, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
