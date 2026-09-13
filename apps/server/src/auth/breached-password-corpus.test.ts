import { describe, expect, it } from 'vitest'

import { createDisabledBreachedPasswordChecker, withLocalFallback } from './breached-password.ts'
import type { BreachedPasswordChecker } from './breached-password.ts'
import { isLocallyKnownBreached, localBreachedPasswords } from './breached-password-corpus.ts'
import { PASSWORD_MIN_LENGTH } from './password.ts'

/**
 * Review finding M10. ADR-011 asks for "a local fallback list when that
 * service is unreachable", and there was none: an outage meant no check at
 * all, silently, for as long as it lasted.
 */

describe('the local corpus', () => {
  it('knows the passwords everybody guesses first', () => {
    for (const guess of ['password1234', 'qwerty123456', 'letmein12345', 'iloveyou2024']) {
      expect(isLocallyKnownBreached(guess)).toBe(true)
    }
  })

  it('matches case-insensitively, because a list does not care about shift', () => {
    expect(isLocallyKnownBreached('Password1234')).toBe(true)
    expect(isLocallyKnownBreached('PASSWORD1234')).toBe(true)
  })

  it('does not know a genuine passphrase', () => {
    expect(isLocallyKnownBreached('gravel thimble orbit cardigan')).toBe(false)
  })

  /**
   * The point of the suffix expansion: a top-N list is mostly short words,
   * and this platform's floor is twelve characters, so the entries that
   * matter are the ones people build *to reach* twelve.
   */
  it('carries enough entries at or above the length floor to be worth consulting', () => {
    const usable = [...localBreachedPasswords()].filter(
      (entry) => entry.length >= PASSWORD_MIN_LENGTH,
    )
    expect(usable.length).toBeGreaterThan(1_000)
  })

  it('builds the set once', () => {
    expect(localBreachedPasswords()).toBe(localBreachedPasswords())
  })
})

/** A checker that always answers the same way, with the bundled list behind it. */
function remote(
  result: Awaited<ReturnType<BreachedPasswordChecker['check']>>,
): BreachedPasswordChecker {
  return withLocalFallback({
    async check() {
      return result
    },
  })
}

describe('withLocalFallback', () => {
  it('leaves a remote verdict alone, either way', async () => {
    expect(await remote({ status: 'ok' }).check('password1234')).toEqual({ status: 'ok' })
    expect(await remote({ status: 'breached', count: 9 }).check('anything')).toEqual({
      status: 'breached',
      count: 9,
    })
  })

  it('consults the local list when the remote verdict is missing', async () => {
    expect(
      await remote({ status: 'unavailable', reason: 'network_error' }).check('password1234'),
    ).toEqual({ status: 'breached', count: 0 })
  })

  /**
   * A local miss stays `unavailable` rather than becoming `ok`: a few
   * thousand entries against five hundred million is a floor, and the audit
   * event that makes the gap visible has to keep firing.
   */
  it('reports the outage when the local list cannot refuse the password either', async () => {
    expect(
      await remote({ status: 'unavailable', reason: 'status_503' }).check('gravel thimble orbit'),
    ).toEqual({ status: 'unavailable', reason: 'status_503' })
  })

  it('gives an air-gapped instance a real check rather than none', async () => {
    const airGapped = withLocalFallback(createDisabledBreachedPasswordChecker())
    expect(await airGapped.check('password1234')).toEqual({ status: 'breached', count: 0 })
    expect(await airGapped.check('gravel thimble orbit')).toEqual({
      status: 'unavailable',
      reason: 'disabled',
    })
  })
})
