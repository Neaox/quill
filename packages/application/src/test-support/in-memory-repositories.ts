import type { DocumentId, ShortId, UserId } from '@quill/domain'

import type {
  AttachmentRepository,
  AttachmentRow,
  AuditEventRow,
  AuditWriter,
  CollectionRepository,
  CollectionRow,
  CredentialRepository,
  CredentialRow,
  DocumentLinkRow,
  DocumentLinksRepository,
  DocumentLockRow,
  DocumentViewRepository,
  DocumentViewRow,
  DocumentRepository,
  DocumentSummaryRepository,
  DocumentSummaryRow,
  DocumentRow,
  DraftRepository,
  DraftRow,
  GrantRepository,
  GrantRow,
  GroupRepository,
  GroupRow,
  IdentityRepository,
  IdentityRow,
  LockRepository,
  MagicLinkRepository,
  MagicLinkTokenRow,
  NotificationRepository,
  NotificationRow,
  OutboxEventRow,
  OutboxWriter,
  PersonPreferencesRepository,
  PersonPreferencesRow,
  PublicRedirectRepository,
  PublicRedirectRow,
  RenderCacheRepository,
  RenderCacheRow,
  RepositoryBundle,
  ReviewAssignmentRow,
  ReviewRepository,
  ReviewRequestRow,
  RevisionIndexRow,
  RevisionsIndexRepository,
  SecretCursor,
  SecretRow,
  SecretsRepository,
  SessionRepository,
  SessionRow,
  ShareLinkRepository,
  ShareLinkRow,
  UnitOfWork,
  UnitRepository,
  UnitRow,
  UserRepository,
  UserRow,
  WorkspaceRepository,
  WorkspaceRow,
  WorkspaceSlugHistoryRepository,
  WorkspaceSlugHistoryRow,
} from '../ports/index.ts'
import { LOCK_TTL_MS } from '../ports/index.ts'

/**
 * An entirely in-memory `UnitOfWork`, so a use case can be unit-tested
 * without a database.
 *
 * It is the whole `RepositoryBundle`, which is what lets a test drive a use
 * case exactly as the server does. `run` does not roll back on a thrown
 * error: these tests exercise business rules, not transactional isolation,
 * which the Postgres-backed implementation's own integration tests cover.
 */
export interface InMemoryUnitOfWork extends UnitOfWork {
  /** Every outbox event written, in order, so a test can assert what a use case emitted. */
  readonly events: readonly OutboxEventRow[]
  /**
   * Every audit row written, in order.
   *
   * ADR-011 asks for an audit trail without secrets in it, which is only a
   * rule if something checks: a test asserts both that the row is there and
   * that nothing sensitive is in it.
   */
  /** Every audit row written, in order, for the use cases whose trail is part of their behaviour (ADR-011). */
  readonly auditEvents: readonly AuditEventRow[]
  /** Every attachment state a revision replaced, oldest first: the attachments' history. */
  readonly attachmentHistory: readonly AttachmentRow[]
  /** What the search projection would hold for each published document (ADR-054); a test sets it. */
  readonly summaries: Map<DocumentId, DocumentSummaryRow>
  /** Drops a document's draft row, as a document imported or seeded without one has none. */
  forgetDraft(documentId: DocumentId): void
}

/** The `(created_at, name)` order the secrets rotation pages by. */
const compareSecretCursors = (left: SecretCursor, right: SecretCursor): number =>
  left.createdAt.getTime() - right.createdAt.getTime() || left.name.localeCompare(right.name)

/** Collections in name order, compared by code point, for the listings the port says are by name. */
const byName = (a: CollectionRow, b: CollectionRow): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0

/** The key the unique index on `(site_slug, path)` makes, as one string. */
const redirectKey = (siteSlug: string, path: string): string => JSON.stringify([siteSlug, path])

/** The key the unique index on `(issuer, subject)` makes, as one string. */
function identityKey(issuer: string, subject: string): string {
  return JSON.stringify([issuer, subject])
}

const isActiveReview = (row: ReviewRequestRow): boolean => row.closedAt === null
const newestFirst = (left: ReviewRequestRow, right: ReviewRequestRow): number =>
  right.createdAt.getTime() - left.createdAt.getTime() || (left.id < right.id ? 1 : -1)
const matchesName = (name: string, query: string): boolean =>
  name.toLowerCase().includes(query.toLowerCase())

export function createInMemoryUnitOfWork(): InMemoryUnitOfWork {
  const users = new Map<string, UserRow>()
  const usersByEmail = new Map<string, string>()
  const credentials = new Map<string, CredentialRow>()
  const sessions = new Map<string, SessionRow>()
  const magicLinks = new Map<string, MagicLinkTokenRow>()
  const magicLinksByHash = new Map<string, string>()
  /** Keyed by `(issuer, subject)`, which is what the unique index enforces. */
  const identities = new Map<string, IdentityRow>()
  const units = new Map<string, UnitRow>()
  const workspaces = new Map<string, WorkspaceRow>()
  const retiredSlugs = new Map<string, WorkspaceSlugHistoryRow>()
  const documents = new Map<string, DocumentRow>()
  const drafts = new Map<string, DraftRow>()
  const locks = new Map<string, DocumentLockRow>()
  const grants = new Map<string, GrantRow>()
  const shareLinks = new Map<string, ShareLinkRow>()
  const groups = new Map<string, GroupRow>()
  const memberships = new Map<UserId, Set<string>>()
  const collections = new Map<string, CollectionRow>()
  const revisions: RevisionIndexRow[] = []
  const renders = new Map<string, RenderCacheRow>()
  /** Keyed by `(siteSlug, path)`, which is what the unique index enforces. */
  const publicRedirects = new Map<string, PublicRedirectRow>()
  const links = new Map<string, DocumentLinkRow[]>()
  const attachments = new Map<string, AttachmentRow>()
  const attachmentHistory: AttachmentRow[] = []
  const events: OutboxEventRow[] = []
  const auditEvents: AuditEventRow[] = []
  const secrets = new Map<string, SecretRow>()
  const personPreferences = new Map<string, PersonPreferencesRow>()
  const summaries = new Map<DocumentId, DocumentSummaryRow>()

  const documentSummaryRepository: DocumentSummaryRepository = {
    async listByIds(ids) {
      return ids.flatMap((id) => {
        const row = summaries.get(id)
        return row === undefined ? [] : [row]
      })
    },
  }
  const reviewRequests: ReviewRequestRow[] = []
  const reviewAssignments: ReviewAssignmentRow[] = []
  /** Keyed by `(userId, documentId)`, which is what the primary key makes unique. */
  const documentViews = new Map<string, DocumentViewRow>()
  const notifications: NotificationRow[] = []

  const userRepository: UserRepository = {
    async create(input) {
      const row: UserRow = {
        id: input.id,
        email: input.email,
        displayName: input.displayName,
        emailVerifiedAt: null,
        isInstanceAdmin: false,
        createdAt: input.now,
      }
      users.set(row.id, row)
      usersByEmail.set(row.email, row.id)
      return row
    },
    async findById(id) {
      return users.get(id) ?? null
    },
    async listByIds(ids) {
      return ids.flatMap((id) => users.get(id) ?? [])
    },
    async findByEmail(email) {
      const id = usersByEmail.get(email)
      // `usersByEmail` and `users` are always written together in `create`, so a hit here always
      // has a row — the `?? null` fallback exists only to satisfy the return type.
      /* v8 ignore next */
      return id === undefined ? null : (users.get(id) ?? null)
    },
    async findVerifiedByEmails(emails) {
      const wanted = new Set(emails.map((email) => email.toLowerCase()))
      return [...users.values()].filter(
        (user) => user.emailVerifiedAt !== null && wanted.has(user.email.toLowerCase()),
      )
    },
    async searchVerified(query, limit) {
      const needle = query.toLowerCase()
      return [...users.values()]
        .filter(
          (user) =>
            user.emailVerifiedAt !== null &&
            (user.displayName.toLowerCase().includes(needle) ||
              user.email.toLowerCase().includes(needle)),
        )
        .toSorted((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, limit)
    },
    async searchByPrefix(query, limit) {
      const prefix = query.toLowerCase()
      return [...users.values()]
        .filter(
          (user) =>
            user.displayName.toLowerCase().startsWith(prefix) ||
            user.email.toLowerCase().startsWith(prefix),
        )
        .toSorted((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, limit)
    },
    async markEmailVerified(id, now) {
      const existing = users.get(id)
      if (existing !== undefined) {
        users.set(id, { ...existing, emailVerifiedAt: now })
      }
    },
    async setInstanceAdmin(id, isInstanceAdmin) {
      const existing = users.get(id)
      if (existing !== undefined) {
        users.set(id, { ...existing, isInstanceAdmin })
      }
    },
  }

  const credentialRepository: CredentialRepository = {
    async upsert({ userId, passwordHash, now }) {
      credentials.set(userId, { userId, passwordHash, updatedAt: now })
    },
    async findByUserId(userId) {
      return credentials.get(userId) ?? null
    },
    async delete(userId) {
      credentials.delete(userId)
    },
  }

  /**
   * Deleting a session releases the locks it holds, because the schema says
   * so: `document_locks.holder_session_id` references `sessions.id` with
   * `ON DELETE CASCADE`, so a signed-out or rotated session never leaves a
   * lock nobody can heartbeat sitting on a document (ADR-021). The fake has
   * to do it by hand or a use-case test would disagree with the database.
   */
  function dropSession(id: string): void {
    sessions.delete(id)
    for (const [documentId, lock] of locks) {
      if (lock.holderSessionId === id) locks.delete(documentId)
    }
  }

  const sessionRepository: SessionRepository = {
    async create({ id, userId, tokenHash, now, expiresAt }) {
      const row: SessionRow = {
        id,
        userId,
        tokenHash,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
      }
      sessions.set(id, row)
      return row
    },
    async findById(id) {
      return sessions.get(id) ?? null
    },
    async findByTokenHash(tokenHash) {
      for (const row of sessions.values()) {
        if (row.tokenHash === tokenHash) return row
      }
      return null
    },
    async touch(id, now) {
      const existing = sessions.get(id)
      if (existing !== undefined) {
        sessions.set(id, { ...existing, lastSeenAt: now })
      }
    },
    async listForUser(userId) {
      return [...sessions.values()]
        .filter((row) => row.userId === userId)
        .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    },
    async delete(id) {
      dropSession(id)
    },
    async deleteAllForUser(userId) {
      for (const [id, row] of sessions) {
        if (row.userId === userId) {
          dropSession(id)
        }
      }
    },
    async deleteAllForUserExcept(userId, keep) {
      for (const [id, row] of sessions) {
        if (row.userId === userId && id !== keep) {
          dropSession(id)
        }
      }
    },
    async deleteExpired({ now, idleCutoff }) {
      let removed = 0
      for (const [id, row] of sessions) {
        // The `??` is the expand-only migration's fallback (ADR-033); this
        // fake always stamps `lastSeenAt`, so only the left side can happen
        // here and the database adapter's own test covers the other.
        /* v8 ignore next */
        const idleFrom = row.lastSeenAt ?? row.createdAt
        if (row.expiresAt <= now || idleFrom <= idleCutoff) {
          dropSession(id)
          removed += 1
        }
      }
      return removed
    },
  }

  const magicLinkRepository: MagicLinkRepository = {
    async create({ id, userId, tokenHash, purpose, bindingHash = null, now, expiresAt }) {
      const row: MagicLinkTokenRow = {
        id,
        userId,
        tokenHash,
        purpose,
        bindingHash,
        expiresAt,
        consumedAt: null,
        createdAt: now,
      }
      magicLinks.set(id, row)
      magicLinksByHash.set(tokenHash, id)
      return row
    },
    async findByTokenHash(tokenHash) {
      const id = magicLinksByHash.get(tokenHash)
      // `magicLinksByHash` and `magicLinks` are always written together in `create`, so a hit
      // here always has a row — the `?? null` fallback exists only to satisfy the return type.
      /* v8 ignore next */
      return id === undefined ? null : (magicLinks.get(id) ?? null)
    },
    async consume(id, now) {
      const existing = magicLinks.get(id)
      if (existing === undefined || existing.consumedAt !== null) {
        return false
      }
      magicLinks.set(id, { ...existing, consumedAt: now })
      return true
    },
    async supersede(userId, purpose, now) {
      let retired = 0
      for (const [id, row] of magicLinks) {
        if (row.userId === userId && row.purpose === purpose && row.consumedAt === null) {
          magicLinks.set(id, { ...row, consumedAt: now })
          retired += 1
        }
      }
      return retired
    },
    async deleteSpent(now) {
      let removed = 0
      for (const [id, row] of magicLinks) {
        if (row.consumedAt !== null || row.expiresAt <= now) {
          magicLinks.delete(id)
          magicLinksByHash.delete(row.tokenHash)
          removed += 1
        }
      }
      return removed
    },
  }

  const identityRepository: IdentityRepository = {
    async findBySubject(issuer, subject) {
      return identities.get(identityKey(issuer, subject)) ?? null
    },
    async listForUser(userId) {
      return [...identities.values()].filter((row) => row.userId === userId)
    },
    async link(input) {
      const key = identityKey(input.issuer, input.subject)
      const existing = identities.get(key)
      // First writer wins, as the unique index makes it in Postgres.
      if (existing !== undefined) return existing
      const row: IdentityRow = {
        id: input.id,
        userId: input.userId,
        providerId: input.providerId,
        issuer: input.issuer,
        subject: input.subject,
        createdAt: input.now,
        lastSignInAt: null,
      }
      identities.set(key, row)
      return row
    },
    async touch(id, now) {
      for (const [key, row] of identities) {
        if (row.id === id) identities.set(key, { ...row, lastSignInAt: now })
      }
    },
  }

  const unitRepository: UnitRepository = {
    async create({ id, parentId, name, slug, label, now }) {
      const row: UnitRow = { id, parentId, name, slug, label, createdAt: now }
      units.set(id, row)
      return row
    },
    async findById(id) {
      return units.get(id) ?? null
    },
    async listChildren(parentId) {
      return [...units.values()].filter((unit) => unit.parentId === parentId)
    },
    async listAncestors(id) {
      const chain: UnitRow[] = []
      const seen = new Set<string>()
      let current: string | null = id
      while (current !== null && !seen.has(current)) {
        seen.add(current)
        const unit: UnitRow | undefined = units.get(current)
        if (unit === undefined) break
        chain.push(unit)
        current = unit.parentId
      }
      return chain
    },
    async listAll() {
      return [...units.values()]
    },
    async rename(id, name) {
      const existing = units.get(id)
      if (existing === undefined) {
        throw new Error(`rename: unit ${id} not found`)
      }
      const updated = { ...existing, name }
      units.set(id, updated)
      return updated
    },
    async delete(id) {
      units.delete(id)
    },
  }

  const workspaceRepository: WorkspaceRepository = {
    async create({ id, unitId, name, slug, now }) {
      const row: WorkspaceRow = { id, unitId, name, slug, createdAt: now }
      workspaces.set(id, row)
      return row
    },
    async findById(id) {
      return workspaces.get(id) ?? null
    },
    async findBySlug(slug) {
      return [...workspaces.values()].find((workspace) => workspace.slug === slug) ?? null
    },
    async listByUnit(unitId) {
      return [...workspaces.values()].filter((workspace) => workspace.unitId === unitId)
    },
    async listAll() {
      return [...workspaces.values()]
    },
    async rename(id, name, slug) {
      const existing = workspaces.get(id)
      if (existing === undefined) {
        throw new Error(`rename: workspace ${id} not found`)
      }
      const updated = { ...existing, name, ...(slug === undefined ? {} : { slug }) }
      workspaces.set(id, updated)
      return updated
    },
    async delete(id) {
      workspaces.delete(id)
    },
  }

  const workspaceSlugHistoryRepository: WorkspaceSlugHistoryRepository = {
    async record({ workspaceId, slug, now }) {
      retiredSlugs.set(slug, { workspaceId, slug, retiredAt: now })
    },
    async findBySlug(slug, cutoff) {
      const entry = retiredSlugs.get(slug)
      return entry === undefined || entry.retiredAt.getTime() < cutoff.getTime() ? null : entry
    },
  }

  const documentRepository: DocumentRepository = {
    async create(input) {
      const row: DocumentRow = {
        ...input,
        headRevision: null,
        createdBy: input.createdBy ?? null,
        updatedBy: null,
        createdAt: input.now,
        updatedAt: input.now,
      }
      documents.set(row.id, row)
      return row
    },
    async createIfAvailable(input) {
      const pathTaken = [...documents.values()].some(
        (doc) => doc.workspaceId === input.workspaceId && doc.path === input.path,
      )
      if (pathTaken) return { kind: 'path-taken' }
      const keyTaken = [...documents.values()].some((doc) => doc.shortId === input.shortId)
      if (keyTaken) return { kind: 'short-id-taken' }
      return { kind: 'created', document: await documentRepository.create(input) }
    },
    async findById(id) {
      return documents.get(id) ?? null
    },
    async findByShortId(shortId) {
      return [...documents.values()].find((doc) => doc.shortId === shortId) ?? null
    },
    async listByShortIds(shortIds) {
      const wanted = new Set<ShortId>(shortIds)
      return [...documents.values()].filter((doc) => wanted.has(doc.shortId))
    },
    async findByPath(workspaceId, path) {
      return (
        [...documents.values()].find(
          (doc) => doc.workspaceId === workspaceId && doc.path === path,
        ) ?? null
      )
    },
    async listByWorkspace(workspaceId) {
      return [...documents.values()].filter((doc) => doc.workspaceId === workspaceId)
    },
    async listByCollection(collectionId) {
      return [...documents.values()].filter((doc) => doc.collectionId === collectionId)
    },
    async listByIds(ids) {
      return ids.flatMap((id) => {
        const row = documents.get(id)
        return row === undefined ? [] : [row]
      })
    },
    async listAncestors(id) {
      const chain: DocumentRow[] = []
      const seen = new Set<string>()
      let current: DocumentId | null = id
      while (current !== null && !seen.has(current)) {
        seen.add(current)
        const row: DocumentRow | undefined = documents.get(current)
        if (row === undefined) break
        chain.push(row)
        current = row.parentId
      }
      return chain
    },
    async listDescendants(id, depth) {
      const found: DocumentRow[] = []
      let level: readonly DocumentId[] = [id]
      for (let reached = 0; reached < depth && level.length > 0; reached += 1) {
        const parents = new Set(level)
        const next = [...documents.values()].filter(
          (doc) => doc.parentId !== null && parents.has(doc.parentId),
        )
        found.push(...next)
        level = next.map((doc) => doc.id)
      }
      return found
    },
    async update(id, patch, now) {
      const existing = documents.get(id)
      if (existing === undefined) {
        throw new Error(`update: document ${id} not found`)
      }
      const updated = { ...existing, ...patch, updatedAt: now }
      documents.set(id, updated)
      return updated
    },
    async delete(id) {
      documents.delete(id)
    },
  }

  const draftRepository: DraftRepository = {
    async init({ documentId, baseRevision, ast, now }) {
      const row: DraftRow = { documentId, draftVersion: 0, baseRevision, ast, updatedAt: now }
      drafts.set(documentId, row)
      return row
    },
    async find(documentId) {
      return drafts.get(documentId) ?? null
    },
    async stamp(documentId) {
      const draft = drafts.get(documentId)
      return draft === undefined
        ? null
        : { baseRevision: draft.baseRevision, updatedAt: draft.updatedAt }
    },
    async write({ documentId, sessionId, expectedVersion, ast, now }) {
      const lock = locks.get(documentId) ?? null
      const holdsValidLock =
        lock !== null && lock.holderSessionId === sessionId && lock.expiresAt >= now
      if (!holdsValidLock) {
        return { ok: false, reason: 'lock_lost', holder: lock }
      }
      const draft = drafts.get(documentId)
      if (draft === undefined) {
        return { ok: false, reason: 'not_found' }
      }
      if (draft.draftVersion !== expectedVersion) {
        return { ok: false, reason: 'stale_version', currentVersion: draft.draftVersion }
      }
      const updated: DraftRow = {
        ...draft,
        ast,
        draftVersion: draft.draftVersion + 1,
        updatedAt: now,
      }
      drafts.set(documentId, updated)
      return { ok: true, draft: updated }
    },
    async rebase({ documentId, baseRevision, ast, now }) {
      const draft = drafts.get(documentId)
      if (draft === undefined) return null
      const updated: DraftRow = {
        ...draft,
        baseRevision,
        updatedAt: now,
        // Replacing the content bumps the version, so an editor that was open
        // when a restore landed is told its next write is stale (ADR-021).
        ...(ast === undefined ? {} : { ast, draftVersion: draft.draftVersion + 1 }),
      }
      drafts.set(documentId, updated)
      return updated
    },
  }

  const lockRepository: LockRepository = {
    async acquire({ documentId, userId, sessionId, now }) {
      const existing = locks.get(documentId)
      if (
        existing !== undefined &&
        existing.expiresAt >= now &&
        existing.holderSessionId !== sessionId
      ) {
        return { ok: false, reason: 'held', holder: existing }
      }
      const lock: DocumentLockRow = {
        documentId,
        holderUserId: userId,
        holderSessionId: sessionId,
        acquiredAt: now,
        lastHeartbeatAt: now,
        expiresAt: new Date(now.getTime() + LOCK_TTL_MS),
      }
      locks.set(documentId, lock)
      return { ok: true, lock }
    },
    async heartbeat({ documentId, sessionId, now }) {
      const existing = locks.get(documentId)
      if (existing === undefined) {
        return { ok: false, reason: 'released' }
      }
      if (existing.holderSessionId !== sessionId) {
        return { ok: false, reason: 'taken_over', holder: existing }
      }
      if (existing.expiresAt < now) {
        return { ok: false, reason: 'expired', holder: existing }
      }
      const updated = {
        ...existing,
        lastHeartbeatAt: now,
        expiresAt: new Date(now.getTime() + LOCK_TTL_MS),
      }
      locks.set(documentId, updated)
      return { ok: true, lock: updated }
    },
    async release({ documentId, sessionId }) {
      const existing = locks.get(documentId)
      if (existing !== undefined && existing.holderSessionId === sessionId) {
        locks.delete(documentId)
      }
      // Idempotent and unconditional: release is also a beacon target, and a
      // beacon cannot read a response (ADR-021).
      return { ok: true }
    },
    async adminTakeover({ documentId, userId, sessionId, now }) {
      const lock: DocumentLockRow = {
        documentId,
        holderUserId: userId,
        holderSessionId: sessionId,
        acquiredAt: now,
        lastHeartbeatAt: now,
        expiresAt: new Date(now.getTime() + LOCK_TTL_MS),
      }
      locks.set(documentId, lock)
      return { ok: true, lock }
    },
    async find(documentId) {
      return locks.get(documentId) ?? null
    },
  }

  const grantRepository: GrantRepository = {
    async create(input) {
      const row: GrantRow = { ...input, createdAt: input.now }
      grants.set(row.id, row)
      return row
    },
    async delete(id) {
      grants.delete(id)
    },
    async listForScope(scopeKind, scopeId) {
      return [...grants.values()].filter(
        (grant) => grant.scopeKind === scopeKind && grant.scopeId === scopeId,
      )
    },
    async listForScopes(scopes) {
      const wanted = new Set(scopes.map((scope) => `${scope.kind}:${scope.id ?? ''}`))
      return [...grants.values()].filter((grant) =>
        wanted.has(`${grant.scopeKind}:${grant.scopeId ?? ''}`),
      )
    },
    async listForPrincipal(principalKind, principalId) {
      return [...grants.values()].filter(
        (grant) => grant.principalKind === principalKind && grant.principalId === principalId,
      )
    },
  }

  const groupRepository: GroupRepository = {
    async create({ id, unitId, parentGroupId, name, now }) {
      const row: GroupRow = { id, unitId, parentGroupId, name, createdAt: now }
      groups.set(id, row)
      return row
    },
    async findById(id) {
      return groups.get(id) ?? null
    },
    async list() {
      return [...groups.values()]
    },
    async countMembers() {
      const counts = new Map<string, number>()
      for (const held of memberships.values()) {
        for (const groupId of held) counts.set(groupId, (counts.get(groupId) ?? 0) + 1)
      }
      return counts
    },
    async countChildren(id) {
      return [...groups.values()].filter((group) => group.parentGroupId === id).length
    },
    async listMemberIds(groupId) {
      return [...memberships].filter(([, held]) => held.has(groupId)).map(([member]) => member)
    },
    async rename(id, name) {
      const existing = groups.get(id)
      if (existing === undefined) throw new Error(`rename: group ${id} not found`)
      const updated = { ...existing, name }
      groups.set(id, updated)
      return updated
    },
    async delete(id) {
      groups.delete(id)
      for (const held of memberships.values()) held.delete(id)
    },
    async addMember({ groupId, userId: member }) {
      const current = memberships.get(member) ?? new Set<string>()
      current.add(groupId)
      memberships.set(member, current)
    },
    async removeMember({ groupId, userId: member }) {
      memberships.get(member)?.delete(groupId)
    },
    async listForUser(member) {
      const found = new Map<string, GroupRow>()
      for (const start of memberships.get(member) ?? []) {
        let current: string | null = start
        while (current !== null && !found.has(current)) {
          const group: GroupRow | undefined = groups.get(current)
          if (group === undefined) break
          found.set(current, group)
          current = group.parentGroupId
        }
      }
      return [...found.values()]
    },
  }

  const collectionRepository: CollectionRepository = {
    async create({ id, workspaceId, name, slug, now }) {
      const row: CollectionRow = {
        id,
        workspaceId,
        name,
        slug,
        createdAt: now,
        publicSite: null,
      }
      collections.set(id, row)
      return row
    },
    async findById(id) {
      return collections.get(id) ?? null
    },
    async findBySlug(workspaceId, slug) {
      return (
        [...collections.values()].find(
          (row) => row.workspaceId === workspaceId && row.slug === slug,
        ) ?? null
      )
    },
    async findBySiteSlug(siteSlug) {
      return [...collections.values()].find((row) => row.publicSite?.siteSlug === siteSlug) ?? null
    },
    async listByWorkspace(workspaceId) {
      return [...collections.values()]
        .filter((row) => row.workspaceId === workspaceId)
        .toSorted(byName)
    },
    async listByIds(ids) {
      return ids.flatMap((id) => {
        const row = collections.get(id)
        return row === undefined ? [] : [row]
      })
    },
    async searchByName(text, limit) {
      const needle = text.toLocaleLowerCase()
      return [...collections.values()]
        .filter((row) => row.name.toLocaleLowerCase().includes(needle))
        .toSorted(byName)
        .slice(0, limit)
    },
    async listPublicSites() {
      const sites = [...collections.values()].flatMap((row) =>
        row.publicSite?.enabled === true ? [{ row, slug: row.publicSite.siteSlug }] : [],
      )
      return sites.toSorted((a, b) => a.slug.localeCompare(b.slug)).map((site) => site.row)
    },
    async setPublicSite(id, publicSite) {
      const existing = collections.get(id)
      /* v8 ignore next 3 -- every caller has just read the row it is updating. */
      if (existing === undefined) {
        throw new Error(`setPublicSite: collection ${id} not found`)
      }
      // The unique index on the address, as the database enforces it.
      for (const row of collections.values()) {
        if (row.id !== id && row.publicSite?.siteSlug === publicSite.siteSlug) {
          return { kind: 'slug-taken' }
        }
      }
      const updated = { ...existing, publicSite }
      collections.set(id, updated)
      return { kind: 'written', collection: updated }
    },
    async rename(id, name) {
      const existing = collections.get(id)
      if (existing === undefined) {
        throw new Error(`rename: collection ${id} not found`)
      }
      const updated = { ...existing, name }
      collections.set(id, updated)
      return updated
    },
    async delete(id) {
      collections.delete(id)
    },
    async countDocuments(id) {
      return [...documents.values()].filter((document) => document.collectionId === id).length
    },
  }

  const publicRedirectRepository: PublicRedirectRepository = {
    async record({ id, siteSlug, path, documentId, now }) {
      publicRedirects.set(redirectKey(siteSlug, path), {
        id,
        siteSlug,
        path,
        documentId,
        createdAt: now,
      })
    },
    async find(siteSlug, path) {
      return publicRedirects.get(redirectKey(siteSlug, path)) ?? null
    },
    async deleteAt(siteSlug, path) {
      publicRedirects.delete(redirectKey(siteSlug, path))
    },
    async deleteForSite(siteSlug) {
      for (const [key, row] of publicRedirects) {
        if (row.siteSlug === siteSlug) publicRedirects.delete(key)
      }
    },
  }

  const revisionsRepository: RevisionsIndexRepository = {
    async append(input) {
      const row: RevisionIndexRow = {
        ...input,
        authorUserId: input.authorUserId ?? null,
        createdAt: input.now,
      }
      revisions.unshift(row)
      return row
    },
    async listForDocument(documentId, page) {
      const all = revisions.filter((row) => row.documentId === documentId)
      const start =
        page.cursor === undefined ? 0 : all.findIndex((row) => row.id === page.cursor) + 1
      return all.slice(start, start + page.limit)
    },
    async latestForDocument(documentId) {
      return revisions.find((row) => row.documentId === documentId) ?? null
    },
    async listHeads(documentIds) {
      const wanted = new Set<string>(documentIds)
      const heads = new Map<string, RevisionIndexRow>()
      // `revisions` is newest first, so the first row seen for a document is
      // its head — which is what the adapter's `DISTINCT ON` produces too.
      for (const row of revisions) {
        if (wanted.has(row.documentId) && !heads.has(row.documentId)) heads.set(row.documentId, row)
      }
      return [...heads.values()]
    },
    async findForDocument(documentId, revision) {
      return (
        revisions.find((row) => row.documentId === documentId && row.revision === revision) ?? null
      )
    },
  }

  const renderCacheRepository: RenderCacheRepository = {
    async find(key, now) {
      const row = renders.get(key)
      if (row === undefined) return null
      const read: RenderCacheRow = { ...row, lastReadAt: now }
      renders.set(key, read)
      return read
    },
    async save(input) {
      renders.set(input.key, {
        key: input.key,
        documentId: input.documentId,
        contentHash: input.contentHash,
        renderVersion: input.renderVersion,
        content: input.content,
        createdAt: input.now,
        lastReadAt: input.now,
      })
    },
  }

  const documentLinksRepository: DocumentLinksRepository = {
    async replaceForDocument({ documentId, links: replacement, idFor }) {
      links.set(
        documentId,
        replacement.map((link, index) => ({
          ...link,
          id: idFor(index),
          sourceDocumentId: documentId,
        })),
      )
    },
    async listForDocument(documentId) {
      return links.get(documentId) ?? []
    },
    async listSourcesTargeting(documentId) {
      return [...links.entries()]
        .filter(([, rows]) => rows.some((row) => row.targetDocumentId === documentId))
        .map(([source]) => source as DocumentId)
    },
    async listSourcesReferencing(url, workspaceId) {
      return [...links.entries()]
        .filter(([source, rows]) => {
          if (!rows.some((row) => row.url === url)) return false
          return documents.get(source)?.workspaceId === workspaceId
        })
        .map(([source]) => source as DocumentId)
    },
  }

  const attachmentRepository: AttachmentRepository = {
    async create(input) {
      const row: AttachmentRow = {
        id: input.id,
        documentId: input.documentId,
        workspaceId: input.workspaceId,
        uploadedBy: input.uploadedBy,
        filename: input.filename,
        contentType: input.contentType,
        size: input.size,
        sha256: input.sha256,
        version: 1,
        searchText: input.searchText ?? null,
        createdAt: input.now,
        deletedAt: null,
      }
      attachments.set(row.id, row)
      return row
    },
    async findById(id) {
      return attachments.get(id) ?? null
    },
    async listForDocument(documentId) {
      return [...attachments.values()]
        .filter((row) => row.documentId === documentId && row.deletedAt === null)
        .toSorted((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    },
    async listLiveInWorkspace(workspaceId, ids) {
      const wanted = new Set(ids)
      return [...attachments.values()].filter(
        (row) => wanted.has(row.id) && row.workspaceId === workspaceId && row.deletedAt === null,
      )
    },
    async softDelete(id, now) {
      const row = attachments.get(id)
      if (row !== undefined && row.deletedAt === null)
        attachments.set(id, { ...row, deletedAt: now })
    },
    async revise(input) {
      const row = attachments.get(input.id)
      if (row === undefined || row.deletedAt !== null || row.version !== input.expectedVersion) {
        return null
      }
      attachmentHistory.push(row)
      const revised: AttachmentRow = {
        ...row,
        contentType: input.contentType,
        size: input.size,
        sha256: input.sha256,
        searchText: input.searchText,
        version: row.version + 1,
      }
      attachments.set(row.id, revised)
      return revised
    },
  }

  const outboxWriter: OutboxWriter = {
    async write({ id, type, payload, now }) {
      events.push({
        id,
        type,
        payload,
        createdAt: now,
        availableAt: now,
        processedAt: null,
        attempts: 0,
        lastError: null,
      })
    },
  }

  const shareLinkRepository: ShareLinkRepository = {
    async create(input) {
      const row: ShareLinkRow = {
        id: input.id,
        documentId: input.documentId,
        tokenHash: input.tokenHash,
        scope: input.scope,
        role: input.role,
        expiresAt: input.expiresAt,
        createdBy: input.createdBy,
        revokedAt: null,
        createdAt: input.now,
        lastUsedAt: null,
      }
      shareLinks.set(row.id, row)
      return row
    },
    async findByTokenHash(tokenHash) {
      return [...shareLinks.values()].find((row) => row.tokenHash === tokenHash) ?? null
    },
    async findById(id) {
      return shareLinks.get(id) ?? null
    },
    async listForDocument(documentId) {
      // `created_at DESC, id DESC`, exactly as the SQL orders it, so two
      // links created in the same instant come back the same way here as
      // they do from Postgres. Ids are UUIDs, so comparing them as strings
      // and comparing them as bytes agree.
      return [...shareLinks.values()]
        .filter((row) => row.documentId === documentId)
        .toSorted(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
        )
    },
    async revoke(id, now) {
      const existing = shareLinks.get(id)
      if (existing === undefined) return null
      // Idempotent, exactly as the SQL is: the first revocation is the one
      // that counts, so revoking twice does not move the instant.
      const revoked = { ...existing, revokedAt: existing.revokedAt ?? now }
      shareLinks.set(id, revoked)
      return revoked
    },
    async markUsed(id, now) {
      const existing = shareLinks.get(id)
      if (existing !== undefined) shareLinks.set(id, { ...existing, lastUsedAt: now })
    },
  }

  /** Every group nested inside `rootId`, itself included; a loop in the tree stops where it started. */
  function groupAndDescendants(rootId: string): ReadonlySet<string> {
    const found = new Set([rootId])
    for (let grew = true; grew;) {
      grew = false
      for (const group of groups.values()) {
        if (
          group.parentGroupId !== null &&
          found.has(group.parentGroupId) &&
          !found.has(group.id)
        ) {
          found.add(group.id)
          grew = true
        }
      }
    }
    return found
  }

  const reviewRepository: ReviewRepository = {
    async create(input) {
      const row: ReviewRequestRow = {
        id: input.id,
        documentId: input.documentId,
        requestedBy: input.requestedBy,
        draftVersion: input.draftVersion,
        message: input.message,
        status: 'open',
        createdAt: input.now,
        closedAt: null,
      }
      reviewRequests.push(row)
      for (const reviewer of input.reviewers) {
        reviewAssignments.push({
          id: reviewer.id,
          requestId: input.id,
          principalKind: reviewer.kind,
          principalId: reviewer.principalId,
          state: 'pending',
          decidedBy: null,
          comment: null,
          decidedAt: null,
        })
      }
      return row
    },
    async findById(id) {
      return reviewRequests.find((row) => row.id === id) ?? null
    },
    async findActiveForDocument(documentId) {
      return (
        reviewRequests.find((row) => row.documentId === documentId && isActiveReview(row)) ?? null
      )
    },
    async findLatestForDocument(documentId) {
      return (
        reviewRequests
          .filter((row) => row.documentId === documentId)
          .toSorted((left, right) =>
            isActiveReview(left) === isActiveReview(right)
              ? newestFirst(left, right)
              : isActiveReview(left)
                ? -1
                : 1,
          )[0] ?? null
      )
    },
    async setStatus(id, status, now) {
      const index = reviewRequests.findIndex((row) => row.id === id)
      const existing = reviewRequests[index]
      if (existing === undefined) return null
      const closing = status === 'withdrawn' || status === 'superseded' || status === 'published'
      const updated: ReviewRequestRow = {
        ...existing,
        status,
        closedAt: closing ? now : null,
      }
      reviewRequests[index] = updated
      return updated
    },
    async listAssignments(requestIds) {
      const wanted = new Set(requestIds)
      return reviewAssignments.filter((row) => wanted.has(row.requestId))
    },
    async recordDecision({ assignmentIds, state, decidedBy, comment, now }) {
      const wanted = new Set(assignmentIds)
      reviewAssignments.forEach((row, index) => {
        if (wanted.has(row.id)) {
          reviewAssignments[index] = { ...row, state, decidedBy, comment, decidedAt: now }
        }
      })
    },
    async listAwaiting({ userId, groupIds, limit }) {
      const held = new Set(groupIds)
      const waiting = new Set(
        reviewAssignments
          .filter(
            (row) =>
              row.state === 'pending' &&
              (row.principalKind === 'user'
                ? row.principalId === userId
                : held.has(row.principalId)),
          )
          .map((row) => row.requestId),
      )
      return reviewRequests
        .filter((row) => isActiveReview(row) && waiting.has(row.id) && row.requestedBy !== userId)
        .toSorted(newestFirst)
        .slice(0, limit)
    },
    async listAnswered({ userId, limit }) {
      return reviewRequests
        .filter(
          (row) =>
            row.requestedBy === userId &&
            (row.status === 'approved' || row.status === 'changes_requested'),
        )
        .toSorted(newestFirst)
        .slice(0, limit)
    },
    async searchPeople(query, limit) {
      return [...users.values()]
        .filter((user) => matchesName(user.displayName, query))
        .toSorted((left, right) => left.displayName.localeCompare(right.displayName))
        .slice(0, limit)
    },
    async searchGroups(query, limit) {
      return [...groups.values()]
        .filter((group) => matchesName(group.name, query))
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .slice(0, limit)
    },
    async countGroupMembers(groupIds) {
      const counts = new Map<string, number>()
      for (const groupId of groupIds) {
        const within = groupAndDescendants(groupId)
        const members = [...memberships].filter(([, held]) =>
          [...held].some((id) => within.has(id)),
        )
        if (members.length > 0) counts.set(groupId, members.length)
      }
      return counts
    },
    async listMemberIdsDeep(groupIds) {
      const within = new Set(groupIds.flatMap((groupId) => [...groupAndDescendants(groupId)]))
      return [...memberships]
        .filter(([, held]) => [...held].some((id) => within.has(id)))
        .map(([member]) => member)
    },
  }

  const auditWriter: AuditWriter = {
    async write({ id, type, actorUserId, targetType, targetId, metadata, now }) {
      auditEvents.push({
        id,
        type,
        actorUserId,
        targetType,
        targetId,
        metadata,
        createdAt: now,
      })
    },
  }

  const documentViewRepository: DocumentViewRepository = {
    async touch({ userId, documentId, workspaceId, now, debounceBefore }) {
      const key = JSON.stringify([userId, documentId])
      const existing = documentViews.get(key)
      if (existing !== undefined && existing.lastViewedAt.getTime() >= debounceBefore.getTime()) {
        return false
      }
      documentViews.set(key, {
        userId,
        documentId,
        workspaceId,
        lastViewedAt: now,
        views: (existing?.views ?? 0) + 1,
      })
      return true
    },
    async listRecent({ userId, since, limit }) {
      return [...documentViews.values()]
        .filter((row) => row.userId === userId && row.lastViewedAt.getTime() >= since.getTime())
        .toSorted((a, b) => b.lastViewedAt.getTime() - a.lastViewedAt.getTime())
        .slice(0, limit)
    },
    async sumByWorkspace({ userId, since }) {
      const mine = [...documentViews.values()].filter(
        (row) => row.userId === userId && row.lastViewedAt.getTime() >= since.getTime(),
      )
      return [...Map.groupBy(mine, (row) => row.workspaceId)].map(([workspaceId, rows]) => ({
        workspaceId,
        views: rows.reduce((sum, row) => sum + row.views, 0),
      }))
    },
    async deleteForUser(userId) {
      const doomed = [...documentViews].filter(([, row]) => row.userId === userId)
      for (const [key] of doomed) documentViews.delete(key)
      return doomed.length
    },
    async deleteOlderThan(cutoff) {
      const doomed = [...documentViews].filter(
        ([, row]) => row.lastViewedAt.getTime() < cutoff.getTime(),
      )
      for (const [key] of doomed) documentViews.delete(key)
      return doomed.length
    },
  }

  const notificationRepository: NotificationRepository = {
    async insertMany(rows) {
      let written = 0
      for (const row of rows) {
        const exists = notifications.some(
          (held) =>
            held.requestId === row.requestId &&
            held.recipientUserId === row.recipientUserId &&
            held.kind === row.kind &&
            held.actorUserId === row.actorUserId,
        )
        if (exists) continue
        notifications.push({ ...row, readAt: null })
        written += 1
      }
      return written
    },
    async markRequestKindRead({ requestId, kind, now }) {
      const unread = notifications.filter(
        (row) => row.requestId === requestId && row.kind === kind && row.readAt === null,
      )
      for (const row of unread) notifications[notifications.indexOf(row)] = { ...row, readAt: now }
      return unread.length
    },
    async listForUser({ userId, after, limit }) {
      return notifications
        .filter((row) => row.recipientUserId === userId)
        .toSorted(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
        )
        .filter(
          (row) =>
            after === null ||
            row.createdAt.getTime() < after.createdAt.getTime() ||
            (row.createdAt.getTime() === after.createdAt.getTime() && row.id < after.id),
        )
        .slice(0, limit)
    },
    async countUnread(userId) {
      return notifications.filter((row) => row.recipientUserId === userId && row.readAt === null)
        .length
    },
    async markRead({ userId, ids, now }) {
      const unread = notifications.filter(
        (row) =>
          row.recipientUserId === userId &&
          row.readAt === null &&
          (ids === undefined || ids.includes(row.id)),
      )
      for (const row of unread) notifications[notifications.indexOf(row)] = { ...row, readAt: now }
      return unread.length
    },
    async deleteOlderThan(cutoff) {
      const doomed = notifications.filter((row) => row.createdAt.getTime() < cutoff.getTime())
      for (const row of doomed) notifications.splice(notifications.indexOf(row), 1)
      return doomed.length
    },
  }

  const personPreferencesRepository: PersonPreferencesRepository = {
    async find(userId) {
      return personPreferences.get(userId) ?? null
    },
    async put({ userId, document, now }) {
      const row: PersonPreferencesRow = { userId, document, updatedAt: now }
      personPreferences.set(userId, row)
      return row
    },
  }

  /**
   * Secrets as they are stored: ciphertext and a wrapped key, never a value
   * (ADR-034). The fake keeps exactly the columns the table has, so a test of
   * rotation exercises the real "which key is this wrapped with" question.
   */
  const secretsRepository: SecretsRepository = {
    async find(name) {
      return secrets.get(name) ?? null
    },
    async list() {
      return [...secrets.values()]
        .map(({ name, keyId, createdAt, rotatedAt, rewrappedAt }) => ({
          name,
          keyId,
          createdAt,
          rotatedAt,
          rewrappedAt,
        }))
        .toSorted((left, right) => left.name.localeCompare(right.name))
    },
    async put({ name, ciphertext, wrappedKey, keyId, now }) {
      const existing = secrets.get(name)
      const row: SecretRow = {
        name,
        ciphertext,
        wrappedKey,
        keyId,
        createdAt: existing?.createdAt ?? now,
        rotatedAt: existing === undefined ? null : now,
        rewrappedAt: null,
      }
      secrets.set(name, row)
      return row
    },
    async rewrap({ name, fromKeyId, fromWrappedKey, wrappedKey, keyId, now }) {
      const existing = secrets.get(name)
      // The same compare-and-swap the real repository performs, so a test of
      // a rotation racing a replacement behaves the same here.
      if (
        existing === undefined ||
        existing.keyId !== fromKeyId ||
        existing.wrappedKey !== fromWrappedKey
      ) {
        return false
      }
      secrets.set(name, { ...existing, wrappedKey, keyId, rewrappedAt: now })
      return true
    },
    async delete(name) {
      return secrets.delete(name)
    },
    async listWrappedWithOther({ keyId, limit, after }) {
      const ordered = [...secrets.values()]
        .filter((row) => row.keyId !== keyId)
        .toSorted(compareSecretCursors)
      const beyond =
        after === undefined
          ? ordered
          : ordered.filter((row) => compareSecretCursors(row, after) > 0)
      return beyond.slice(0, limit)
    },
  }

  const repos: RepositoryBundle = {
    users: userRepository,
    sessions: sessionRepository,
    credentials: credentialRepository,
    magicLinks: magicLinkRepository,
    identities: identityRepository,
    units: unitRepository,
    groups: groupRepository,
    workspaces: workspaceRepository,
    workspaceSlugHistory: workspaceSlugHistoryRepository,
    collections: collectionRepository,
    documents: documentRepository,
    documentSummaries: documentSummaryRepository,
    drafts: draftRepository,
    locks: lockRepository,
    grants: grantRepository,
    shareLinks: shareLinkRepository,
    publicRedirects: publicRedirectRepository,
    revisions: revisionsRepository,
    renderCache: renderCacheRepository,
    documentLinks: documentLinksRepository,
    secrets: secretsRepository,
    attachments: attachmentRepository,
    personPreferences: personPreferencesRepository,
    reviews: reviewRepository,
    documentViews: documentViewRepository,
    notifications: notificationRepository,
    outbox: outboxWriter,
    audit: auditWriter,
  }

  return {
    repos,
    events,
    auditEvents,
    attachmentHistory,
    summaries,
    forgetDraft(documentId) {
      drafts.delete(documentId)
    },
    async run(fn) {
      return fn(repos)
    },
  }
}
