import { SHORT_ID_ALPHABET, SHORT_ID_LENGTH, shortId } from '@quill/domain'
import type { ShortId } from '@quill/domain'

import type { Clock, Hasher, IdGenerator } from '../ports/system.ts'

/** Time and identity the test controls outright, so nothing here reads a wall clock. */

export interface FakeClock extends Clock {
  advance(milliseconds: number): void
  set(date: Date): void
}

export function createFakeClock(initial: Date): FakeClock {
  let current = initial
  return {
    now: () => current,
    advance(milliseconds: number): void {
      current = new Date(current.getTime() + milliseconds)
    },
    set(date: Date): void {
      current = date
    },
  }
}

/**
 * A hash with the one property the render cache needs — the same input gives
 * the same key and different inputs give different keys — and none of the
 * cost. FNV-1a, so a test never waits on SHA-256 and a key stays short enough
 * to read in a failure message.
 */
export function createFakeHasher(): Hasher {
  return {
    contentHash(text: string): string {
      let hash = 0x81_1c_9d_c5
      for (const code of Array.from(text, (character) => character.charCodeAt(0))) {
        hash = Math.imul(hash ^ code, 0x01_00_01_93) >>> 0
      }
      return hash.toString(16).padStart(8, '0')
    },
  }
}

/**
 * Deterministic ids that still satisfy the domain package's validation: UUIDs
 * of the right shape, and short keys of the right length drawn from the right
 * alphabet (ADR-035). Counting rather than drawing randomly means a test can
 * name the key a document will get.
 */
export function createFakeIdGenerator(prefix = '0000'): IdGenerator {
  let counter = 0
  let keys = 0
  return {
    uuid(): string {
      counter += 1
      return `${prefix}0000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`
    },
    shortId(): string {
      keys += 1
      return countedKey(keys)
    },
  }
}

/** A short key a fixture does not care about, distinct per seed (ADR-035). */
export function aShortId(seed = 1): ShortId {
  return shortId(countedKey(seed))
}

/** The nth key in a predictable sequence: a real key, drawn by counting rather than at random. */
function countedKey(counter: number): string {
  let remaining = counter
  let key = ''
  for (let position = 0; position < SHORT_ID_LENGTH; position++) {
    key = SHORT_ID_ALPHABET.charAt(remaining % SHORT_ID_ALPHABET.length) + key
    remaining = Math.floor(remaining / SHORT_ID_ALPHABET.length)
  }
  return key
}
