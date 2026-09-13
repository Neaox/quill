import { EVENT_PAYLOAD_VERSION, MAIL_REQUESTED } from '@quill/application'
import type {
  Clock,
  IdGenerator,
  MagicLinkPurpose,
  MagicLinkTokenRow,
  MailRequestedPayload,
  SessionId,
  SessionRow,
  UnitOfWork,
  UserRow,
} from '@quill/application'
import { userId, type UserId } from '@quill/domain'

import type { BreachedPasswordChecker } from '../auth/breached-password.ts'
import type { AppDependencies } from '../dependencies.ts'
import { normaliseEmail } from '../auth/email.ts'
import type { PasswordHasher } from '../auth/password.ts'
import { hashesMatch } from '../auth/session-token.ts'
import { generateToken, hashToken } from '../auth/tokens.ts'
import type { SessionConfig } from '../config.ts'
import { AUDIT_EVENTS, createAuditRecorder } from './audit.ts'
import type { AuditRecorder } from './audit.ts'
import { createSessionService } from './session-service.ts'
import type { IssuedSession } from './session-service.ts'

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000

/**
 * Whether the browser presenting a link is allowed to spend it.
 *
 * The binding hash is compared with a timing-safe equality, and a token
 * issued before the column existed has none to check (ADR-033). The
 * confirmation flag is the documented fallback for the person who really
 * clicked but arrived in another browser.
 */
function bindingAccepted(record: MagicLinkTokenRow, input: ConsumeLinkInput): boolean {
  if (record.bindingHash === null) return true
  if (input.binding !== null && hashesMatch(record.bindingHash, hashToken(input.binding))) {
    return true
  }
  return input.confirm
}

/** The route layer's view of a freshly issued session: the row, plus the raw token. */
function issued(session: IssuedSession): SessionIssued {
  return {
    sessionId: session.session.id,
    userId: session.session.userId,
    expiresAt: session.session.expiresAt,
    token: session.token,
  }
}

export interface AuthServiceDeps {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly appUrl: string
  readonly session: SessionConfig
  readonly breachedPasswords: BreachedPasswordChecker
  /** Built once at composition time — see `createPasswordHasher`. */
  readonly passwords: PasswordHasher
}

export interface SignUpInput {
  readonly email: string
  readonly password: string
  readonly displayName: string
}

/**
 * Whatever a link request did, it hands the caller one thing: the secret that
 * says "this browser asked for it" (ADR-011). The route puts it in a
 * short-lived `HttpOnly` cookie, and consuming the link needs it back — or an
 * explicit confirmation. It is minted on every request, including one for an
 * address with no account, so the response is identical either way.
 */
export interface LinkRequested {
  readonly binding: string
}

/**
 * Sign-up answers the same way whether or not the email is known, so the
 * result says only that the flow completed — never which branch it took
 * (ADR-011). A breached password is the one refusal, and it is about the
 * password the caller chose, not about any account.
 */
export type SignUpResult =
  | { readonly ok: true; readonly binding: string }
  | { readonly ok: false; readonly reason: 'breached_password' }

export interface SignInInput {
  readonly email: string
  readonly password: string
}

export interface SessionIssued {
  readonly sessionId: SessionId
  readonly userId: UserId
  readonly expiresAt: Date
  /** The raw token the cookie carries. Never persisted, never logged. */
  readonly token: string
}

export type SignInResult =
  | { readonly ok: true; readonly session: SessionIssued }
  | { readonly ok: false; readonly reason: 'invalid_credentials' }

/**
 * Presenting a link: the token, plus what the browser can show for it.
 *
 * `binding` is the cookie the issuing browser was given; `confirm` is the
 * person saying "yes, I clicked this" when the cookie is absent, which is
 * ADR-011's explicit confirmation step. One or the other is required, so a
 * mail scanner that follows the link has neither and spends nothing.
 */
export interface ConsumeLinkInput {
  readonly token: string
  readonly binding: string | null
  readonly confirm: boolean
}

/**
 * `confirmation_required` is not a failure of the token: the token is good,
 * and the caller is being asked to say the click was theirs.
 */
export type LinkFailure = 'invalid_or_expired' | 'wrong_purpose' | 'confirmation_required'

export type ConsumeMagicLinkResult =
  | { readonly ok: true; readonly session: SessionIssued }
  | { readonly ok: false; readonly reason: LinkFailure }

export type VerifyEmailResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: LinkFailure }

export type ResetPasswordResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: LinkFailure | 'breached_password' }

export type ChangePasswordResult =
  | { readonly ok: true; readonly session: SessionIssued }
  | { readonly ok: false; readonly reason: 'invalid_credentials' | 'breached_password' }

/**
 * Auth flows (plan §23, ADR-011): email/password, magic links, password
 * reset and change, email verification, server-side sessions.
 *
 * Four rules run through all of it.
 *
 * Every answer has the same shape *and the same cost* whether or not the
 * account exists. That is why sign-up hashes on both branches, why an
 * unknown address still mints and hashes a token, and why no request path
 * waits for mail to be delivered: an SMTP round trip on one branch and not
 * the other is a measurable answer to "does this person have an account
 * here?". Delivery is an outbox event (`infrastructure/outbox/send-mail.ts`).
 *
 * Every address is normalised at this boundary, so one mailbox is one
 * account whatever the caller typed (`auth/email.ts`).
 *
 * Every new password is checked against the breached corpus, and a corpus
 * that cannot be reached fails open *and says so in the audit log*.
 *
 * Every credential or privilege change rotates sessions, so a token taken
 * before the change is worthless after it.
 */
export function createAuthService(deps: AuthServiceDeps) {
  const { uow, clock, ids, appUrl, breachedPasswords, passwords } = deps
  const sessions = createSessionService({
    uow,
    clock,
    ids,
    session: deps.session,
  })
  const audit: AuditRecorder = createAuditRecorder({ uow, clock, ids })

  /**
   * The token travels in the fragment, never the query (ADR-011).
   *
   * A query string is written to the server's access log, kept in browser
   * history, and sent in the `Referer` of anything the landing page loads. A
   * fragment is never sent to any server at all: the web app reads it in the
   * browser and POSTs it back, so the credential reaches exactly one request.
   */
  function linkUrl(purpose: MagicLinkPurpose, token: string): string {
    const routeByPurpose: Record<MagicLinkPurpose, string> = {
      'sign-in': '/auth/magic-link',
      'email-verification': '/auth/verify-email',
      'password-reset': '/auth/reset-password',
    }
    return `${appUrl}${routeByPurpose[purpose]}#token=${encodeURIComponent(token)}`
  }

  /** Queued, never awaited on a request path — see the note on enumeration above. */
  async function queueMail(payload: MailRequestedPayload): Promise<void> {
    await uow.repos.outbox.write({
      id: ids.uuid(),
      type: MAIL_REQUESTED,
      payload,
      now: clock.now(),
    })
  }

  /**
   * Answers whether the password may be used at all. A corpus that is down
   * must not stop people signing up, so `unavailable` is allowed through —
   * with an audit row, which is the only way anyone notices the check has
   * been absent for a week.
   */
  async function passwordIsUsable(
    password: string,
    actorUserId: UserId | null,
    context: string,
  ): Promise<boolean> {
    const verdict = await breachedPasswords.check(password)
    if (verdict.status === 'unavailable') {
      await audit.record({
        type: AUDIT_EVENTS.breachCheckUnavailable,
        actorUserId,
        targetType: 'password',
        targetId: context,
        metadata: { reason: verdict.reason },
      })
      return true
    }
    if (verdict.status === 'breached') {
      await audit.record({
        type: AUDIT_EVENTS.breachedPasswordRejected,
        actorUserId,
        targetType: 'password',
        targetId: context,
        // The count, never the password and never its hash.
        metadata: { occurrences: verdict.count },
      })
      return false
    }
    return true
  }

  /**
   * Issues a link, or does the same work and issues nothing.
   *
   * Both branches mint a token, hash it, and write an audit row of the same
   * shape; only the known branch has a row to insert and a message to queue,
   * because there is no account for the other one to belong to. What the
   * branches no longer differ by is the expensive part — a random token, a
   * SHA-256, and an SMTP round trip — which is what made the old code answer
   * "does this address exist" in its latency (review finding H3).
   */
  async function issueMagicLink(
    user: UserRow | null,
    email: string,
    purpose: MagicLinkPurpose,
  ): Promise<LinkRequested> {
    const now = clock.now()
    const token = generateToken()
    const tokenHash = hashToken(token)
    const binding = generateToken()
    const bindingHash = hashToken(binding)

    if (user === null) {
      // The same work, with nothing to write: the row would name an account
      // that does not exist. The audit row still goes in, in the same shape,
      // so an operator can see the attempt.
      await recordLinkIssued({ user, email, purpose, superseded: 0 })
      return { binding }
    }

    // ADR-011: a newer link invalidates every older one for the same purpose,
    // so a stale reset email in an inbox stops being a live credential.
    const superseded = await uow.repos.magicLinks.supersede(user.id, purpose, now)
    await uow.run(async (repos) => {
      await repos.magicLinks.create({
        id: ids.uuid(),
        userId: user.id,
        tokenHash,
        purpose,
        bindingHash,
        now,
        expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS),
      })
      // The event and the token it carries are committed together: a link
      // that exists is always one somebody will be sent.
      await repos.outbox.write({
        id: ids.uuid(),
        type: MAIL_REQUESTED,
        payload: {
          version: EVENT_PAYLOAD_VERSION,
          kind: 'magic-link',
          to: user.email,
          url: linkUrl(purpose, token),
          purpose,
        },
        now,
      })
    })

    await recordLinkIssued({ user, email, purpose, superseded })
    return { binding }
  }

  /** One row, one shape, whether or not there was an account to issue to. */
  async function recordLinkIssued(input: {
    readonly user: UserRow | null
    readonly email: string
    readonly purpose: MagicLinkPurpose
    readonly superseded: number
  }): Promise<void> {
    await audit.record({
      type: AUDIT_EVENTS.magicLinkIssued,
      actorUserId: input.user?.id ?? null,
      targetType: input.user === null ? 'email' : 'user',
      targetId: input.user?.id ?? input.email,
      metadata: {
        purpose: input.purpose,
        superseded: input.superseded,
        issued: input.user !== null,
      },
    })
  }

  /**
   * The one place a presented token becomes a row.
   *
   * Resolution happens before anything expensive: a token that does not
   * resolve is refused without a breach lookup or an Argon2id hash, so an
   * attacker cannot spend the instance's CPU by posting rubbish (review
   * finding M8).
   */
  async function resolveLink(
    input: ConsumeLinkInput,
    purpose: MagicLinkPurpose,
    now: Date,
  ): Promise<
    | { readonly ok: true; readonly record: MagicLinkTokenRow }
    | { readonly ok: false; readonly reason: LinkFailure }
  > {
    const record = await uow.repos.magicLinks.findByTokenHash(hashToken(input.token))
    if (record === null || record.consumedAt !== null || record.expiresAt < now) {
      return { ok: false, reason: 'invalid_or_expired' }
    }
    if (record.purpose !== purpose) {
      return { ok: false, reason: 'wrong_purpose' }
    }
    if (!bindingAccepted(record, input)) {
      return { ok: false, reason: 'confirmation_required' }
    }
    return { ok: true, record }
  }

  return {
    sessions,

    /**
     * Always the same answer, and always the same work. An unknown email
     * creates the account and queues a verification link; a known one queues
     * its owner a "you already have an account" notice. Both branches pay for
     * exactly one Argon2id hash, so neither the body nor the latency says
     * which happened.
     */
    async signUp(input: SignUpInput): Promise<SignUpResult> {
      const email = normaliseEmail(input.email)
      const existing = await uow.repos.users.findByEmail(email)
      if (!(await passwordIsUsable(input.password, existing?.id ?? null, 'sign-up'))) {
        return { ok: false, reason: 'breached_password' }
      }

      // Before the branch, deliberately: hashing only on the new-account path
      // made sign-up tens of milliseconds faster for an address that already
      // had an account, which is an answer to "is this person registered?"
      // (review finding H2).
      const passwordHash = await passwords.hash(input.password)

      if (existing !== null) {
        await audit.record({
          type: AUDIT_EVENTS.signUpExisting,
          actorUserId: null,
          targetType: 'user',
          targetId: existing.id,
        })
        await queueMail({
          version: EVENT_PAYLOAD_VERSION,
          kind: 'account-exists',
          to: existing.email,
          signInUrl: `${appUrl}/auth/sign-in`,
        })
        // A binding nothing will ever check, so the answer is the same shape
        // and the same cost as the other branch's.
        return { ok: true, binding: generateToken() }
      }

      const now = clock.now()
      const user = await uow.run(async (repos) => {
        const created = await repos.users.create({
          id: userId(ids.uuid()),
          email,
          displayName: input.displayName,
          now,
        })
        await repos.credentials.upsert({ userId: created.id, passwordHash, now })
        return created
      })
      await audit.record({
        type: AUDIT_EVENTS.signUp,
        actorUserId: user.id,
        targetType: 'user',
        targetId: user.id,
      })
      const { binding } = await issueMagicLink(user, email, 'email-verification')
      return { ok: true, binding }
    },

    /**
     * One Argon2id verify happens on every call, against a dummy hash when
     * there is no user or no credential, so latency does not say which.
     * A hash made with parameters below the current ones is replaced while
     * the plaintext is in hand — the only moment it ever is.
     */
    async signIn(input: SignInInput): Promise<SignInResult> {
      const email = normaliseEmail(input.email)
      const user = await uow.repos.users.findByEmail(email)
      const credential = user === null ? null : await uow.repos.credentials.findByUserId(user.id)

      if (user === null || credential === null) {
        await passwords.verifyDummy(input.password)
        await audit.record({
          type: AUDIT_EVENTS.signInFailed,
          actorUserId: user?.id ?? null,
          targetType: 'email',
          targetId: email,
          metadata: { reason: user === null ? 'no_account' : 'no_credential' },
        })
        return { ok: false, reason: 'invalid_credentials' }
      }

      if (!(await passwords.verify(credential.passwordHash, input.password))) {
        await audit.record({
          type: AUDIT_EVENTS.signInFailed,
          actorUserId: user.id,
          targetType: 'user',
          targetId: user.id,
          metadata: { reason: 'wrong_password' },
        })
        return { ok: false, reason: 'invalid_credentials' }
      }

      if (passwords.needsRehash(credential.passwordHash)) {
        await uow.repos.credentials.upsert({
          userId: user.id,
          passwordHash: await passwords.hash(input.password),
          now: clock.now(),
        })
        await audit.record({
          type: AUDIT_EVENTS.passwordRehashed,
          actorUserId: user.id,
          targetType: 'user',
          targetId: user.id,
        })
      }

      const session = await sessions.issue(user.id)
      await audit.record({
        type: AUDIT_EVENTS.signInSucceeded,
        actorUserId: user.id,
        targetType: 'session',
        targetId: session.session.id,
        metadata: { method: 'password' },
      })
      return { ok: true, session: issued(session) }
    },

    async signOut(sessionId: SessionId, actor: UserId | null): Promise<void> {
      await sessions.revoke(sessionId)
      await audit.record({
        type: AUDIT_EVENTS.signOut,
        actorUserId: actor,
        targetType: 'session',
        targetId: sessionId,
      })
    },

    async listSessions(user: UserId): Promise<readonly SessionRow[]> {
      return sessions.list(user)
    },

    /** Revokes one of the caller's own sessions; another user's is not found. */
    async revokeSession(actor: UserId, sessionId: SessionId): Promise<boolean> {
      const row = await uow.repos.sessions.findById(sessionId)
      if (row === null || row.userId !== actor) return false
      await sessions.revoke(sessionId)
      await audit.record({
        type: AUDIT_EVENTS.sessionRevoked,
        actorUserId: actor,
        targetType: 'session',
        targetId: sessionId,
      })
      return true
    },

    /** "Sign out everywhere": every session this user holds, including the calling one. */
    async signOutEverywhere(actor: UserId): Promise<void> {
      await sessions.revokeAll(actor, null)
      await audit.record({
        type: AUDIT_EVENTS.sessionsRevoked,
        actorUserId: actor,
        targetType: 'user',
        targetId: actor,
      })
    },

    /**
     * Never reveals whether the email exists, and never creates an account.
     *
     * It used to: an unknown address asking for a `sign-in` link got a
     * brand-new, unverified account, which made a public endpoint an account
     * factory and a way to squat an address before its owner signs up
     * (review finding M7). Sign-up is the only way in.
     */
    async requestMagicLink(rawEmail: string, purpose: MagicLinkPurpose): Promise<LinkRequested> {
      const email = normaliseEmail(rawEmail)
      return issueMagicLink(await uow.repos.users.findByEmail(email), email, purpose)
    },

    async consumeSignInLink(input: ConsumeLinkInput): Promise<ConsumeMagicLinkResult> {
      const now = clock.now()
      const resolved = await resolveLink(input, 'sign-in', now)
      if (!resolved.ok) return resolved
      const { record } = resolved

      const consumed = await uow.repos.magicLinks.consume(record.id, now)
      if (!consumed) {
        return { ok: false, reason: 'invalid_or_expired' }
      }
      const user = await uow.repos.users.findById(record.userId)
      /* v8 ignore next 3 -- unreachable: magic_link_tokens.user_id cascades on delete (schema.ts),
         so a token that was just found and consumed always still has its user row. */
      if (user === null) {
        return { ok: false, reason: 'invalid_or_expired' }
      }
      if (user.emailVerifiedAt === null) {
        await uow.repos.users.markEmailVerified(user.id, now)
      }
      const session = await sessions.issue(user.id)
      await audit.record({
        type: AUDIT_EVENTS.signInSucceeded,
        actorUserId: user.id,
        targetType: 'session',
        targetId: session.session.id,
        metadata: { method: 'magic-link' },
      })
      return { ok: true, session: issued(session) }
    },

    async verifyEmail(input: ConsumeLinkInput): Promise<VerifyEmailResult> {
      const now = clock.now()
      const resolved = await resolveLink(input, 'email-verification', now)
      if (!resolved.ok) return resolved
      const { record } = resolved

      const consumed = await uow.repos.magicLinks.consume(record.id, now)
      if (!consumed) {
        return { ok: false, reason: 'invalid_or_expired' }
      }
      await uow.repos.users.markEmailVerified(record.userId, now)
      await audit.record({
        type: AUDIT_EVENTS.emailVerified,
        actorUserId: record.userId,
        targetType: 'user',
        targetId: record.userId,
      })
      return { ok: true }
    },

    async requestPasswordReset(rawEmail: string): Promise<LinkRequested> {
      const email = normaliseEmail(rawEmail)
      return issueMagicLink(await uow.repos.users.findByEmail(email), email, 'password-reset')
    },

    async resetPassword(
      input: ConsumeLinkInput & { readonly newPassword: string },
    ): Promise<ResetPasswordResult> {
      const now = clock.now()
      // Resolving first is the point: the breach lookup below is a network
      // call and the hash after it is deliberately slow, and neither should
      // be reachable by posting a token that was never issued (finding M8).
      const resolved = await resolveLink(input, 'password-reset', now)
      if (!resolved.ok) return resolved
      const { record } = resolved

      if (!(await passwordIsUsable(input.newPassword, record.userId, 'password-reset'))) {
        return { ok: false, reason: 'breached_password' }
      }
      const consumed = await uow.repos.magicLinks.consume(record.id, now)
      if (!consumed) {
        return { ok: false, reason: 'invalid_or_expired' }
      }
      await uow.repos.credentials.upsert({
        userId: record.userId,
        passwordHash: await passwords.hash(input.newPassword),
        now,
      })
      // A credential change is a privilege change: every session goes.
      await sessions.revokeAll(record.userId, null)
      await audit.record({
        type: AUDIT_EVENTS.passwordReset,
        actorUserId: record.userId,
        targetType: 'user',
        targetId: record.userId,
      })
      return { ok: true }
    },

    /**
     * Changing a password while signed in. Every other session is dropped and
     * the calling one is rotated, so the change ends any session an attacker
     * might already hold, including one on this very browser.
     */
    async changePassword(input: {
      readonly user: UserId
      readonly sessionId: SessionId
      readonly currentPassword: string
      readonly newPassword: string
    }): Promise<ChangePasswordResult> {
      const credential = await uow.repos.credentials.findByUserId(input.user)
      if (
        credential === null ||
        !(await passwords.verify(credential.passwordHash, input.currentPassword))
      ) {
        if (credential === null) await passwords.verifyDummy(input.currentPassword)
        await audit.record({
          type: AUDIT_EVENTS.signInFailed,
          actorUserId: input.user,
          targetType: 'user',
          targetId: input.user,
          metadata: { reason: 'password_change_reauth' },
        })
        return { ok: false, reason: 'invalid_credentials' }
      }
      if (!(await passwordIsUsable(input.newPassword, input.user, 'password-change'))) {
        return { ok: false, reason: 'breached_password' }
      }

      const now = clock.now()
      await uow.repos.credentials.upsert({
        userId: input.user,
        passwordHash: await passwords.hash(input.newPassword),
        now,
      })
      await sessions.revokeAll(input.user, input.sessionId)
      const rotated = await sessions.rotate(input.user, input.sessionId)
      await audit.record({
        type: AUDIT_EVENTS.passwordChanged,
        actorUserId: input.user,
        targetType: 'user',
        targetId: input.user,
      })
      return { ok: true, session: issued(rotated) }
    },

    /**
     * A privilege change rotates the affected user's sessions: whatever they
     * were allowed to do a moment ago, no session survives to carry the old
     * answer (ADR-011).
     *
     * Everything that changes this flag goes through here rather than through
     * `users.setInstanceAdmin`, because the repository call alone rotates
     * nothing and audits nothing — see `grantInstanceAdmin` below, which is
     * how a script reaches it.
     */
    async setInstanceAdmin(input: {
      readonly actor: UserId | null
      readonly target: UserId
      readonly isInstanceAdmin: boolean
    }): Promise<void> {
      await uow.repos.users.setInstanceAdmin(input.target, input.isInstanceAdmin)
      await sessions.revokeAll(input.target, null)
      await audit.record({
        type: AUDIT_EVENTS.privilegeChanged,
        actorUserId: input.actor,
        targetType: 'user',
        targetId: input.target,
        metadata: { isInstanceAdmin: input.isInstanceAdmin },
      })
    },
  }
}

export type AuthService = ReturnType<typeof createAuthService>

/**
 * The auth service as the composed application already has it.
 *
 * `AppDependencies` carries everything `AuthServiceDeps` names, so a caller
 * holding the former should never have to restate the mapping — and every
 * caller that did restate it was a place a new dependency could be forgotten.
 */
export function authServiceFor(deps: AppDependencies): AuthService {
  return createAuthService({
    uow: deps.uow,
    clock: deps.clock,
    ids: deps.ids,
    appUrl: deps.config.appUrl,
    session: deps.config.session,
    breachedPasswords: deps.breachedPasswords,
    passwords: deps.passwords,
  })
}

/**
 * Making somebody an instance administrator, through the service (review
 * finding M11).
 *
 * `users.setInstanceAdmin` writes a boolean and nothing else: no session is
 * rotated, so whoever was signed in keeps a session that predates the change,
 * and no audit row records who did it. Scripts — the seed, a future
 * break-glass CLI — and fixtures call this instead, so there is exactly one
 * path that changes the flag and it is the one ADR-011 describes.
 */
export async function grantInstanceAdmin(
  deps: AppDependencies,
  input: {
    readonly actor: UserId | null
    readonly target: UserId
    readonly isInstanceAdmin?: boolean
  },
): Promise<void> {
  await authServiceFor(deps).setInstanceAdmin({
    actor: input.actor,
    target: input.target,
    isInstanceAdmin: input.isInstanceAdmin ?? true,
  })
}
