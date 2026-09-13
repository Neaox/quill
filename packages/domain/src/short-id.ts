/**
 * The short, stable, public handle every document carries beside its UUID
 * (ADR-035).
 *
 * Ten characters of Crockford base-32 — lower-case, without `i`, `l`, `o`, or
 * `u`, so nothing in a key can be misread or misheard — encoding fifty random
 * bits. The sizing is the whole reason the key is ten characters rather than
 * eight: at forty bits a million documents make a collision near-certain and
 * regeneration becomes routine, where at fifty bits the odds of any collision
 * at all among a million documents are about one in two thousand, and the key
 * still fits in a chat message or a spoken sentence.
 *
 * This module is pure arithmetic over bytes: where the bytes come from is the
 * `IdGenerator` port's business, and what a key means is the repository's.
 */

/** Crockford base-32: the digits, then the letters, less `i`, `l`, `o`, and `u`. */
export const SHORT_ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

export const SHORT_ID_LENGTH = 10

const BITS_PER_CHARACTER = 5
const CHARACTER_MASK = 31

/** How many random bytes one key needs: fifty bits, rounded up. */
export const SHORT_ID_BYTES = Math.ceil((SHORT_ID_LENGTH * BITS_PER_CHARACTER) / 8)

/**
 * A key from random bytes, five bits at a time, most significant bit first.
 *
 * Each group of five bits indexes the alphabet directly, so every key the
 * generator can produce is equally likely — an encoding that folded bytes
 * with a modulus would quietly favour the first few letters.
 */
export function shortIdFrom(bytes: Uint8Array): string {
  if (bytes.length < SHORT_ID_BYTES) {
    throw new TypeError(
      `Invalid short id source: expected at least ${SHORT_ID_BYTES} bytes, received ${bytes.length}`,
    )
  }

  let characters = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= BITS_PER_CHARACTER && characters.length < SHORT_ID_LENGTH) {
      bits -= BITS_PER_CHARACTER
      characters += SHORT_ID_ALPHABET.charAt((buffer >>> bits) & CHARACTER_MASK)
    }
    if (characters.length === SHORT_ID_LENGTH) break
  }
  return characters
}

const CONFUSABLE_ONES = /[il]/g
const CONFUSABLE_ZEROS = /o/g

/**
 * The canonical form of a key somebody presented, or null when it is not a
 * key at all.
 *
 * Crockford's alphabet leaves out the confusable letters so that a key read
 * off a screen and typed back in survives the trip: a decoder therefore
 * accepts what the alphabet excluded and maps it back — `i` and `l` to `1`,
 * `o` to `0` — and is indifferent to case. `u` is excluded rather than
 * confusable, so a key containing one is simply not a key.
 */
export function canonicalShortId(value: string): string | null {
  if (value.length !== SHORT_ID_LENGTH) return null
  const canonical = value
    .toLowerCase()
    .replaceAll(CONFUSABLE_ONES, '1')
    .replaceAll(CONFUSABLE_ZEROS, '0')
  return [...canonical].every((character) => SHORT_ID_ALPHABET.includes(character))
    ? canonical
    : null
}
