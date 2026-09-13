import { describe, expect, it } from 'vitest'
import type { UnitOfWork } from '@quill/application'
import { userId } from '@quill/domain'
import type { UserId } from '@quill/domain'

import {
  createFakeBreachedPasswordChecker,
  createFakeClock,
  createFakeIdGenerator,
  createFakePasswordHasher,
} from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '@quill/application/test-support'
import { MAIL_REQUESTED, parseMailRequested } from '@quill/application'
import type { MailRequestedPayload } from '@quill/application'

import { hashToken } from '../auth/tokens.ts'
import { createAuthService } from './auth-service.ts'
import type { ConsumeLinkInput } from './auth-service.ts'
import { AUDIT_EVENTS } from './audit.ts'

const SESSION = {
  cookieName: 'quill_session',
  linkCookieName: 'quill_link',
  oidcCookieName: 'quill_oidc',
  ttlMs: 30 * 24 * 60 * 60 * 1000,
  idleTtlMs: 7 * 24 * 60 * 60 * 1000,
  secureCookie: false,
}

const PASSWORD = 'correct horse battery'

interface RecordedAuditEvent {
  readonly type: string
  readonly targetId: string
  readonly metadata: unknown
}

function setUp() {
  const uow = createInMemoryUnitOfWork()
  const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'))
  const ids = createFakeIdGenerator()
  const breachedPasswords = createFakeBreachedPasswordChecker()
  const passwords = createFakePasswordHasher()

  // The in-memory unit of work does not keep audit rows, so the test keeps
  // them: what the service writes is the thing under test here.
  const auditEvents: RecordedAuditEvent[] = []
  const audited: UnitOfWork = {
    ...uow,
    repos: {
      ...uow.repos,
      audit: {
        async write(input): Promise<void> {
          auditEvents.push(input)
        },
      },
    },
  }

  const authService = createAuthService({
    uow: audited,
    clock,
    ids,
    appUrl: 'https://docs.example.com',
    session: SESSION,
    breachedPasswords,
    passwords,
  })
  return { uow, clock, ids, breachedPasswords, passwords, authService, auditEvents }
}

type Harness = ReturnType<typeof setUp>

/**
 * Mail is no longer sent on the request path: it is queued as a
 * `MailRequested` outbox event and delivered by a consumer (ADR-011, review
 * finding H3). These read what a request left behind.
 */
type QueuedMagicLink = Extract<MailRequestedPayload, { kind: 'magic-link' }>

function queuedMail(harness: Harness): readonly MailRequestedPayload[] {
  return harness.uow.events
    .filter((event) => event.type === MAIL_REQUESTED)
    .map((event) => parseMailRequested(event.payload))
    .filter((payload): payload is MailRequestedPayload => payload !== null)
}

function queuedLinks(harness: Harness): readonly QueuedMagicLink[] {
  return queuedMail(harness).filter((mail): mail is QueuedMagicLink => mail.kind === 'magic-link')
}

/**
 * The token out of the most recent queued link.
 *
 * It arrives in the URL *fragment* rather than the query string (ADR-011,
 * review finding M2): a query string reaches the server's access log, the
 * browser's history and the `Referer` of everything the landing page loads,
 * where a fragment reaches none of them.
 */
function latestToken(harness: Harness, index = queuedLinks(harness).length - 1): string {
  const url = queuedLinks(harness)[index]?.url ?? ''
  return new URLSearchParams(new URL(url).hash.slice(1)).get('token') ?? ''
}

/** A link as the browser that asked for it would present it. */
function presented(token: string, binding: string): ConsumeLinkInput {
  return { token, binding, confirm: false }
}

async function userIdFor(harness: Harness, email: string): Promise<UserId> {
  const user = await harness.uow.repos.users.findByEmail(email)
  if (user === null) throw new Error(`expected a user for ${email}`)
  return user.id
}

describe('signUp', () => {
  it('creates a user, a credential, and a verification link', async () => {
    const harness = setUp()
    const result = await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    if (!result.ok) throw new Error('expected sign-up to succeed')
    expect(result.binding).not.toHaveLength(0)

    const id = await userIdFor(harness, 'ada@example.com')
    expect(await harness.uow.repos.credentials.findByUserId(id)).not.toBeNull()
    expect(queuedLinks(harness).map((mail) => mail.purpose)).toEqual(['email-verification'])
  })

  /**
   * Review finding 4: sign-up used to answer `409 email_taken`, which is an
   * account-existence oracle anyone can query.
   */
  it('answers identically for an existing email, and tells its owner by mail', async () => {
    const harness = setUp()
    const first = await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    const second = await harness.authService.signUp({
      email: 'ada@example.com',
      password: 'a completely different one',
      displayName: 'Not Ada',
    })

    // The same shape, down to the binding that only one branch can use.
    expect(Object.keys(second)).toEqual(Object.keys(first))
    expect(second.ok).toBe(first.ok)
    expect(queuedMail(harness).filter((mail) => mail.kind === 'account-exists')).toEqual([
      {
        version: 1,
        kind: 'account-exists',
        to: 'ada@example.com',
        signInUrl: 'https://docs.example.com/auth/sign-in',
      },
    ])
    // The second attempt changed nothing about the account.
    expect((await harness.uow.repos.users.findByEmail('ada@example.com'))?.displayName).toBe('Ada')
  })

  it('refuses a password the breach corpus knows, without saying anything about the account', async () => {
    const harness = setUp()
    harness.breachedPasswords.breach('hunter2hunter2', 51_234)
    const result = await harness.authService.signUp({
      email: 'ada@example.com',
      password: 'hunter2hunter2',
      displayName: 'Ada',
    })
    expect(result).toEqual({ ok: false, reason: 'breached_password' })
    expect(await harness.uow.repos.users.findByEmail('ada@example.com')).toBeNull()
  })

  it('fails open when the corpus is unreachable', async () => {
    const harness = setUp()
    harness.breachedPasswords.makeUnavailable('network_error')
    const result = await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    expect(result.ok).toBe(true)
    expect(await harness.uow.repos.users.findByEmail('ada@example.com')).not.toBeNull()
  })
})

describe('signIn', () => {
  it('issues a session, and the token is not what is stored', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    const result = await harness.authService.signIn({
      email: 'ada@example.com',
      password: PASSWORD,
    })
    if (!result.ok) throw new Error('expected sign-in to succeed')

    expect(result.session.expiresAt).toEqual(
      new Date(harness.clock.now().getTime() + SESSION.ttlMs),
    )
    const row = await harness.uow.repos.sessions.findById(result.session.sessionId)
    expect(row?.tokenHash).not.toBe(result.session.token)
    expect(result.session.token.length).toBeGreaterThanOrEqual(43)
  })

  it('rotates: every sign-in issues a new session rather than reusing one', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    const first = await harness.authService.signIn({ email: 'ada@example.com', password: PASSWORD })
    const second = await harness.authService.signIn({
      email: 'ada@example.com',
      password: PASSWORD,
    })
    if (!first.ok || !second.ok) throw new Error('expected both sign-ins to succeed')
    expect(second.session.sessionId).not.toBe(first.session.sessionId)
    expect(second.session.token).not.toBe(first.session.token)
  })

  it('rejects an unknown email', async () => {
    const { authService } = setUp()
    expect(await authService.signIn({ email: 'nobody@example.com', password: 'x' })).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    })
  })

  it('rejects a user with no password credential (a federated or passkey-only account)', async () => {
    const harness = setUp()
    await harness.uow.repos.users.create({
      id: userId('00000000-0000-4000-8000-0000000000b1'),
      email: 'ada@example.com',
      displayName: 'Ada',
      now: harness.clock.now(),
    })
    expect(
      await harness.authService.signIn({ email: 'ada@example.com', password: 'anything' }),
    ).toEqual({ ok: false, reason: 'invalid_credentials' })
  })

  /** Review finding M3: one mailbox is one account, whatever the caller typed. */
  it('finds the account however the address is cased or padded', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'Ada@Example.com ',
      password: PASSWORD,
      displayName: 'Ada',
    })
    expect((await harness.uow.repos.users.findByEmail('ada@example.com'))?.email).toBe(
      'ada@example.com',
    )
    expect(
      (await harness.authService.signIn({ email: ' ADA@example.COM', password: PASSWORD })).ok,
    ).toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const { authService } = setUp()
    await authService.signUp({ email: 'ada@example.com', password: PASSWORD, displayName: 'Ada' })
    expect(await authService.signIn({ email: 'ada@example.com', password: 'wrong' })).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    })
  })

  /** Review finding 13: raising the parameters must migrate existing hashes. */
  it('re-hashes a credential stored below the current parameters', async () => {
    const harness = setUp()
    harness.passwords.useWeakParameters()
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    const id = await userIdFor(harness, 'ada@example.com')
    expect((await harness.uow.repos.credentials.findByUserId(id))?.passwordHash).toMatch(
      /\$m=4096,t=1,p=1\$/,
    )

    expect(
      (await harness.authService.signIn({ email: 'ada@example.com', password: PASSWORD })).ok,
    ).toBe(true)

    expect((await harness.uow.repos.credentials.findByUserId(id))?.passwordHash).toMatch(
      /\$m=19456,t=2,p=1\$/,
    )
    expect(harness.auditEvents.map((event) => event.type)).toContain(AUDIT_EVENTS.passwordRehashed)
  })

  it('leaves a credential at the current parameters alone', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    const id = await userIdFor(harness, 'ada@example.com')
    const before = (await harness.uow.repos.credentials.findByUserId(id))?.passwordHash

    await harness.authService.signIn({ email: 'ada@example.com', password: PASSWORD })
    expect((await harness.uow.repos.credentials.findByUserId(id))?.passwordHash).toBe(before)
    expect(harness.auditEvents.map((event) => event.type)).not.toContain(
      AUDIT_EVENTS.passwordRehashed,
    )
  })
})

describe('sessions', () => {
  async function signedIn(harness: Harness) {
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    const result = await harness.authService.signIn({
      email: 'ada@example.com',
      password: PASSWORD,
    })
    if (!result.ok) throw new Error('expected sign-in to succeed')
    return result.session
  }

  it('signs out one session', async () => {
    const harness = setUp()
    const session = await signedIn(harness)
    await harness.authService.signOut(session.sessionId, session.userId)
    expect(await harness.uow.repos.sessions.findById(session.sessionId)).toBeNull()
  })

  it('lists the caller’s own sessions', async () => {
    const harness = setUp()
    const first = await signedIn(harness)
    await harness.authService.signIn({ email: 'ada@example.com', password: PASSWORD })
    const list = await harness.authService.listSessions(first.userId)
    expect(list).toHaveLength(2)
  })

  it('revokes one session, and refuses to revoke another user’s', async () => {
    const harness = setUp()
    const session = await signedIn(harness)
    await harness.authService.signUp({
      email: 'bob@example.com',
      password: PASSWORD,
      displayName: 'Bob',
    })
    const bob = await userIdFor(harness, 'bob@example.com')

    expect(await harness.authService.revokeSession(bob, session.sessionId)).toBe(false)
    expect(await harness.uow.repos.sessions.findById(session.sessionId)).not.toBeNull()

    expect(await harness.authService.revokeSession(session.userId, session.sessionId)).toBe(true)
    expect(await harness.uow.repos.sessions.findById(session.sessionId)).toBeNull()

    expect(await harness.authService.revokeSession(session.userId, 'nope')).toBe(false)
  })

  it('signs out everywhere', async () => {
    const harness = setUp()
    const session = await signedIn(harness)
    await harness.authService.signIn({ email: 'ada@example.com', password: PASSWORD })

    await harness.authService.signOutEverywhere(session.userId)
    expect(await harness.authService.listSessions(session.userId)).toEqual([])
  })
})

describe('changePassword', () => {
  async function signedIn(harness: Harness) {
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    const result = await harness.authService.signIn({
      email: 'ada@example.com',
      password: PASSWORD,
    })
    if (!result.ok) throw new Error('expected sign-in to succeed')
    return result.session
  }

  it('rotates this session and drops every other one', async () => {
    const harness = setUp()
    const other = await signedIn(harness)
    const current = await harness.authService.signIn({
      email: 'ada@example.com',
      password: PASSWORD,
    })
    if (!current.ok) throw new Error('expected sign-in to succeed')

    const result = await harness.authService.changePassword({
      user: current.session.userId,
      sessionId: current.session.sessionId,
      currentPassword: PASSWORD,
      newPassword: 'a brand new passphrase',
    })
    if (!result.ok) throw new Error('expected the change to succeed')

    expect(result.session.sessionId).not.toBe(current.session.sessionId)
    expect(await harness.uow.repos.sessions.findById(other.sessionId)).toBeNull()
    expect(await harness.uow.repos.sessions.findById(current.session.sessionId)).toBeNull()
    expect(
      (await harness.authService.signIn({ email: 'ada@example.com', password: PASSWORD })).ok,
    ).toBe(false)
  })

  it('requires the current password', async () => {
    const harness = setUp()
    const session = await signedIn(harness)
    expect(
      await harness.authService.changePassword({
        user: session.userId,
        sessionId: session.sessionId,
        currentPassword: 'not it',
        newPassword: 'a brand new passphrase',
      }),
    ).toEqual({ ok: false, reason: 'invalid_credentials' })
  })

  it('pays for a verify even when the account has no credential at all', async () => {
    const harness = setUp()
    const id = userId('00000000-0000-4000-8000-0000000000b2')
    await harness.uow.repos.users.create({
      id,
      email: 'link@example.com',
      displayName: 'Link',
      now: harness.clock.now(),
    })
    expect(
      await harness.authService.changePassword({
        user: id,
        sessionId: 'whatever',
        currentPassword: 'anything',
        newPassword: 'a brand new passphrase',
      }),
    ).toEqual({ ok: false, reason: 'invalid_credentials' })
  })

  it('refuses a breached new password', async () => {
    const harness = setUp()
    const session = await signedIn(harness)
    harness.breachedPasswords.breach('password1234')
    expect(
      await harness.authService.changePassword({
        user: session.userId,
        sessionId: session.sessionId,
        currentPassword: PASSWORD,
        newPassword: 'password1234',
      }),
    ).toEqual({ ok: false, reason: 'breached_password' })
  })
})

describe('setInstanceAdmin', () => {
  it('rotates the affected user’s sessions', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    const signIn = await harness.authService.signIn({
      email: 'ada@example.com',
      password: PASSWORD,
    })
    if (!signIn.ok) throw new Error('expected sign-in to succeed')

    await harness.authService.setInstanceAdmin({
      actor: null,
      target: signIn.session.userId,
      isInstanceAdmin: true,
    })

    expect(await harness.uow.repos.sessions.findById(signIn.session.sessionId)).toBeNull()
    expect((await harness.uow.repos.users.findById(signIn.session.userId))?.isInstanceAdmin).toBe(
      true,
    )
  })
})

describe('requestMagicLink', () => {
  async function existingUser(harness: Harness, email: string): Promise<void> {
    await harness.authService.signUp({ email, password: PASSWORD, displayName: 'Someone' })
  }

  it('queues a link for an existing user, carrying the token in the fragment', async () => {
    const harness = setUp()
    await existingUser(harness, 'ada@example.com')
    await harness.authService.requestMagicLink('ada@example.com', 'email-verification')

    const latest = queuedLinks(harness).at(-1)
    expect(latest?.purpose).toBe('email-verification')
    expect(latest?.url).toContain('https://docs.example.com/auth/verify-email#token=')
    expect(latest?.url).not.toContain('?token=')
  })

  /**
   * Review finding M7: an unknown address asking for a sign-in link used to
   * get a brand-new unverified account, which made a public endpoint an
   * account factory and a way to squat somebody else's address.
   */
  it('creates no account for an unknown address, and queues nothing', async () => {
    const harness = setUp()
    const result = await harness.authService.requestMagicLink('new@example.com', 'sign-in')

    expect(result.binding).not.toHaveLength(0)
    expect(queuedLinks(harness)).toHaveLength(0)
    expect(await harness.uow.repos.users.findByEmail('new@example.com')).toBeNull()
  })

  /**
   * The unknown branch still writes an audit row of the same shape, so the
   * two branches differ by a database insert rather than by a token, a hash
   * and an SMTP round trip (finding H3).
   */
  it('audits an unknown address the same way it audits a known one', async () => {
    const harness = setUp()
    await harness.authService.requestMagicLink('nobody@example.com', 'sign-in')

    const issued = harness.auditEvents.filter(
      (event) => event.type === AUDIT_EVENTS.magicLinkIssued,
    )
    expect(issued).toHaveLength(1)
    expect(issued[0]?.metadata).toEqual({ purpose: 'sign-in', superseded: 0, issued: false })
  })

  /** Review finding 11: a newer link must retire the older ones. */
  it('supersedes an outstanding link of the same purpose', async () => {
    const harness = setUp()
    await existingUser(harness, 'new@example.com')
    const one = await harness.authService.requestMagicLink('new@example.com', 'sign-in')
    const first = latestToken(harness)
    const two = await harness.authService.requestMagicLink('new@example.com', 'sign-in')
    const second = latestToken(harness)

    expect(await harness.authService.consumeSignInLink(presented(first, one.binding))).toEqual({
      ok: false,
      reason: 'invalid_or_expired',
    })
    expect((await harness.authService.consumeSignInLink(presented(second, two.binding))).ok).toBe(
      true,
    )
  })

  it('leaves a link of a different purpose alone', async () => {
    const harness = setUp()
    await existingUser(harness, 'new@example.com')
    const signIn = await harness.authService.requestMagicLink('new@example.com', 'sign-in')
    const signInToken = latestToken(harness)
    await harness.authService.requestPasswordReset('new@example.com')

    expect(
      (await harness.authService.consumeSignInLink(presented(signInToken, signIn.binding))).ok,
    ).toBe(true)
  })
})

/**
 * Review finding M2: a link that anybody can spend is a link a mail scanner,
 * a link-preview bot or a corporate security appliance spends for you. A
 * link is bound to the browser that asked for it, and the person who really
 * clicked confirms explicitly when they arrive somewhere else.
 */
describe('binding a link to the browser that asked for it', () => {
  async function issued(harness: Harness): Promise<{ token: string; binding: string }> {
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    const { binding } = await harness.authService.requestMagicLink('ada@example.com', 'sign-in')
    return { token: latestToken(harness), binding }
  }

  it('accepts the link in the browser that asked for it', async () => {
    const harness = setUp()
    const { token, binding } = await issued(harness)
    expect((await harness.authService.consumeSignInLink(presented(token, binding))).ok).toBe(true)
  })

  it('asks for confirmation when the binding is missing or wrong', async () => {
    const harness = setUp()
    const { token, binding } = await issued(harness)

    expect(
      await harness.authService.consumeSignInLink({ token, binding: null, confirm: false }),
    ).toEqual({ ok: false, reason: 'confirmation_required' })
    expect(
      await harness.authService.consumeSignInLink({
        token,
        binding: `${binding}-not-really`,
        confirm: false,
      }),
    ).toEqual({ ok: false, reason: 'confirmation_required' })
    // And the token is still live: being asked to confirm must not cost the
    // person their link.
    expect((await harness.authService.consumeSignInLink(presented(token, binding))).ok).toBe(true)
  })

  it('accepts an explicit confirmation in place of the binding', async () => {
    const harness = setUp()
    const { token } = await issued(harness)
    expect(
      (await harness.authService.consumeSignInLink({ token, binding: null, confirm: true })).ok,
    ).toBe(true)
  })

  it('accepts a token issued before the binding column existed', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    const id = await userIdFor(harness, 'ada@example.com')
    // Expand-only migrations (ADR-033): a row written by the previous release
    // carries no binding, and refusing it would sign people out on upgrade.
    await harness.uow.repos.magicLinks.create({
      id: 'legacy-token',
      userId: id,
      tokenHash: hashToken('legacy'),
      purpose: 'sign-in',
      now: harness.clock.now(),
      expiresAt: new Date(harness.clock.now().getTime() + 60_000),
    })
    expect(
      (
        await harness.authService.consumeSignInLink({
          token: 'legacy',
          binding: null,
          confirm: false,
        })
      ).ok,
    ).toBe(true)
  })
})

describe('consumeSignInLink', () => {
  async function issued(harness: Harness, email = 'new@example.com') {
    await harness.authService.signUp({ email, password: PASSWORD, displayName: 'Someone' })
    const { binding } = await harness.authService.requestMagicLink(email, 'sign-in')
    return presented(latestToken(harness), binding)
  }

  it('signs in and marks the email verified on first use', async () => {
    const harness = setUp()
    const link = await issued(harness)
    const result = await harness.authService.consumeSignInLink(link)
    if (!result.ok) throw new Error('expected consumeSignInLink to succeed')
    const user = await harness.uow.repos.users.findById(result.session.userId)
    expect(user?.emailVerifiedAt).not.toBeNull()
  })

  it('does not re-touch an already-verified email', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    const id = await userIdFor(harness, 'ada@example.com')
    await harness.uow.repos.users.markEmailVerified(id, new Date('2025-01-01T00:00:00.000Z'))

    const { binding } = await harness.authService.requestMagicLink('ada@example.com', 'sign-in')
    await harness.authService.consumeSignInLink(presented(latestToken(harness), binding))

    expect((await harness.uow.repos.users.findById(id))?.emailVerifiedAt).toEqual(
      new Date('2025-01-01T00:00:00.000Z'),
    )
  })

  it('rejects an unknown token', async () => {
    const { authService } = setUp()
    expect(await authService.consumeSignInLink(presented('nope', 'anything'))).toEqual({
      ok: false,
      reason: 'invalid_or_expired',
    })
  })

  it('rejects an expired token', async () => {
    const harness = setUp()
    const link = await issued(harness)
    harness.clock.advance(16 * 60 * 1000)
    expect(await harness.authService.consumeSignInLink(link)).toEqual({
      ok: false,
      reason: 'invalid_or_expired',
    })
  })

  it('rejects a token issued for a different purpose', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'new@example.com',
      password: PASSWORD,
      displayName: 'Someone',
    })
    const { binding } = await harness.authService.requestPasswordReset('new@example.com')
    expect(
      await harness.authService.consumeSignInLink(presented(latestToken(harness), binding)),
    ).toEqual({ ok: false, reason: 'wrong_purpose' })
  })

  it('rejects a token already consumed', async () => {
    const harness = setUp()
    const link = await issued(harness)
    await harness.authService.consumeSignInLink(link)
    expect(await harness.authService.consumeSignInLink(link)).toEqual({
      ok: false,
      reason: 'invalid_or_expired',
    })
  })

  it('rejects a second concurrent redemption of the same token (single-use under a race)', async () => {
    const harness = setUp()
    const link = await issued(harness)

    const [first, second] = await Promise.all([
      harness.authService.consumeSignInLink(link),
      harness.authService.consumeSignInLink(link),
    ])
    expect([first.ok, second.ok].toSorted()).toEqual([false, true])
  })
})

describe('verifyEmail', () => {
  it('marks the user verified', async () => {
    const harness = setUp()
    const signUp = await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    if (!signUp.ok) throw new Error('expected sign-up to succeed')
    const id = await userIdFor(harness, 'ada@example.com')

    expect(
      await harness.authService.verifyEmail(presented(latestToken(harness), signUp.binding)),
    ).toEqual({ ok: true })
    expect((await harness.uow.repos.users.findById(id))?.emailVerifiedAt).not.toBeNull()
  })

  it('rejects an unknown, wrong-purpose, or expired token', async () => {
    const harness = setUp()
    expect(await harness.authService.verifyEmail(presented('nope', 'anything'))).toEqual({
      ok: false,
      reason: 'invalid_or_expired',
    })

    await harness.authService.signUp({
      email: 'new@example.com',
      password: PASSWORD,
      displayName: 'Someone',
    })
    const signIn = await harness.authService.requestMagicLink('new@example.com', 'sign-in')
    expect(
      await harness.authService.verifyEmail(presented(latestToken(harness), signIn.binding)),
    ).toEqual({ ok: false, reason: 'wrong_purpose' })

    const verification = await harness.authService.requestMagicLink(
      'new@example.com',
      'email-verification',
    )
    const verifyToken = latestToken(harness)
    harness.clock.advance(16 * 60 * 1000)
    expect(
      await harness.authService.verifyEmail(presented(verifyToken, verification.binding)),
    ).toEqual({ ok: false, reason: 'invalid_or_expired' })
  })

  it('rejects a second concurrent redemption of the same token', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'new@example.com',
      password: PASSWORD,
      displayName: 'Someone',
    })
    const { binding } = await harness.authService.requestMagicLink(
      'new@example.com',
      'email-verification',
    )
    const link = presented(latestToken(harness), binding)

    const [first, second] = await Promise.all([
      harness.authService.verifyEmail(link),
      harness.authService.verifyEmail(link),
    ])
    expect([first.ok, second.ok].toSorted()).toEqual([false, true])
  })
})

describe('requestPasswordReset and resetPassword', () => {
  it('queues nothing for an unknown email', async () => {
    const harness = setUp()
    const result = await harness.authService.requestPasswordReset('nobody@example.com')
    expect(result.binding).not.toHaveLength(0)
    expect(queuedLinks(harness)).toHaveLength(0)
  })

  it('lets a user set a new password, and rotates every session', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: 'old passphrase here',
      displayName: 'Ada',
    })
    const signIn = await harness.authService.signIn({
      email: 'ada@example.com',
      password: 'old passphrase here',
    })
    if (!signIn.ok) throw new Error('expected sign-in to succeed')

    const { binding } = await harness.authService.requestPasswordReset('ada@example.com')
    expect(
      await harness.authService.resetPassword({
        ...presented(latestToken(harness), binding),
        newPassword: 'new passphrase here',
      }),
    ).toEqual({ ok: true })

    expect(await harness.uow.repos.sessions.findById(signIn.session.sessionId)).toBeNull()
    expect(
      (
        await harness.authService.signIn({
          email: 'ada@example.com',
          password: 'old passphrase here',
        })
      ).ok,
    ).toBe(false)
    expect(
      (
        await harness.authService.signIn({
          email: 'ada@example.com',
          password: 'new passphrase here',
        })
      ).ok,
    ).toBe(true)
  })

  it('refuses a breached new password, and leaves the token unconsumed', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    const { binding } = await harness.authService.requestPasswordReset('ada@example.com')
    const link = presented(latestToken(harness), binding)
    harness.breachedPasswords.breach('letmein12345')

    expect(
      await harness.authService.resetPassword({ ...link, newPassword: 'letmein12345' }),
    ).toEqual({ ok: false, reason: 'breached_password' })
    // The link still works, so a bad choice does not cost the user their reset.
    expect(
      await harness.authService.resetPassword({ ...link, newPassword: 'a fine new passphrase' }),
    ).toEqual({ ok: true })
  })

  /**
   * Review finding M8: the reset endpoint reached a network call and an
   * Argon2id hash before it had established that the token was real.
   */
  it('refuses an unresolvable token before it does any expensive work', async () => {
    const harness = setUp()
    expect(
      await harness.authService.resetPassword({
        token: 'nope',
        binding: null,
        confirm: false,
        newPassword: 'a fine new passphrase',
      }),
    ).toEqual({ ok: false, reason: 'invalid_or_expired' })
    // No breach lookup, no hash: the corpus was never asked.
    expect(harness.breachedPasswords.asked).toEqual([])
    expect(harness.passwords.hashes).toEqual([])
  })

  it('rejects a wrong-purpose or expired token', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'new@example.com',
      password: PASSWORD,
      displayName: 'Someone',
    })
    const signIn = await harness.authService.requestMagicLink('new@example.com', 'sign-in')
    expect(
      await harness.authService.resetPassword({
        ...presented(latestToken(harness), signIn.binding),
        newPassword: 'a fine new passphrase',
      }),
    ).toEqual({ ok: false, reason: 'wrong_purpose' })

    const reset = await harness.authService.requestPasswordReset('new@example.com')
    const resetToken = latestToken(harness)
    harness.clock.advance(16 * 60 * 1000)
    expect(
      await harness.authService.resetPassword({
        ...presented(resetToken, reset.binding),
        newPassword: 'a fine new passphrase',
      }),
    ).toEqual({ ok: false, reason: 'invalid_or_expired' })
  })

  it('rejects a second concurrent redemption of the same token', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'new@example.com',
      password: PASSWORD,
      displayName: 'Someone',
    })
    const { binding } = await harness.authService.requestPasswordReset('new@example.com')
    const link = presented(latestToken(harness), binding)

    const [first, second] = await Promise.all([
      harness.authService.resetPassword({ ...link, newPassword: 'a fine new passphrase' }),
      harness.authService.resetPassword({ ...link, newPassword: 'another fine passphrase' }),
    ])
    expect([first.ok, second.ok].toSorted()).toEqual([false, true])
  })
})

describe('audit', () => {
  it('records the outcome of every authentication, with no secret in any row', async () => {
    const harness = setUp()
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    await harness.authService.signIn({ email: 'ada@example.com', password: 'wrong' })
    const signIn = await harness.authService.signIn({
      email: 'ada@example.com',
      password: PASSWORD,
    })
    if (!signIn.ok) throw new Error('expected sign-in to succeed')
    await harness.authService.signOut(signIn.session.sessionId, signIn.session.userId)

    const written = harness.auditEvents
    expect(written.map((event) => event.type)).toEqual([
      AUDIT_EVENTS.signUp,
      AUDIT_EVENTS.magicLinkIssued,
      AUDIT_EVENTS.signInFailed,
      AUDIT_EVENTS.signInSucceeded,
      AUDIT_EVENTS.signOut,
    ])

    const serialised = JSON.stringify(written)
    expect(serialised).not.toContain(PASSWORD)
    expect(serialised).not.toContain(signIn.session.token)
    expect(serialised).not.toContain(latestToken(harness))
  })

  it('records a breach-check outage, so a silently absent check is visible', async () => {
    const harness = setUp()
    harness.breachedPasswords.makeUnavailable('status_503')
    await harness.authService.signUp({
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    })
    expect(harness.auditEvents.map((event) => event.type)).toContain(
      AUDIT_EVENTS.breachCheckUnavailable,
    )
  })
})
