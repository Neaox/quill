import { err, isShareLinkRole, ok, shareLinkState } from '@quill/domain'
import type {
  DocumentId,
  Result,
  Role,
  ShareLink,
  ShareLinkId,
  ShareLinkScope,
  ShortId,
  UserId,
} from '@quill/domain'

import type { DocumentRow, ShareLinkRow, UnitOfWork } from '../ports/persistence.ts'
import type { Clock, IdGenerator, TokenService } from '../ports/system.ts'

/**
 * Share links: a token mapped to a grant (plan section 14).
 *
 * Four commands and a resolution. The security properties are all here rather
 * than in the routes above, so that they hold however a link is reached:
 *
 * - **The token is never stored.** `createShareLink` draws 256 bits through
 *   the `TokenService` port, stores only the SHA-256 of them, and returns the
 *   raw token exactly once (ADR-011). There is no route, and no repository
 *   method, that can hand it back later.
 * - **Every refusal looks the same.** Unknown, expired and revoked are
 *   distinct outcomes here because the audit log and an administrator's list
 *   care about the difference; a reader is answered identically for all
 *   three, which is what makes the tokens unguessable in practice as well as
 *   in principle.
 * - **The audit row names the link, never the token.** Creation, revocation
 *   and the first use each write one, keyed by the link's id.
 *
 * The audit records the *first* use rather than every one: an anonymous read
 * must not cost a row per request, which is a log nobody can read and a write
 * amplifier pointed at the database by anyone holding a link. Every use still
 * stamps `last_used_at`, which is what "when was this link last used" is
 * actually asking (use case 26).
 *
 * Authorisation is the caller's, as it is for every other use case here
 * (AGENTS.md rule 3): a route asks the authorizer for `manage` on the
 * document and then calls these. What is *not* the caller's is policy, which
 * is asked of the `ShareLinkPolicy` port on both creation and use, so that
 * turning share links off closes the links that exist as well as refusing new
 * ones.
 */

export const SHARE_LINK_AUDIT_EVENTS = {
  created: 'share_link.created',
  revoked: 'share_link.revoked',
  used: 'share_link.used',
} as const

/** The audit's `targetType` for every row this module writes. */
const SHARE_LINK_TARGET = 'share-link'

/**
 * Whether the organisation allows share links at all.
 *
 * A function rather than a flag because the answer is about to start coming
 * from the settings store, where an administrator can change it while the
 * server is running.
 *
 * TODO(M3): read this from the organisation's settings once the settings
 * store lands; the server's adapter reads the `SHARE_LINKS` environment
 * variable until then.
 */
export interface ShareLinkPolicy {
  allowed(): boolean
}

export interface ShareLinkDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly tokens: TokenService
  readonly shareLinkPolicy: ShareLinkPolicy
}

/** The permission-relevant half of a stored link, for the domain's rules. */
export function toShareLink(row: ShareLinkRow): ShareLink {
  return {
    id: row.id,
    documentId: row.documentId,
    scope: row.scope,
    role: row.role,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdBy: row.createdBy,
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateShareLinkCommand {
  readonly documentId: DocumentId
  readonly scope: ShareLinkScope
  readonly role: Role
  /** Null for a link that never expires. */
  readonly expiresAt: Date | null
  readonly createdBy: UserId
}

export type CreateShareLinkResult =
  | {
      readonly kind: 'created'
      readonly link: ShareLinkRow
      /** The only time this value exists outside the creator's clipboard. */
      readonly token: string
    }
  | { readonly kind: 'not-allowed' }
  | { readonly kind: 'role-unavailable'; readonly role: Role }
  | { readonly kind: 'expiry-in-the-past'; readonly expiresAt: Date }

export async function createShareLink(
  deps: ShareLinkDependencies,
  command: CreateShareLinkCommand,
): Promise<CreateShareLinkResult> {
  if (!deps.shareLinkPolicy.allowed()) return { kind: 'not-allowed' }
  if (!isShareLinkRole(command.role)) return { kind: 'role-unavailable', role: command.role }

  const now = deps.clock.now()
  if (command.expiresAt !== null && command.expiresAt.getTime() <= now.getTime()) {
    return { kind: 'expiry-in-the-past', expiresAt: command.expiresAt }
  }

  const token = deps.tokens.issue()
  const link = await deps.uow.repos.shareLinks.create({
    id: deps.ids.uuid() as ShareLinkId,
    documentId: command.documentId,
    tokenHash: deps.tokens.hash(token),
    scope: command.scope,
    role: command.role,
    expiresAt: command.expiresAt,
    createdBy: command.createdBy,
    now,
  })

  await audit(deps, {
    type: SHARE_LINK_AUDIT_EVENTS.created,
    actorUserId: command.createdBy,
    targetId: link.id,
    metadata: {
      documentId: link.documentId,
      scope: link.scope,
      role: link.role,
      expiresAt: link.expiresAt?.toISOString() ?? null,
    },
  })
  return { kind: 'created', link, token }
}

// ---------------------------------------------------------------------------
// List and revoke
// ---------------------------------------------------------------------------

export interface ListShareLinksCommand {
  readonly documentId: DocumentId
}

/** Newest first. Nothing here can reconstruct a token. */
export async function listShareLinks(
  deps: ShareLinkDependencies,
  command: ListShareLinksCommand,
): Promise<readonly ShareLinkRow[]> {
  return deps.uow.repos.shareLinks.listForDocument(command.documentId)
}

/** One link by id, for a route that has to decide who may revoke it. */
export async function findShareLink(
  deps: Pick<ShareLinkDependencies, 'uow'>,
  shareLinkId: ShareLinkId,
): Promise<ShareLinkRow | null> {
  return deps.uow.repos.shareLinks.findById(shareLinkId)
}

export interface RevokeShareLinkCommand {
  readonly shareLinkId: ShareLinkId
  readonly revokedBy: UserId
}

export type RevokeShareLinkResult =
  | { readonly kind: 'revoked'; readonly link: ShareLinkRow }
  /** Already closed; revoking again is accepted and keeps the original instant. */
  | { readonly kind: 'already-revoked'; readonly link: ShareLinkRow }
  | { readonly kind: 'not-found' }

export async function revokeShareLink(
  deps: ShareLinkDependencies,
  command: RevokeShareLinkCommand,
): Promise<RevokeShareLinkResult> {
  const existing = await deps.uow.repos.shareLinks.findById(command.shareLinkId)
  if (existing === null) return { kind: 'not-found' }
  if (existing.revokedAt !== null) return { kind: 'already-revoked', link: existing }

  const link = await deps.uow.repos.shareLinks.revoke(command.shareLinkId, deps.clock.now())
  /* v8 ignore next -- the row was read a moment ago in the same request; only a concurrent delete could remove it. */
  if (link === null) return { kind: 'not-found' }

  await audit(deps, {
    type: SHARE_LINK_AUDIT_EVENTS.revoked,
    actorUserId: command.revokedBy,
    targetId: link.id,
    metadata: { documentId: link.documentId, scope: link.scope, role: link.role },
  })
  return { kind: 'revoked', link }
}

// ---------------------------------------------------------------------------
// Resolve and record a use
// ---------------------------------------------------------------------------

export interface ResolveShareLinkCommand {
  /** The raw token from the URL. Hashed here and never stored or logged. */
  readonly token: string
}

export interface ResolvedShareLink {
  readonly link: ShareLinkRow
  readonly document: DocumentRow
}

/**
 * Why a presented token grants nothing.
 *
 * Kept apart so the server can audit and reason about them, and answered
 * identically to the caller: `unknown` must be indistinguishable from
 * `expired` and `revoked` or the platform confirms which tokens have ever
 * existed (ADR-011).
 */
export type ShareLinkRefusal = 'not-allowed' | 'unknown' | 'expired' | 'revoked'

export async function resolveShareLink(
  deps: ShareLinkDependencies,
  command: ResolveShareLinkCommand,
): Promise<Result<ResolvedShareLink, ShareLinkRefusal>> {
  if (!deps.shareLinkPolicy.allowed()) return err('not-allowed')

  const presented = deps.tokens.hash(command.token)
  const row = await deps.uow.repos.shareLinks.findByTokenHash(presented)
  if (row === null) return err('unknown')
  // The lookup already matched on the digest, so this can only disagree if
  // the store answered with a row it was not asked for. It is a constant-time
  // comparison because that is the only kind worth making about a credential:
  // a byte-by-byte one here would be a timing oracle bolted onto an index
  // that has none (ADR-011).
  /* v8 ignore next -- unreachable while the store honours the digest it was given. */
  if (!deps.tokens.matches(row.tokenHash, presented)) return err('unknown')

  const state = shareLinkState(toShareLink(row), deps.clock.now())
  if (state !== 'valid') return err(state)

  const document = await deps.uow.repos.documents.findById(row.documentId)
  // `share_links.document_id` cascades, so a live link always has its
  // document in the database; a link that somehow outlives it grants nothing
  // and is refused as if the token had never existed.
  if (document === null) return err('unknown')

  return ok({ link: row, document })
}

export interface RecordShareLinkUseCommand {
  readonly link: ShareLinkRow
  /** A member who followed the link, when there was a session behind it. */
  readonly actorUserId: UserId | null
}

/**
 * Stamps the use, and audits the first one.
 *
 * See the module doc: an audit row per anonymous read would be a log nobody
 * reads and a write anybody holding a link can make the database do.
 */
export async function recordShareLinkUse(
  deps: ShareLinkDependencies,
  command: RecordShareLinkUseCommand,
): Promise<void> {
  const { link } = command
  if (link.lastUsedAt === null) {
    await audit(deps, {
      type: SHARE_LINK_AUDIT_EVENTS.used,
      actorUserId: command.actorUserId,
      targetId: link.id,
      metadata: { documentId: link.documentId, scope: link.scope, role: link.role },
    })
  }
  await deps.uow.repos.shareLinks.markUsed(link.id, deps.clock.now())
}

// ---------------------------------------------------------------------------
// Navigation inside a link's scope
// ---------------------------------------------------------------------------

/** One document a share-link reader may move to, and the ones below it. */
export interface SharedNavigationNode {
  readonly id: DocumentId
  readonly shortId: ShortId
  readonly title: string
  readonly slug: string
  readonly children: readonly SharedNavigationNode[]
}

/**
 * What a share-link page may offer to navigate to: nothing at all for a
 * document link, and the published documents nested under the target for a
 * subtree link.
 *
 * Three rules shape it, and each is a line in `surfaces.md`'s "must never
 * appear" for this surface:
 *
 * - **Nothing outside the link's scope.** A document link is one document, so
 *   it offers no navigation whatsoever.
 * - **Nothing outside the target's collection**, which is where a subtree
 *   stops (`buildDocumentAncestorChain`), so a parent pointer that escapes it
 *   cannot widen what a link reaches.
 * - **No drafts.** A document that has never been published has no body to
 *   show, so listing it would offer a reader a dead end.
 */
export async function shareLinkNavigation(
  deps: Pick<ShareLinkDependencies, 'uow'>,
  resolved: ResolvedShareLink,
): Promise<readonly SharedNavigationNode[]> {
  const { link, document } = resolved
  if (link.scope === 'document') return []

  const inWorkspace = await deps.uow.repos.documents.listByWorkspace(document.workspaceId)
  const eligible = inWorkspace.filter(
    (row) => row.collectionId === document.collectionId && row.headRevision !== null,
  )
  const byParent = Map.groupBy(eligible, (row) => row.parentId)

  const build = (parentId: DocumentId): readonly SharedNavigationNode[] =>
    (byParent.get(parentId) ?? [])
      .toSorted((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
      .map((row) => ({
        id: row.id,
        shortId: row.shortId,
        title: row.title,
        slug: row.slug,
        children: build(row.id),
      }))

  return build(document.id)
}

async function audit(
  deps: ShareLinkDependencies,
  event: {
    readonly type: string
    readonly actorUserId: UserId | null
    readonly targetId: string
    readonly metadata: Readonly<Record<string, unknown>>
  },
): Promise<void> {
  await deps.uow.repos.audit.write({
    id: deps.ids.uuid(),
    type: event.type,
    actorUserId: event.actorUserId,
    targetType: SHARE_LINK_TARGET,
    targetId: event.targetId,
    metadata: event.metadata,
    now: deps.clock.now(),
  })
}
