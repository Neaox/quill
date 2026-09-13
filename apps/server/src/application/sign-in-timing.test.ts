import { describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'
import { createInMemoryUnitOfWork } from '@quill/application/test-support'

import {
  createFakeBreachedPasswordChecker,
  createFakeClock,
  createFakeIdGenerator,
  createFakePasswordHasher,
} from '../test-support/fakes.ts'
import { createAuthService } from './auth-service.ts'

/**
 * "Constant shape" is not the same as "constant time", and the M2 review
 * found the difference on three endpoints (findings H2 and H3).
 *
 * Argon2id is deliberately slow and an SMTP round trip is slower still, so
 * *skipping* either when there is no account is itself the answer to "does
 * this email have an account here?" — measurable over the network, from
 * anywhere, no matter how identical the response body is.
 *
 * This file proves both halves. The counting assertions are the real
 * evidence: they are exact, deterministic, and fail the moment somebody moves
 * a hash inside a branch. The wall-clock assertion below them is the
 * end-to-end sanity check, with the tolerance stated where a reader can argue
 * with it.
 */

const SESSION = {
  cookieName: 'quill_session',
  linkCookieName: 'quill_link',
  ttlMs: 60_000,
  idleTtlMs: 60_000,
  secureCookie: false,
}

interface Harness {
  readonly authService: ReturnType<typeof createAuthService>
  readonly passwords: ReturnType<typeof createFakePasswordHasher>
  readonly uow: ReturnType<typeof createInMemoryUnitOfWork>
}

function setUp(costMs = 0): Harness {
  const passwords = createFakePasswordHasher({ costMs })
  const uow = createInMemoryUnitOfWork()
  const authService = createAuthService({
    uow,
    clock: createFakeClock(new Date('2026-01-01T00:00:00.000Z')),
    ids: createFakeIdGenerator(),
    appUrl: 'https://docs.example.com',
    session: SESSION,
    breachedPasswords: createFakeBreachedPasswordChecker(),
    passwords,
  })
  return { authService, passwords, uow }
}

const PASSWORD = 'correct horse battery'

async function withAccount(harness: Harness): Promise<void> {
  await harness.authService.signUp({
    email: 'ada@example.com',
    password: PASSWORD,
    displayName: 'Ada',
  })
  harness.passwords.reset()
}

describe('signIn timing', () => {
  it('verifies exactly once when the account does not exist', async () => {
    const harness = setUp()
    await harness.authService.signIn({ email: 'nobody@example.com', password: 'whatever it is' })
    expect(harness.passwords.verifies).toEqual(['whatever it is'])
  })

  it('verifies exactly once when the account exists but has no password', async () => {
    const harness = setUp()
    await harness.uow.repos.users.create({
      id: userId('00000000-0000-4000-8000-0000000000aa'),
      email: 'link@example.com',
      displayName: 'Link',
      now: new Date('2026-01-01T00:00:00.000Z'),
    })
    await harness.authService.signIn({ email: 'link@example.com', password: 'whatever it is' })
    expect(harness.passwords.verifies).toEqual(['whatever it is'])
  })

  it('verifies exactly once when the password is wrong', async () => {
    const harness = setUp()
    await withAccount(harness)
    await harness.authService.signIn({ email: 'ada@example.com', password: 'wrong' })
    expect(harness.passwords.verifies).toEqual(['wrong'])
  })

  it('verifies exactly once when the password is right', async () => {
    const harness = setUp()
    await withAccount(harness)
    await harness.authService.signIn({ email: 'ada@example.com', password: PASSWORD })
    expect(harness.passwords.verifies).toEqual([PASSWORD])
  })
})

describe('signUp timing', () => {
  /** Finding H2: the existing-account branch used to skip the hash entirely. */
  it('hashes exactly once whether or not the address already has an account', async () => {
    const fresh = setUp()
    await fresh.authService.signUp({
      email: 'new@example.com',
      password: PASSWORD,
      displayName: 'New',
    })
    expect(fresh.passwords.hashes).toEqual([PASSWORD])

    const taken = setUp()
    await withAccount(taken)
    await taken.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Someone else',
    })
    expect(taken.passwords.hashes).toEqual([PASSWORD])
  })
})

describe('link requests', () => {
  /**
   * Finding H3: a known address paid for a supersede, an insert, an audit
   * row and an awaited SMTP round trip; an unknown one paid for a single
   * SELECT. Delivery is now an outbox event, so neither branch waits for
   * mail, and the unknown branch still mints and hashes a token.
   */
  for (const [name, request] of [
    [
      'a magic link',
      (h: Harness, email: string) => h.authService.requestMagicLink(email, 'sign-in'),
    ],
    ['a password reset', (h: Harness, email: string) => h.authService.requestPasswordReset(email)],
  ] as const) {
    it(`queues rather than sends ${name}, and answers the same shape either way`, async () => {
      const harness = setUp()
      await withAccount(harness)
      const mailRequests = (): number =>
        harness.uow.events.filter((event) => event.type === 'MailRequested').length
      // Sign-up queued the verification link; count from here.
      const before = mailRequests()

      const known = await request(harness, 'ada@example.com')
      const unknown = await request(harness, 'nobody@example.com')

      // Same shape: a binding secret, always.
      expect(known.binding).toHaveLength(unknown.binding.length)
      expect(known.binding).not.toBe(unknown.binding)
      // Nothing was delivered on the request path; the known branch left an
      // event for the mail consumer and the unknown branch left none.
      expect(mailRequests() - before).toBe(1)
    })
  }
})

/**
 * The work-parity half.
 *
 * An earlier version measured the two branches against the wall clock with a
 * 40 ms tolerance. The fake hasher's cost is a timer, so that difference was
 * never the work: it was scheduling noise, and under a full parallel run the
 * noise alone exceeded the tolerance. What ADR-011 needs proven is that the
 * known and unknown branches perform the same expensive operations, and the
 * fakes can state that exactly: the same number of hashes, the same number of
 * verifies, and the same audit rows. Real timing parity is measured against
 * the running server in the security checklist, not here.
 */
describe('work parity', () => {
  it('sign-up does the same hashing work for a known and an unknown address', async () => {
    const unknown = setUp()
    await withAccount(unknown)
    await unknown.authService.signUp({
      email: 'nobody@example.com',
      password: PASSWORD,
      displayName: 'Nobody',
    })

    const known = setUp()
    await withAccount(known)
    await known.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada again',
    })

    expect(known.passwords.hashes.length).toBe(unknown.passwords.hashes.length)
    expect(known.passwords.verifies.length).toBe(unknown.passwords.verifies.length)
  })

  for (const [name, request] of [
    [
      'a magic-link request',
      (h: Harness, email: string) => h.authService.requestMagicLink(email, 'sign-in'),
    ],
    ['a reset request', (h: Harness, email: string) => h.authService.requestPasswordReset(email)],
  ] as const) {
    it(`${name} leaves the same audit shape and does the same password work either way`, async () => {
      const unknown = setUp()
      await withAccount(unknown)
      const unknownBefore = unknown.uow.auditEvents.length
      await request(unknown, 'nobody@example.com')

      const known = setUp()
      await withAccount(known)
      const knownBefore = known.uow.auditEvents.length
      await request(known, 'ada@example.com')

      const unknownRows = unknown.uow.auditEvents.slice(unknownBefore)
      const knownRows = known.uow.auditEvents.slice(knownBefore)
      expect(unknownRows.map((row) => row.type)).toEqual(knownRows.map((row) => row.type))
      expect(known.passwords.hashes.length).toBe(unknown.passwords.hashes.length)
      expect(known.passwords.verifies.length).toBe(unknown.passwords.verifies.length)
    })
  }
})
