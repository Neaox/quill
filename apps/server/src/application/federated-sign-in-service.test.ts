import { beforeEach, describe, expect, it } from 'vitest'
import { createInMemoryUnitOfWork } from '@quill/application/test-support'
import type { InMemoryUnitOfWork } from '@quill/application/test-support'
import type { FederatedIdentity, SessionId } from '@quill/application'
import { userId } from '@quill/domain'

import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import type { FakeClock } from '../test-support/fakes.ts'
import { createFederatedSignInService } from './federated-sign-in-service.ts'

/**
 * The linking, provisioning and session rules, without HTTP or a provider
 * (ADR-011: "Identity, not email, is the key").
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const ISSUER = 'https://sso.example.com'

const CONFIG = {
  cookieName: 'quill_session',
  linkCookieName: 'quill_link',
  oidcCookieName: 'quill_oidc',
  ttlMs: 600_000,
  idleTtlMs: 300_000,
  secureCookie: false,
}

function identity(overrides: Partial<FederatedIdentity> = {}): FederatedIdentity {
  return {
    issuer: ISSUER,
    subject: 'subject-1',
    email: 'ada@example.com',
    emailVerified: true,
    displayName: 'Ada Lovelace',
    groups: [],
    claims: {},
    ...overrides,
  }
}

let uow: InMemoryUnitOfWork
let clock: FakeClock
let service: ReturnType<typeof createFederatedSignInService>

function signIn(
  overrides: {
    readonly identity?: FederatedIdentity
    readonly allowSignUp?: boolean
    readonly allowLinking?: boolean
    readonly previousSessionId?: SessionId | null
  } = {},
) {
  return service.signIn({
    identity: overrides.identity ?? identity(),
    providerId: 'entra',
    allowSignUp: overrides.allowSignUp ?? true,
    allowLinking: overrides.allowLinking ?? true,
    previousSessionId: overrides.previousSessionId ?? null,
  })
}

/** The reasons the audit trail recorded, in order. */
function auditedReasons(): unknown[] {
  return uow.auditEvents
    .filter((row) => row.type === 'auth.sso.failed')
    .map((row) => (row.metadata as { reason?: unknown }).reason)
}

beforeEach(() => {
  uow = createInMemoryUnitOfWork()
  clock = createFakeClock(NOW)
  service = createFederatedSignInService({
    uow,
    clock,
    ids: createFakeIdGenerator(),
    session: CONFIG,
  })
})

describe('a person the platform has never seen', () => {
  it('is provisioned, verified, and signed in', async () => {
    const result = await signIn()

    expect(result).toMatchObject({ ok: true, outcome: 'provisioned' })
    const user = await uow.repos.users.findByEmail('ada@example.com')
    expect(user).toMatchObject({ displayName: 'Ada Lovelace', emailVerifiedAt: NOW })
  })

  it('takes the local part of the address when the provider offers no name', async () => {
    await signIn({ identity: identity({ displayName: null }) })

    expect(await uow.repos.users.findByEmail('ada@example.com')).toMatchObject({
      displayName: 'ada',
    })
  })

  it('ignores a name that is only whitespace', async () => {
    await signIn({ identity: identity({ displayName: '   ' }) })

    expect(await uow.repos.users.findByEmail('ada@example.com')).toMatchObject({
      displayName: 'ada',
    })
  })

  it('falls back to the whole address when there is no local part to take', async () => {
    await signIn({ identity: identity({ displayName: null, email: '@example.com' }) })

    expect(await uow.repos.users.findByEmail('@example.com')).toMatchObject({
      displayName: '@example.com',
    })
  })

  it('normalises the address, so one mailbox stays one account', async () => {
    await signIn({ identity: identity({ email: '  Ada@Example.COM ' }) })

    expect(await uow.repos.users.findByEmail('ada@example.com')).not.toBeNull()
  })

  it('is refused, and given no account, when the instance does not allow SSO sign-up', async () => {
    const result = await signIn({ allowSignUp: false })

    expect(result).toEqual({ ok: false, reason: 'sign_up_not_allowed' })
    expect(await uow.repos.users.findByEmail('ada@example.com')).toBeNull()
  })

  it.each([
    ['the provider does not vouch for the address', identity({ emailVerified: false })],
    ['the provider asserts no address at all', identity({ email: null })],
  ])('is refused when %s', async (_name, given) => {
    expect(await signIn({ identity: given })).toEqual({ ok: false, reason: 'email_not_verified' })
    expect(await uow.repos.identities.findBySubject(ISSUER, 'subject-1')).toBeNull()
  })
})

describe('an account that already exists here', () => {
  const ada = userId('00000000-0000-4000-8000-000000000001')
  const VERIFIED_AT = new Date(NOW.getTime() - 86_400_000)

  beforeEach(async () => {
    await uow.repos.users.create({
      id: ada,
      email: 'ada@example.com',
      displayName: 'Ada',
      now: NOW,
    })
  })

  /** The account has proved the address itself, which is what makes a link safe. */
  async function verifyLocally(): Promise<void> {
    await uow.repos.users.markEmailVerified(ada, VERIFIED_AT)
  }

  it('is linked when it has verified the address itself', async () => {
    await verifyLocally()

    const result = await signIn()

    expect(result).toMatchObject({ ok: true, outcome: 'linked', user: ada })
    expect(await uow.repos.identities.findBySubject(ISSUER, 'subject-1')).toMatchObject({
      userId: ada,
      providerId: 'entra',
    })
  })

  it('keeps the moment it really proved the address, rather than re-stamping it', async () => {
    await verifyLocally()

    await signIn()

    expect(await uow.repos.users.findById(ada)).toMatchObject({ emailVerifiedAt: VERIFIED_AT })
  })

  it('is linked even when the instance forbids SSO sign-up: nothing is being created', async () => {
    await verifyLocally()

    expect(await signIn({ allowSignUp: false })).toMatchObject({ ok: true, outcome: 'linked' })
  })

  /**
   * The pre-registration attack. Anybody can sign up as `ada@example.com`,
   * never open the mail, and wait: if a federated sign-in linked into that
   * account, the real Ada's first "Continue with Microsoft" would hand her
   * the squatter's account — and the squatter keeps their password.
   */
  it('is refused, never linked, when it has never proved the address', async () => {
    const result = await signIn()

    expect(result).toEqual({ ok: false, reason: 'unverified_local_account' })
    expect(await uow.repos.identities.findBySubject(ISSUER, 'subject-1')).toBeNull()
    expect(await uow.repos.identities.listForUser(ada)).toEqual([])
    expect(auditedReasons()).toEqual(['unverified_local_account'])
  })

  it('is refused, and no second account made, when the address is unverified here', async () => {
    await signIn()

    // The refusal must not become a provisioning: that would put two accounts
    // on one mailbox, which the unique index on `lower(email)` forbids anyway.
    const users = [
      await uow.repos.users.findByEmail('ada@example.com'),
      await uow.repos.identities.findBySubject(ISSUER, 'subject-1'),
    ]
    expect(users[0]?.id).toBe(ada)
    expect(users[1]).toBeNull()
  })

  it('is refused when this provider may not link at all', async () => {
    await verifyLocally()

    const result = await signIn({ allowLinking: false })

    expect(result).toEqual({ ok: false, reason: 'linking_not_allowed' })
    expect(await uow.repos.identities.listForUser(ada)).toEqual([])
    expect(auditedReasons()).toEqual(['linking_not_allowed'])
  })

  it('revokes every other session it holds when a link is made', async () => {
    await verifyLocally()
    // A session somebody else may be holding on this account — including
    // whoever else knew its password.
    const elsewhere = await uow.repos.sessions.create({
      id: 'session-elsewhere' as SessionId,
      userId: ada,
      tokenHash: 'hash-elsewhere',
      now: NOW,
      expiresAt: new Date(NOW.getTime() + 600_000),
    })

    const result = await signIn()

    expect(result.ok).toBe(true)
    expect(await uow.repos.sessions.findById(elsewhere.id)).toBeNull()
    // The one this sign-in issued is the only one left.
    const remaining = await uow.repos.sessions.listForUser(ada)
    expect(remaining.map((row) => row.id)).toEqual([result.ok ? result.session.session.id : ''])
  })

  it('is not linked on an address the provider does not vouch for', async () => {
    await verifyLocally()

    expect(await signIn({ identity: identity({ emailVerified: false }) })).toEqual({
      ok: false,
      reason: 'email_not_verified',
    })
    expect(await uow.repos.identities.listForUser(ada)).toEqual([])
  })
})

describe('a person coming back', () => {
  it('is matched by subject, whatever their email says now', async () => {
    const first = await signIn()
    const second = await signIn({
      identity: identity({ email: 'ada.lovelace@elsewhere.example' }),
    })

    expect(second).toMatchObject({ ok: true, outcome: 'matched' })
    expect(second.ok && first.ok ? second.user === first.user : false).toBe(true)
    expect(await uow.repos.users.findByEmail('ada.lovelace@elsewhere.example')).toBeNull()
  })

  it('is matched even when the provider has stopped vouching for their email', async () => {
    await signIn()
    expect(await signIn({ identity: identity({ emailVerified: false }) })).toMatchObject({
      ok: true,
      outcome: 'matched',
    })
  })

  it('has the moment of their last sign-in recorded', async () => {
    await signIn()
    clock.advance(60_000)
    await signIn()

    expect(await uow.repos.identities.findBySubject(ISSUER, 'subject-1')).toMatchObject({
      lastSignInAt: new Date(NOW.getTime() + 60_000),
    })
  })

  it('does not inherit an account because somebody was given their old address', async () => {
    await signIn()
    const result = await signIn({ identity: identity({ subject: 'somebody-else' }) })

    // A different subject with the same verified email is a different person
    // at the provider — and links to the account that email already names.
    expect(result).toMatchObject({ ok: true, outcome: 'linked' })
    const rows = await uow.repos.identities.listForUser(
      result.ok ? result.user : userId('00000000-0000-4000-8000-000000000000'),
    )
    expect(rows.map((row) => row.subject)).toEqual(['subject-1', 'somebody-else'])
  })
})

describe('the session a sign-in issues', () => {
  it('rotates the one this browser already held', async () => {
    const first = await signIn()
    const previous = first.ok ? first.session.session.id : null

    const second = await signIn({ previousSessionId: previous })

    expect(second.ok ? second.session.session.id : '').not.toBe(previous)
    expect(await uow.repos.sessions.findById(previous ?? ('' as SessionId))).toBeNull()
  })
})
