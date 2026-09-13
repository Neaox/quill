import {
  COLLECTION_AUDIT_EVENTS,
  DOCUMENT_AUDIT_EVENTS,
  SHARE_LINK_AUDIT_EVENTS,
  SECRET_AUDIT_EVENTS,
  SETTINGS_AUDIT_EVENTS,
  TENANCY_AUDIT_EVENTS,
} from '@quill/application'
import type { Clock, IdGenerator, UnitOfWork } from '@quill/application'
import type { UserId } from '@quill/domain'

/**
 * The audit trail for authentication and permission outcomes (ADR-011).
 *
 * Nothing written here is a secret. A session's *row id* is safe to record
 * because it is no longer what the cookie carries — the cookie carries a
 * token whose hash is stored (`auth/session-token.ts`) — so an audit row
 * names a session without being able to resume it. Passwords, raw tokens,
 * and token hashes never reach this module.
 */

export const AUDIT_EVENTS = {
  signUp: 'auth.sign_up',
  signUpExisting: 'auth.sign_up.existing_account',
  signInSucceeded: 'auth.sign_in.succeeded',
  signInFailed: 'auth.sign_in.failed',
  signOut: 'auth.sign_out',
  rateLimited: 'auth.rate_limited',
  passwordChanged: 'auth.password.changed',
  passwordReset: 'auth.password.reset',
  passwordRehashed: 'auth.password.rehashed',
  emailVerified: 'auth.email.verified',
  sessionRevoked: 'auth.session.revoked',
  sessionsRevoked: 'auth.sessions.revoked',
  magicLinkIssued: 'auth.magic_link.issued',
  // Single sign-on (ADR-011). Every outcome is recorded, and none of these
  // rows carries a code, a state, a nonce, or any part of a token: the
  // target is `<issuer>#<subject>`, which is the provider's own public key
  // for a person, and the metadata is the outcome.
  ssoSignInStarted: 'auth.sso.started',
  ssoSignInSucceeded: 'auth.sso.succeeded',
  ssoSignInFailed: 'auth.sso.failed',
  ssoLinked: 'auth.sso.linked',
  ssoProvisioned: 'auth.sso.provisioned',
  magicLinkConsumed: 'auth.magic_link.consumed',
  breachCheckUnavailable: 'auth.breached_password.unavailable',
  breachedPasswordRejected: 'auth.breached_password.rejected',
  privilegeChanged: 'auth.privilege.changed',
  // Tenancy administration. The names live with the use cases that write
  // them (`@quill/application`), because those write the rows; they are
  // listed here so this stays the one place the vocabulary can be read.
  collectionCreated: COLLECTION_AUDIT_EVENTS.created,
  collectionRenamed: COLLECTION_AUDIT_EVENTS.renamed,
  collectionDeleted: COLLECTION_AUDIT_EVENTS.deleted,
  unitCreated: TENANCY_AUDIT_EVENTS.unitCreated,
  unitRenamed: TENANCY_AUDIT_EVENTS.unitRenamed,
  unitDeleted: TENANCY_AUDIT_EVENTS.unitDeleted,
  workspaceCreated: TENANCY_AUDIT_EVENTS.workspaceCreated,
  workspaceRenamed: TENANCY_AUDIT_EVENTS.workspaceRenamed,
  workspaceDeleted: TENANCY_AUDIT_EVENTS.workspaceDeleted,
  documentDeleted: DOCUMENT_AUDIT_EVENTS.deleted,
  // Share links (plan section 14). The row names the link, never its token.
  shareLinkCreated: SHARE_LINK_AUDIT_EVENTS.created,
  shareLinkRevoked: SHARE_LINK_AUDIT_EVENTS.revoked,
  shareLinkUsed: SHARE_LINK_AUDIT_EVENTS.used,
  // Configuration and secrets (ADR-034). A secret's row names it and the key
  // that wraps it; its value is never written here or anywhere else.
  organisationSettingsUpdated: SETTINGS_AUDIT_EVENTS.organisationUpdated,
  workspaceSettingsUpdated: SETTINGS_AUDIT_EVENTS.workspaceUpdated,
  secretSet: SECRET_AUDIT_EVENTS.set,
  secretDeleted: SECRET_AUDIT_EVENTS.deleted,
  masterKeyRotated: SECRET_AUDIT_EVENTS.masterKeyRotated,
} as const

export interface AuditEvent {
  readonly type: string
  readonly actorUserId: UserId | null
  readonly targetType: string
  readonly targetId: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface AuditRecorder {
  record(event: AuditEvent): Promise<void>
}

export interface AuditRecorderDeps {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
}

/** Somewhere to report an audit write that failed. `FastifyBaseLogger` satisfies it. */
export interface AuditErrorLog {
  warn(details: object, message: string): void
}

/**
 * Records without making the caller wait.
 *
 * Some outcomes are audited on a path that is already refusing the request —
 * a rate limit, for instance — where waiting on a database write would turn
 * one failure mode into two. The write still has to be *heard about* when it
 * fails, which is what the log is for.
 */
export function recordInBackground(
  recorder: AuditRecorder,
  event: AuditEvent,
  log: AuditErrorLog,
): void {
  void recorder.record(event).catch((error: unknown) => {
    log.warn({ err: error }, 'audit write failed')
  })
}

export function createAuditRecorder(deps: AuditRecorderDeps): AuditRecorder {
  return {
    async record(event: AuditEvent): Promise<void> {
      await deps.uow.repos.audit.write({
        id: deps.ids.uuid(),
        type: event.type,
        actorUserId: event.actorUserId,
        targetType: event.targetType,
        targetId: event.targetId,
        metadata: event.metadata ?? {},
        now: deps.clock.now(),
      })
    },
  }
}
