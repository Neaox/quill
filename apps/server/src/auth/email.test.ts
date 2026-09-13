import { describe, expect, it } from 'vitest'

import { normaliseEmail } from './email.ts'

/**
 * Review finding M3. Without this, one mailbox could hold several accounts:
 * the existing-account protection that keeps sign-up from enumerating never
 * fires across casings, and a rate-limit budget multiplies by however many
 * spellings an attacker can think of.
 */
describe('normaliseEmail', () => {
  it('lower-cases and trims', () => {
    expect(normaliseEmail('  Ada@Example.COM \t')).toBe('ada@example.com')
  })

  it('leaves an already-canonical address alone', () => {
    expect(normaliseEmail('ada@example.com')).toBe('ada@example.com')
  })

  it('lower-cases the local part too, which is where the duplicates came from', () => {
    expect(normaliseEmail('A.DA+docs@Example.com')).toBe('a.da+docs@example.com')
  })

  /**
   * Deliberately *not* provider folding: Gmail ignores dots and `+` tags,
   * other providers do not, and applying one provider's rules everywhere
   * would merge addresses that are genuinely different people.
   */
  it('does not fold dots or plus tags', () => {
    expect(normaliseEmail('a.da+docs@example.com')).not.toBe('ada@example.com')
  })
})
