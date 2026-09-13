import type {
  Clock,
  FederatedIdentity,
  IdGenerator,
  SessionId,
  UnitOfWork,
  UserRow,
} from '@quill/application'
import { userId, type UserId } from '@quill/domain'

import { normaliseEmail } from '../auth/email.ts'
import type { SessionConfig } from '../config.ts'
import { AUDIT_EVENTS, createAuditRecorder } from './audit.ts'
import type { AuditRecorder } from './audit.ts'
import { createSessionService } from './session-service.ts'
import type { IssuedSession } from './session-service.ts'

/**
 * What happens after a provider has vouched for somebody (ADR-011,
 * "Identity, not email, is the key").
 *
 * Three rules, and they are the whole module:
 *
 * 1. **The subject is the key.** A returning person is found by
 *    `(issuer, subject)`, never by their email, so changing their address at
 *    the provider — or somebody else being given their old one — moves no
 *    account anywhere.
 * 2. **Linking takes a verified address on *both* sides.** The provider must
 *    vouch for it, because an unverified assertion is one an attacker makes
 *    by typing an address into their own directory. And the local account
 *    must already have verified that address *for itself*, because otherwise
 *    the account is a claim nobody has checked either: anyone can sign up
 *    with `cto@acme.example`, never open the mail, and wait for the real CTO
 *    to press "Continue with Microsoft" — and inherit whatever that account
 *    has been granted in the meantime. An unverified local account is
 *    therefore refused, not linked; its owner verifies their email the
 *    ordinary way first, and then the link is safe to make.
 * 3. **Linking can be turned off entirely**, per provider
 *    (`OIDC_<ID>_ALLOW_LINKING`), which is ADR-011's linking policy. With it
 *    off, this provider signs in only identities it has already been linked
 *    to, and provisions new accounts.
 * 4. **A new account is made only if the instance allows it.** With sign-up
 *    through SSO turned off, a person the platform has never seen is refused
 *    rather than provisioned, and an administrator invites them instead.
 * 5. **A link revokes every other session that account holds.** Attaching a
 *    second way in is a privilege change (ADR-011), and the sessions that
 *    predate it must not survive it.
 *
 * Everything it does is audited, and no audit row carries a token, a code, or
 * a claim set — only the outcome, the provider, and the subject the provider
 * asserted, which is what an operator needs to answer "who signed in and how".
 */

export type FederatedSignInRefusal =
  /** The provider asserted no email, or asserted one it does not vouch for. */
  | 'email_not_verified'
  /** This person has no account here and this provider may not create one. */
  | 'sign_up_not_allowed'
  /**
   * An account here uses that address but has never proved it. Linking would
   * hand the account to whoever the provider vouches for; the owner verifies
   * their email first, and then the link is safe.
   */
  | 'unverified_local_account'
  /** An account here uses that address and this provider may not link to one. */
  | 'linking_not_allowed'

/** How the identity reached a user: matched by subject, linked to an existing account, or new. */
export type FederatedSignInOutcome = 'matched' | 'linked' | 'provisioned'

export type FederatedSignInResult =
  | {
      readonly ok: true
      readonly session: IssuedSession
      readonly user: UserId
      readonly outcome: FederatedSignInOutcome
    }
  | { readonly ok: false; readonly reason: FederatedSignInRefusal }

export interface FederatedSignInInput {
  readonly identity: FederatedIdentity
  /** The configured provider the person pressed, recorded on the identity row. */
  readonly providerId: string
  readonly allowSignUp: boolean
  /** Whether this provider may attach an identity to an account that already exists. */
  readonly allowLinking: boolean
  /** The session this browser already held, if any: it is rotated out (ADR-011). */
  readonly previousSessionId: SessionId | null
}

export interface FederatedSignInDeps {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly session: SessionConfig
}

/** The provider's `name`, or the part of the address before the `@`, or the address. */
function displayNameFor(identity: FederatedIdentity, email: string): string {
  if (identity.displayName !== null && identity.displayName.trim().length > 0) {
    return identity.displayName.trim()
  }
  const [local] = email.split('@')
  return local === undefined || local.length === 0 ? email : local
}

export function createFederatedSignInService(deps: FederatedSignInDeps) {
  const { uow, clock, ids } = deps
  const sessions = createSessionService({
    uow,
    clock,
    ids,
    session: deps.session,
  })
  const audit: AuditRecorder = createAuditRecorder({ uow, clock, ids })

  /**
   * A brand-new account for somebody this platform has never seen.
   *
   * The provider asserting a verified address *is* the verification here:
   * there is no mailbox left for the person to prove, because the directory
   * has already proved it. (An account that already existed never reaches
   * this: it got here by having verified the same address itself.)
   */
  async function provision(
    identity: FederatedIdentity,
    email: string,
    now: Date,
  ): Promise<UserRow> {
    const created = await uow.repos.users.create({
      id: userId(ids.uuid()),
      email,
      displayName: displayNameFor(identity, email),
      now,
    })
    await uow.repos.users.markEmailVerified(created.id, now)
    return created
  }

  /** One shape for every federated outcome, so the trail reads as one story. */
  async function record(
    type: string,
    actor: UserId | null,
    input: FederatedSignInInput,
    metadata: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await audit.record({
      type,
      actorUserId: actor,
      targetType: 'identity',
      // The provider's own key for this person. Not a secret, and the only
      // thing that identifies the account on the provider's side.
      targetId: `${input.identity.issuer}#${input.identity.subject}`,
      metadata: { provider: input.providerId, ...metadata },
    })
  }

  return {
    async signIn(input: FederatedSignInInput): Promise<FederatedSignInResult> {
      const { identity } = input
      const now = clock.now()

      // 1. The subject, first and always. A person whose identity is already
      // linked signs in whatever their email says today.
      const existing = await uow.repos.identities.findBySubject(identity.issuer, identity.subject)
      if (existing !== null) {
        await uow.repos.identities.touch(existing.id, now)
        const session = await sessions.rotate(existing.userId, input.previousSessionId)
        await record(AUDIT_EVENTS.ssoSignInSucceeded, existing.userId, input, {
          outcome: 'matched',
          sessionId: session.session.id,
        })
        return { ok: true, session, user: existing.userId, outcome: 'matched' }
      }

      // 2. A first sign-in needs an address the provider vouches for: it is
      // what links to an account here, and what a new account is created with.
      if (identity.email === null || !identity.emailVerified) {
        await record(AUDIT_EVENTS.ssoSignInFailed, null, input, { reason: 'email_not_verified' })
        return { ok: false, reason: 'email_not_verified' }
      }
      const email = normaliseEmail(identity.email)
      const existingLocal = await uow.repos.users.findByEmail(email)

      // Which of the two things is about to happen, and whether it is
      // allowed. Both refusals are the same to the browser; only the audit
      // row tells them apart.
      if (existingLocal === null && !input.allowSignUp) {
        await record(AUDIT_EVENTS.ssoSignInFailed, null, input, { reason: 'sign_up_not_allowed' })
        return { ok: false, reason: 'sign_up_not_allowed' }
      }
      if (existingLocal !== null && !input.allowLinking) {
        await record(AUDIT_EVENTS.ssoSignInFailed, existingLocal.id, input, {
          reason: 'linking_not_allowed',
        })
        return { ok: false, reason: 'linking_not_allowed' }
      }
      // The pre-registration attack: an account that has never proved this
      // address is a claim, not an identity, and linking into it would give
      // it away. See rule 2 in the note at the top of this file.
      if (existingLocal !== null && existingLocal.emailVerifiedAt === null) {
        await record(AUDIT_EVENTS.ssoSignInFailed, existingLocal.id, input, {
          reason: 'unverified_local_account',
        })
        return { ok: false, reason: 'unverified_local_account' }
      }

      // One question, asked once: is there an account already, or is this
      // person new here? Everything below is the same either way.
      const { user, outcome } =
        existingLocal === null
          ? { user: await provision(identity, email, now), outcome: 'provisioned' as const }
          : { user: existingLocal, outcome: 'linked' as const }

      // `link` is conflict-tolerant, so two tabs finishing at once end up on
      // one identity row rather than one of them failing.
      const linked = await uow.repos.identities.link({
        id: ids.uuid(),
        userId: user.id,
        providerId: input.providerId,
        issuer: identity.issuer,
        subject: identity.subject,
        now,
      })
      await uow.repos.identities.touch(linked.id, now)

      await record(
        outcome === 'linked' ? AUDIT_EVENTS.ssoLinked : AUDIT_EVENTS.ssoProvisioned,
        user.id,
        input,
        { userId: user.id },
      )

      const session = await sessions.rotate(linked.userId, input.previousSessionId)
      // Attaching a second way into an account is a privilege change, so no
      // session that predates it survives it (ADR-011) — including one an
      // attacker may be holding on an account somebody is only now proving
      // is theirs.
      await sessions.revokeAll(linked.userId, session.session.id)
      await record(AUDIT_EVENTS.ssoSignInSucceeded, linked.userId, input, {
        outcome,
        sessionId: session.session.id,
      })
      return { ok: true, session, user: linked.userId, outcome }
    },

    /** Records a failure that happened before an identity existed: a bad state, a refused token. */
    async recordFailure(input: {
      readonly providerId: string
      readonly reason: string
      readonly detail: string
    }): Promise<void> {
      await audit.record({
        type: AUDIT_EVENTS.ssoSignInFailed,
        actorUserId: null,
        targetType: 'identity-provider',
        targetId: input.providerId,
        // The reason and one line of detail. Never the code, the state, or
        // any part of a token.
        metadata: { reason: input.reason, detail: input.detail },
      })
    },
  }
}

export type FederatedSignInService = ReturnType<typeof createFederatedSignInService>
