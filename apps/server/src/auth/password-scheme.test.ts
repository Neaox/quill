import { describe, expect, it } from 'vitest'

import { createPasswordSchemeRegistry } from './password-scheme.ts'
import type { PasswordScheme } from './password-scheme.ts'

/**
 * The registry exists so the day Argon2id is superseded is a new file and a
 * moved `current`, rather than a migration nobody can run: the plaintext only
 * exists during a sign-in, so every stored hash has to keep verifying while
 * new ones are written by the new scheme.
 */

function scheme(id: string, weaker = false): PasswordScheme {
  return {
    id,
    async hash(plainText: string): Promise<string> {
      return `${id}${plainText}`
    },
    async verify(passwordHash: string, plainText: string): Promise<boolean> {
      return passwordHash === `${id}${plainText}`
    },
    isWeaker(): boolean {
      return weaker
    },
  }
}

const CURRENT = scheme('$current$')
const RETIRED = scheme('$legacy$')

describe('createPasswordSchemeRegistry', () => {
  it('dispatches on the identifier the stored hash carries', () => {
    const registry = createPasswordSchemeRegistry([CURRENT, RETIRED], '$current$')
    expect(registry.schemeFor('$legacy$secret')).toBe(RETIRED)
    expect(registry.schemeFor('$current$secret')).toBe(CURRENT)
    expect(registry.current).toBe(CURRENT)
  })

  it('answers null for a hash nothing registered recognises', () => {
    const registry = createPasswordSchemeRegistry([CURRENT], '$current$')
    // A hash from a scheme that has been retired, or a column that holds
    // something that is not a hash at all.
    expect(registry.schemeFor('$legacy$secret')).toBeNull()
    expect(registry.schemeFor('')).toBeNull()
  })

  it('refuses a current scheme that is not registered', () => {
    expect(() => createPasswordSchemeRegistry([CURRENT], '$missing$')).toThrow(
      /"\$missing\$" is not registered/,
    )
  })

  it('refuses two schemes claiming the same identifier', () => {
    // Dispatch is by prefix, so a duplicate identifier means a stored hash
    // could be verified by either of two implementations.
    expect(() => createPasswordSchemeRegistry([CURRENT, scheme('$current$')], '$current$')).toThrow(
      /same PHC identifier/,
    )
  })
})
