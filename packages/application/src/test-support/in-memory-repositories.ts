import type { DocumentId, ShortId } from '@quill/domain'

import type {
  AuditEventRow,
  AuditWriter,
  CollectionRepository,
  CollectionRow,
  CredentialRepository,
  CredentialRow,
  DocumentLinkRow,
  DocumentLinksRepository,
  DocumentLockRow,
  DocumentRepository,
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
  OutboxEventRow,
  OutboxWriter,
  RenderCacheRepository,
  RenderCacheRow,
  RepositoryBundle,
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
  readonly auditEvents: readonly AuditEventRow[]
}

/** The `(created_at, name)` order the secrets rotation pages by. */
const compareSecretCursors = (left: SecretCursor, right: SecretCursor): number =>
  left.createdAt.getTime() - right.createdAt.getTime() || left.name.localeCompare(right.name)

/** The key the unique index on `(issuer, subject)` makes, as one string. */
function identityKey(issuer: string, subject: string): string {
  return JSON.stringify([issuer, subject])
}

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
  const memberships = new Map<string, Set<string>>()
  const collections = new Map<string, CollectionRow>()
  const revisions: RevisionIndexRow[] = []
  const renders = new Map<string, RenderCacheRow>()
  const links = new Map<string, DocumentLinkRow[]>()
  const events: OutboxEventRow[] = []
  const auditEvents: AuditEventRow[] = []
  const secrets = new Map<string, SecretRow>()

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
    async findByEmail(email) {
      const id = usersByEmail.get(email)
      // `usersByEmail` and `users` are always written together in `create`, so a hit here always
      // has a row — the `?? null` fallback exists only to satisfy the return type.
      /* v8 ignore next */
      return id === undefined ? null : (users.get(id) ?? null)
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
      const row: CollectionRow = { id, workspaceId, name, slug, createdAt: now }
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
    async listByWorkspace(workspaceId) {
      return [...collections.values()]
        .filter((row) => row.workspaceId === workspaceId)
        .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
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

  const revisionsRepository: RevisionsIndexRepository = {
    async append(input) {
      const row: RevisionIndexRow = { ...input, createdAt: input.now }
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
    drafts: draftRepository,
    locks: lockRepository,
    grants: grantRepository,
    shareLinks: shareLinkRepository,
    revisions: revisionsRepository,
    renderCache: renderCacheRepository,
    documentLinks: documentLinksRepository,
    secrets: secretsRepository,
    outbox: outboxWriter,
    audit: auditWriter,
  }

  return {
    repos,
    events,
    auditEvents,
    async run(fn) {
      return fn(repos)
    },
  }
}
