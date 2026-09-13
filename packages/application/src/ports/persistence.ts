import type {
  DocumentId,
  DocumentStatus,
  Role,
  RevisionId,
  ShareLinkId as DomainShareLinkId,
  ShareLinkScope,
  ShortId,
  UserId,
  WorkspaceId,
} from '@quill/domain'

import type { RenderedContent } from './document-format.ts'

/**
 * Repository ports for everything the server persists in Postgres (plan
 * section 11; ADR-012 tenancy; ADR-021 drafts and locking).
 *
 * `packages/domain` does not yet declare entities for units, groups,
 * sessions, or grants (another stream is adding them concurrently), so the
 * row shapes below are owned by this port rather than imported from the
 * domain. They use the identifier types the domain already exports
 * (`DocumentId`, `WorkspaceId`, `UserId`, `RevisionId`, `Role`,
 * `DocumentStatus`) and plain `string` ids for the rest. When the domain
 * gains branded ids for units, groups, and sessions, these `string` aliases
 * become straightforward re-exports.
 */

export type UnitId = string
export type GroupId = string
export type CollectionId = string
export type SessionId = string
export type MagicLinkId = string
export type GrantId = string
/**
 * Already branded in the domain, which owns share links as principals
 * (ADR-012), so this is the re-export the note above anticipates rather than
 * a second, weaker alias.
 */
export type ShareLinkId = DomainShareLinkId

// ---------------------------------------------------------------------------
// Users, credentials, sessions, magic links
// ---------------------------------------------------------------------------

export interface UserRow {
  readonly id: UserId
  readonly email: string
  readonly displayName: string
  readonly emailVerifiedAt: Date | null
  readonly isInstanceAdmin: boolean
  readonly createdAt: Date
}

export interface CreateUserInput {
  readonly id: UserId
  readonly email: string
  readonly displayName: string
  readonly now: Date
}

export interface UserRepository {
  create(input: CreateUserInput): Promise<UserRow>
  findById(id: UserId): Promise<UserRow | null>
  findByEmail(email: string): Promise<UserRow | null>
  markEmailVerified(id: UserId, now: Date): Promise<void>
  setInstanceAdmin(id: UserId, isInstanceAdmin: boolean): Promise<void>
}

export interface CredentialRow {
  readonly userId: UserId
  readonly passwordHash: string
  readonly updatedAt: Date
}

export interface CredentialRepository {
  upsert(input: {
    readonly userId: UserId
    readonly passwordHash: string
    readonly now: Date
  }): Promise<void>
  findByUserId(userId: UserId): Promise<CredentialRow | null>
  delete(userId: UserId): Promise<void>
}

export interface SessionRow {
  readonly id: SessionId
  readonly userId: UserId
  /**
   * SHA-256 of the token the cookie carries, so a database read never yields
   * a usable session (ADR-011). Null only for rows written before the column
   * existed — migrations are expand-only (ADR-033) — and such a row can no
   * longer be presented, because no lookup can reach it.
   */
  readonly tokenHash: string | null
  readonly createdAt: Date
  /** Last authenticated request on this session: the input to the idle timeout. */
  readonly lastSeenAt: Date | null
  readonly expiresAt: Date
}

export interface SessionRepository {
  create(input: {
    readonly id: SessionId
    readonly userId: UserId
    readonly tokenHash: string
    readonly now: Date
    readonly expiresAt: Date
  }): Promise<SessionRow>
  findById(id: SessionId): Promise<SessionRow | null>
  /** The only way a presented cookie reaches its row: by the hash of its token. */
  findByTokenHash(tokenHash: string): Promise<SessionRow | null>
  /** Stamps `lastSeenAt`, which is what the idle timeout measures from. */
  touch(id: SessionId, now: Date): Promise<void>
  /** Newest first, for the "your sessions" list in account settings. */
  listForUser(userId: UserId): Promise<readonly SessionRow[]>
  delete(id: SessionId): Promise<void>
  /** Rotates every session for a user, used on password change and privilege change. */
  deleteAllForUser(userId: UserId): Promise<void>
  /** "Sign out everywhere else": keeps the session making the request and drops the rest. */
  deleteAllForUserExcept(userId: UserId, keep: SessionId): Promise<void>
  /**
   * Removes every session past either clock, answering how many went.
   *
   * `authenticate` already deletes a session it finds past a clock, but only
   * a session somebody presents: a row nobody comes back for is never read
   * again and would otherwise sit there for ever, holding a user id, a token
   * hash, and any lock that cascades from it. The two cutoffs are the
   * absolute and idle deadlines, computed by the caller from its own
   * configuration, so this never has to know a policy.
   */
  deleteExpired(input: { readonly now: Date; readonly idleCutoff: Date }): Promise<number>
}

export type MagicLinkPurpose = 'sign-in' | 'email-verification' | 'password-reset'

export interface MagicLinkTokenRow {
  readonly id: MagicLinkId
  readonly userId: UserId
  readonly tokenHash: string
  readonly purpose: MagicLinkPurpose
  /**
   * SHA-256 of the secret handed to the browser that asked for this link, so
   * consuming it needs that browser or an explicit confirmation (ADR-011).
   * Null for a token issued before the column existed (ADR-033), which is
   * therefore consumable without one.
   */
  readonly bindingHash: string | null
  readonly expiresAt: Date
  readonly consumedAt: Date | null
  readonly createdAt: Date
}

export interface MagicLinkRepository {
  create(input: {
    readonly id: MagicLinkId
    readonly userId: UserId
    readonly tokenHash: string
    readonly purpose: MagicLinkPurpose
    /** Omitted only by a caller that has no browser to bind to. */
    readonly bindingHash?: string | null
    readonly now: Date
    readonly expiresAt: Date
  }): Promise<MagicLinkTokenRow>
  findByTokenHash(tokenHash: string): Promise<MagicLinkTokenRow | null>
  /** Marks the token consumed if, and only if, it was not already. Single use (ADR-023/plan §23). */
  consume(id: MagicLinkId, now: Date): Promise<boolean>
  /**
   * Retires every unconsumed token a user holds for one purpose, so issuing
   * a newer link invalidates the older ones (ADR-011). Answers how many it
   * retired, which is what an audit event records.
   */
  supersede(userId: UserId, purpose: MagicLinkPurpose, now: Date): Promise<number>
  /**
   * Removes every token that is spent or past its expiry, answering how many
   * went. A consumed token is already useless and an expired one is refused
   * on sight, so keeping either is keeping a hash of a credential for no
   * reason (ADR-011).
   */
  deleteSpent(now: Date): Promise<number>
}

// ---------------------------------------------------------------------------
// Tenancy: units and workspaces
// ---------------------------------------------------------------------------

export interface UnitRow {
  readonly id: UnitId
  readonly parentId: UnitId | null
  readonly name: string
  readonly slug: string
  /** The administrator's noun for this level, such as "company" or "team" (ADR-012). */
  readonly label: string
  readonly createdAt: Date
}

export interface UnitRepository {
  create(input: {
    readonly id: UnitId
    readonly parentId: UnitId | null
    readonly name: string
    readonly slug: string
    readonly label: string
    readonly now: Date
  }): Promise<UnitRow>
  findById(id: UnitId): Promise<UnitRow | null>
  listChildren(parentId: UnitId | null): Promise<readonly UnitRow[]>
  /**
   * The unit and every unit above it, nearest first, in one query: permission
   * resolution walks this chain on every request and must never do so one
   * `findById` at a time.
   */
  listAncestors(id: UnitId): Promise<readonly UnitRow[]>
  rename(id: UnitId, name: string): Promise<UnitRow>
  delete(id: UnitId): Promise<void>
}

export interface GroupRow {
  readonly id: GroupId
  readonly unitId: UnitId
  readonly parentGroupId: GroupId | null
  readonly name: string
  readonly createdAt: Date
}

export interface GroupRepository {
  create(input: {
    readonly id: GroupId
    readonly unitId: UnitId
    readonly parentGroupId: GroupId | null
    readonly name: string
    readonly now: Date
  }): Promise<GroupRow>
  findById(id: GroupId): Promise<GroupRow | null>
  addMember(input: {
    readonly groupId: GroupId
    readonly userId: UserId
    readonly now: Date
  }): Promise<void>
  removeMember(input: { readonly groupId: GroupId; readonly userId: UserId }): Promise<void>
  /**
   * Every group the user belongs to, plus every group those nest inside, in
   * one query. A grant to "Engineering" reaches "Engineering / Platform"
   * without duplicating memberships (ADR-012), and resolving that must not
   * cost one round trip per level.
   */
  listForUser(userId: UserId): Promise<readonly GroupRow[]>
}

export interface WorkspaceRow {
  readonly id: WorkspaceId
  readonly unitId: UnitId
  readonly name: string
  readonly slug: string
  readonly createdAt: Date
}

export interface WorkspaceRepository {
  create(input: {
    readonly id: WorkspaceId
    readonly unitId: UnitId
    readonly name: string
    readonly slug: string
    readonly now: Date
  }): Promise<WorkspaceRow>
  findById(id: WorkspaceId): Promise<WorkspaceRow | null>
  findBySlug(slug: string): Promise<WorkspaceRow | null>
  listByUnit(unitId: UnitId): Promise<readonly WorkspaceRow[]>
  /**
   * Every workspace on the instance, in one query.
   *
   * The workspace picker has to decide visibility across the whole tree, and
   * asking unit by unit would be a round trip per level (`listVisibleWorkspaces`).
   * Ordering is left to the caller, which sorts by unit path and then name.
   */
  listAll(): Promise<readonly WorkspaceRow[]>
  /**
   * Renames a workspace, and moves its slug when one is given.
   *
   * The slug is the workspace's public address (ADR-035), so moving it is a
   * deliberate second instruction rather than a consequence of renaming:
   * omitting it leaves the slug exactly where it was.
   */
  rename(id: WorkspaceId, name: string, slug?: string): Promise<WorkspaceRow>
  delete(id: WorkspaceId): Promise<void>
}

/** A slug a workspace used to answer to, and still redirects from (ADR-035). */
export interface WorkspaceSlugHistoryRow {
  readonly workspaceId: WorkspaceId
  readonly slug: string
  readonly retiredAt: Date
}

/**
 * The slugs workspaces have stopped using.
 *
 * A workspace slug is in every link anybody has ever pasted, so moving one
 * leaves a forwarding address rather than a dead link. A slug is claimed by
 * at most one workspace at a time and the newest claim wins, which is what
 * lets a slug be retired, taken by another workspace, and retired again.
 */
export interface WorkspaceSlugHistoryRepository {
  record(input: {
    readonly workspaceId: WorkspaceId
    readonly slug: string
    readonly now: Date
  }): Promise<void>
  /** The workspace a retired slug still points at; entries retired before `cutoff` have expired. */
  findBySlug(slug: string, cutoff: Date): Promise<WorkspaceSlugHistoryRow | null>
}

export interface CollectionRow {
  readonly id: CollectionId
  readonly workspaceId: WorkspaceId
  readonly name: string
  readonly slug: string
  readonly createdAt: Date
}

/**
 * Collections are first-level containers in a workspace and a permission
 * scope of their own, not ordinary folders (ADR-012).
 */
export interface CollectionRepository {
  create(input: {
    readonly id: CollectionId
    readonly workspaceId: WorkspaceId
    readonly name: string
    readonly slug: string
    readonly now: Date
  }): Promise<CollectionRow>
  findById(id: CollectionId): Promise<CollectionRow | null>
  findBySlug(workspaceId: WorkspaceId, slug: string): Promise<CollectionRow | null>
  listByWorkspace(workspaceId: WorkspaceId): Promise<readonly CollectionRow[]>
  /**
   * Renames a collection. The slug is deliberately not touched: documents are
   * addressed by id (AGENTS.md rule 8), so a rename is a display change and
   * nothing that points at this collection has to move.
   */
  rename(id: CollectionId, name: string): Promise<CollectionRow>
  delete(id: CollectionId): Promise<void>
  /**
   * How many documents this collection holds.
   *
   * Deleting a collection that still holds documents would take them out of
   * the permission tree — `collection_id` is nullable, and a document outside
   * a collection cannot be resolved at all — so the count is the guard.
   */
  countDocuments(id: CollectionId): Promise<number>
}

// ---------------------------------------------------------------------------
// Documents and drafts
// ---------------------------------------------------------------------------

export interface DocumentRow {
  readonly id: DocumentId
  /** The stable, ten-character public handle this document is also addressed by (ADR-035). */
  readonly shortId: ShortId
  readonly workspaceId: WorkspaceId
  readonly collectionId: CollectionId | null
  readonly parentId: DocumentId | null
  readonly slug: string
  readonly path: string
  readonly title: string
  readonly status: DocumentStatus
  readonly templateId: string | null
  readonly templateVersion: number | null
  /** The revision this document was last published at, or null before its first publish. */
  readonly headRevision: RevisionId | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface CreateDocumentInput {
  readonly id: DocumentId
  readonly shortId: ShortId
  readonly workspaceId: WorkspaceId
  readonly collectionId: CollectionId | null
  readonly parentId: DocumentId | null
  readonly slug: string
  readonly path: string
  readonly title: string
  readonly status: DocumentStatus
  readonly templateId: string | null
  readonly templateVersion: number | null
  readonly now: Date
}

export interface UpdateDocumentPatch {
  readonly title?: string
  readonly slug?: string
  readonly path?: string
  readonly status?: DocumentStatus
  readonly parentId?: DocumentId | null
  readonly collectionId?: CollectionId | null
  readonly headRevision?: RevisionId | null
}

/**
 * What a creation attempt met: the row, or the constraint that refused it.
 *
 * The two refusals are acted on differently — a taken path means try the next
 * candidate path, a taken key means draw another key — so they are told apart
 * here rather than by reading a driver's error code (ADR-035).
 */
export type CreateDocumentOutcome =
  | { readonly kind: 'created'; readonly document: DocumentRow }
  | { readonly kind: 'path-taken' }
  | { readonly kind: 'short-id-taken' }

export interface DocumentRepository {
  create(input: CreateDocumentInput): Promise<DocumentRow>
  /**
   * Creates a document unless its path or its short key is already taken.
   *
   * Both are claimed by the insert itself, behind the unique
   * `(workspace_id, path)` and `short_id` indexes, so two documents created
   * with the same title at the same moment cannot both take the same path,
   * two keys drawn at the same moment cannot both be claimed, and the caller
   * never has to read a driver's error code to find out which one lost.
   */
  createIfAvailable(input: CreateDocumentInput): Promise<CreateDocumentOutcome>
  findById(id: DocumentId): Promise<DocumentRow | null>
  /** The document a short key names, wherever on the instance it lives (ADR-035). */
  findByShortId(shortId: ShortId): Promise<DocumentRow | null>
  /** Resolving a body's short-key links must cost one query, not one per link. */
  listByShortIds(shortIds: readonly ShortId[]): Promise<readonly DocumentRow[]>
  findByPath(workspaceId: WorkspaceId, path: string): Promise<DocumentRow | null>
  listByWorkspace(workspaceId: WorkspaceId): Promise<readonly DocumentRow[]>
  /** Resolving a body's outgoing links must cost one query, not one per link. */
  listByIds(ids: readonly DocumentId[]): Promise<readonly DocumentRow[]>
  /**
   * The document and every document it nests under, nearest first, in one
   * query — the ancestor half of a document's scope chain (ADR-012).
   */
  listAncestors(id: DocumentId): Promise<readonly DocumentRow[]>
  update(id: DocumentId, patch: UpdateDocumentPatch, now: Date): Promise<DocumentRow>
  delete(id: DocumentId): Promise<void>
}

export interface DraftRow {
  readonly documentId: DocumentId
  readonly draftVersion: number
  readonly baseRevision: RevisionId | null
  readonly ast: unknown
  readonly updatedAt: Date
}

export type WriteDraftResult =
  | { readonly ok: true; readonly draft: DraftRow }
  | { readonly ok: false; readonly reason: 'lock_lost'; readonly holder: DocumentLockRow | null }
  | { readonly ok: false; readonly reason: 'stale_version'; readonly currentVersion: number }
  | { readonly ok: false; readonly reason: 'not_found' }

export interface DraftRepository {
  init(input: {
    readonly documentId: DocumentId
    readonly baseRevision: RevisionId | null
    readonly ast: unknown
    readonly now: Date
  }): Promise<DraftRow>
  find(documentId: DocumentId): Promise<DraftRow | null>
  /**
   * Optimistic, lock-gated write (ADR-021). Must run lock validation and the
   * version check inside one transaction so a concurrent takeover cannot
   * interleave between them — see `docs/research/r05-draft-locking.md`.
   */
  write(input: {
    readonly documentId: DocumentId
    readonly sessionId: SessionId
    readonly expectedVersion: number
    readonly ast: unknown
    readonly now: Date
  }): Promise<WriteDraftResult>
  /**
   * Moves the draft onto a new base. A publish makes the revision it created
   * the draft's base, so the next publish is not spuriously stale (ADR-015,
   * ADR-021).
   *
   * `ast` replaces the draft's content as well, which is what a restore does:
   * the author carries on from the revision that was restored instead of
   * holding content that would undo it on their next publish. Replacing the
   * content bumps the draft version, so an editor that was open when the
   * restore happened is told its write is stale and re-reads (ADR-021);
   * leaving the content alone leaves the version alone with it.
   */
  rebase(input: {
    readonly documentId: DocumentId
    readonly baseRevision: RevisionId | null
    readonly ast?: unknown
    readonly now: Date
  }): Promise<DraftRow | null>
}

// ---------------------------------------------------------------------------
// Document locks (ADR-021)
// ---------------------------------------------------------------------------

/**
 * Lock lifetime: no heartbeat within this window and the lock is stale
 * (ADR-021). It lives on the port rather than in an adapter because the
 * in-memory fake and the SQL adapter must agree on it exactly — the ratio of
 * the two constants is what tolerates two to three dropped heartbeats.
 */
export const LOCK_TTL_MS = 60_000

/** Recommended client heartbeat interval (ADR-021). */
export const LOCK_HEARTBEAT_MS = 15_000

export interface DocumentLockRow {
  readonly documentId: DocumentId
  readonly holderUserId: UserId
  readonly holderSessionId: SessionId
  readonly acquiredAt: Date
  readonly lastHeartbeatAt: Date
  readonly expiresAt: Date
}

export type AcquireLockResult =
  | { readonly ok: true; readonly lock: DocumentLockRow }
  | { readonly ok: false; readonly reason: 'held'; readonly holder: DocumentLockRow }

export type HeartbeatResult =
  | { readonly ok: true; readonly lock: DocumentLockRow }
  | { readonly ok: false; readonly reason: 'expired'; readonly holder: DocumentLockRow }
  | { readonly ok: false; readonly reason: 'taken_over'; readonly holder: DocumentLockRow }
  | { readonly ok: false; readonly reason: 'released' }

/**
 * Release always succeeds (ADR-021): it is the `sendBeacon` target on
 * navigation, and a beacon cannot read a response, so "you were not the
 * holder" is not something anybody could act on. Releasing a lock somebody
 * else holds deletes nothing and is reported the same way as releasing one
 * that had already expired.
 */
export type ReleaseLockResult = { readonly ok: true }

export type TakeoverResult = { readonly ok: true; readonly lock: DocumentLockRow }

/**
 * Acquire, heartbeat, release, and admin takeover exactly as validated by
 * research R5 and specified in ADR-021: a single
 * `INSERT ... ON CONFLICT DO UPDATE ... WHERE` for acquire, a heartbeat that
 * fails closed on independent expiry, idempotent release, and an
 * unconditional upsert for admin takeover. `now` is always supplied by the
 * caller so the implementation never reads the wall clock itself.
 */
export interface LockRepository {
  acquire(input: {
    readonly documentId: DocumentId
    readonly userId: UserId
    readonly sessionId: SessionId
    readonly now: Date
  }): Promise<AcquireLockResult>
  heartbeat(input: {
    readonly documentId: DocumentId
    readonly sessionId: SessionId
    readonly now: Date
  }): Promise<HeartbeatResult>
  release(input: {
    readonly documentId: DocumentId
    readonly sessionId: SessionId
  }): Promise<ReleaseLockResult>
  adminTakeover(input: {
    readonly documentId: DocumentId
    readonly userId: UserId
    readonly sessionId: SessionId
    readonly now: Date
  }): Promise<TakeoverResult>
  find(documentId: DocumentId): Promise<DocumentLockRow | null>
}

// ---------------------------------------------------------------------------
// Grants (ADR-012)
// ---------------------------------------------------------------------------

export type ScopeKind = 'instance' | 'unit' | 'workspace' | 'collection' | 'document'
export type PrincipalKind = 'user' | 'group' | 'public' | 'share_link'
export type GrantEffect = 'allow' | 'deny'

export interface GrantRow {
  readonly id: GrantId
  readonly principalKind: PrincipalKind
  /** Null only for the `public` principal, which is a singleton. */
  readonly principalId: string | null
  readonly scopeKind: ScopeKind
  /** Null only for `scopeKind: 'instance'`, which is a singleton scope. */
  readonly scopeId: string | null
  readonly role: Role
  readonly effect: GrantEffect
  readonly createdBy: UserId | null
  readonly createdAt: Date
}

export interface CreateGrantInput {
  readonly id: GrantId
  readonly principalKind: PrincipalKind
  readonly principalId: string | null
  readonly scopeKind: ScopeKind
  readonly scopeId: string | null
  readonly role: Role
  readonly effect: GrantEffect
  readonly createdBy: UserId | null
  readonly now: Date
}

/** One entry of a scope chain, as a repository key. */
export interface ScopeSelector {
  readonly kind: ScopeKind
  /** Null only for `instance`, which is a singleton scope. */
  readonly id: string | null
}

export interface GrantRepository {
  create(input: CreateGrantInput): Promise<GrantRow>
  delete(id: GrantId): Promise<void>
  listForScope(scopeKind: ScopeKind, scopeId: string | null): Promise<readonly GrantRow[]>
  /**
   * Every grant attached anywhere on a scope chain, in one query. Permission
   * resolution needs the whole chain on every request, so asking scope by
   * scope would be a round trip per level of the tree.
   */
  listForScopes(scopes: readonly ScopeSelector[]): Promise<readonly GrantRow[]>
  listForPrincipal(
    principalKind: PrincipalKind,
    principalId: string | null,
  ): Promise<readonly GrantRow[]>
}

// ---------------------------------------------------------------------------
// Share links (plan section 14; ADR-011 hashed tokens; ADR-012 principals)
// ---------------------------------------------------------------------------

/**
 * One share link.
 *
 * `tokenHash` is the SHA-256 of the token the link carries, and is the only
 * form of it that exists anywhere after the response that created it: a
 * database read yields nothing replayable (ADR-011). The raw token is
 * returned once, by `createShareLink`, and never again.
 */
export interface ShareLinkRow {
  readonly id: ShareLinkId
  readonly documentId: DocumentId
  readonly tokenHash: string
  readonly scope: ShareLinkScope
  readonly role: Role
  /** Null for a link that never expires. */
  readonly expiresAt: Date | null
  readonly createdBy: UserId
  readonly revokedAt: Date | null
  readonly createdAt: Date
  /** When the link was last followed, so a list can show it (use case 26). */
  readonly lastUsedAt: Date | null
}

export interface CreateShareLinkInput {
  readonly id: ShareLinkId
  readonly documentId: DocumentId
  readonly tokenHash: string
  readonly scope: ShareLinkScope
  readonly role: Role
  readonly expiresAt: Date | null
  readonly createdBy: UserId
  readonly now: Date
}

export interface ShareLinkRepository {
  create(input: CreateShareLinkInput): Promise<ShareLinkRow>
  /**
   * The link a presented token names, whatever state it is in.
   *
   * Expiry and revocation are decided above this port, by the domain against
   * an injected clock, so that a refusal is a rule rather than a query a
   * caller might forget to write.
   */
  findByTokenHash(tokenHash: string): Promise<ShareLinkRow | null>
  findById(id: ShareLinkId): Promise<ShareLinkRow | null>
  /** Newest first: a list of links is read as a history of who shared what. */
  listForDocument(documentId: DocumentId): Promise<readonly ShareLinkRow[]>
  /** Idempotent: a link already revoked keeps the instant it was first revoked. */
  revoke(id: ShareLinkId, now: Date): Promise<ShareLinkRow | null>
  /** Records that the link was followed. Never fails a read that has already succeeded. */
  markUsed(id: ShareLinkId, now: Date): Promise<void>
}

// ---------------------------------------------------------------------------
// Revisions index (ADR-014: the fast path for history, not a cache)
// ---------------------------------------------------------------------------

export interface RevisionIndexRow {
  readonly id: string
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly revision: RevisionId
  readonly authorName: string
  readonly authorEmail: string
  readonly timestamp: Date
  readonly summary: string
  readonly changeNote: string | null
  readonly createdAt: Date
}

export interface AppendRevisionInput {
  readonly id: string
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly revision: RevisionId
  readonly authorName: string
  readonly authorEmail: string
  readonly timestamp: Date
  readonly summary: string
  readonly changeNote: string | null
  readonly now: Date
}

/** A page of history. `limit` is mandatory: history without one is O(total revisions) (ADR-014). */
export interface HistoryPage {
  readonly limit: number
  /** The id of the last row of the previous page. */
  readonly cursor?: string | undefined
}

export interface RevisionsIndexRepository {
  append(input: AppendRevisionInput): Promise<RevisionIndexRow>
  /** Newest first. */
  listForDocument(documentId: DocumentId, page: HistoryPage): Promise<readonly RevisionIndexRow[]>
  latestForDocument(documentId: DocumentId): Promise<RevisionIndexRow | null>
  /**
   * One revision of one document, or null when this document never had it.
   *
   * A revision a caller names has to be checked against the document's own
   * history before the content store is asked for it: a revision from another
   * document, or one that never existed, is a bad request rather than a
   * failure to read.
   */
  findForDocument(documentId: DocumentId, revision: RevisionId): Promise<RevisionIndexRow | null>
}

// ---------------------------------------------------------------------------
// Render cache and document links (ADR-031)
// ---------------------------------------------------------------------------

/**
 * One rendered body, addressed by what it was rendered from (ADR-031).
 *
 * The row carries no document identity: the key is a hash of the render
 * input and the render version, so two documents whose Markdown and link
 * titles are identical — in the same workspace or in different ones — share
 * one entry legitimately. `documentId` is provenance, recording which
 * document first produced the entry so garbage collection can follow a
 * deletion; nothing reads it to decide what an entry means.
 */
export interface RenderCacheRow {
  /** `<render input hash>:<render version>`; a publish produces a new key (ADR-031). */
  readonly key: string
  readonly documentId: DocumentId
  readonly contentHash: string
  readonly renderVersion: number
  readonly content: RenderedContent
  readonly createdAt: Date
  readonly lastReadAt: Date
}

export interface SaveRenderInput {
  readonly key: string
  readonly documentId: DocumentId
  readonly contentHash: string
  readonly renderVersion: number
  readonly content: RenderedContent
  readonly now: Date
}

export interface RenderCacheRepository {
  /** Reads an entry and stamps it as read, so garbage collection by age of last read has its input. */
  find(key: string, now: Date): Promise<RenderCacheRow | null>
  save(input: SaveRenderInput): Promise<void>
}

export type DocumentLinkKind = 'document' | 'external' | 'internal'

export interface NewDocumentLink {
  /** Set when the link points at a document that exists; null leaves it broken. */
  readonly targetDocumentId: DocumentId | null
  readonly url: string
  readonly text: string
  readonly kind: DocumentLinkKind
}

export interface DocumentLinkRow extends NewDocumentLink {
  readonly id: string
  readonly sourceDocumentId: DocumentId
}

export interface DocumentLinksRepository {
  /** One publish replaces a document's links outright; there is no partial update. */
  replaceForDocument(input: {
    readonly documentId: DocumentId
    readonly links: readonly NewDocumentLink[]
    readonly idFor: (index: number) => string
  }): Promise<void>
  listForDocument(documentId: DocumentId): Promise<readonly DocumentLinkRow[]>
  /** The documents whose bodies point at this one: backlinks, and rename invalidation. */
  listSourcesTargeting(documentId: DocumentId): Promise<readonly DocumentId[]>
}

// ---------------------------------------------------------------------------
// Outbox and audit
// ---------------------------------------------------------------------------

export interface OutboxEventRow {
  readonly id: string
  readonly type: string
  readonly payload: unknown
  readonly createdAt: Date
  readonly availableAt: Date
  readonly processedAt: Date | null
  readonly attempts: number
  readonly lastError: string | null
}

/** Written in the same transaction as the change that produced the event (plan §22). */
export interface OutboxWriter {
  write(input: {
    readonly id: string
    readonly type: string
    readonly payload: unknown
    readonly now: Date
  }): Promise<void>
}

export interface AuditEventRow {
  readonly id: string
  readonly type: string
  readonly actorUserId: UserId | null
  readonly targetType: string
  readonly targetId: string
  readonly metadata: unknown
  readonly createdAt: Date
}

export interface AuditWriter {
  write(input: {
    readonly id: string
    readonly type: string
    readonly actorUserId: UserId | null
    readonly targetType: string
    readonly targetId: string
    readonly metadata: unknown
    readonly now: Date
  }): Promise<void>
}

// ---------------------------------------------------------------------------
// Unit of work
// ---------------------------------------------------------------------------

export interface RepositoryBundle {
  readonly users: UserRepository
  readonly sessions: SessionRepository
  readonly credentials: CredentialRepository
  readonly magicLinks: MagicLinkRepository
  readonly units: UnitRepository
  readonly groups: GroupRepository
  readonly workspaces: WorkspaceRepository
  readonly workspaceSlugHistory: WorkspaceSlugHistoryRepository
  readonly collections: CollectionRepository
  readonly documents: DocumentRepository
  readonly drafts: DraftRepository
  readonly locks: LockRepository
  readonly grants: GrantRepository
  readonly shareLinks: ShareLinkRepository
  readonly revisions: RevisionsIndexRepository
  readonly renderCache: RenderCacheRepository
  readonly documentLinks: DocumentLinksRepository
  readonly outbox: OutboxWriter
  readonly audit: AuditWriter
}

/**
 * Runs a callback in one database transaction, exposing repositories bound
 * to it, so a change and its outbox event are always committed together.
 * `repos` exposes the same repositories bound to the pool directly, for
 * reads that do not need transactional isolation.
 */
export interface UnitOfWork {
  readonly repos: RepositoryBundle
  run<T>(fn: (repos: RepositoryBundle) => Promise<T>): Promise<T>
}
