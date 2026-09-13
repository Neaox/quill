import {
  INSTANCE_SCOPE,
  buildScopeChain,
  buildUnitChain,
  capabilitiesForRole,
  collectionScope,
  documentScope,
  err,
  groupPrincipal,
  ok,
  principalIdentities,
  PUBLIC_PRINCIPAL,
  resolvePermission,
  shareLinkGrants,
  shareLinkPrincipal,
  unitScope,
  userPrincipal,
  workspaceScope,
} from '@quill/domain'
import type {
  Capabilities,
  CollectionId as DomainCollectionId,
  DocumentId,
  Grant,
  GroupId,
  Principal,
  RequestIdentity,
  Result,
  Role,
  Scope,
  ScopeChain,
  ScopeChainFailure,
  ShareLinkId,
  UnitId,
  UserId,
  WorkspaceId,
} from '@quill/domain'

import type { ResolvedShareLink, ShareLinkDependencies } from './share-links.ts'
import { resolveShareLink, toShareLink } from './share-links.ts'
import type {
  CollectionId,
  CollectionRepository,
  CollectionRow,
  DocumentRepository,
  DocumentRow,
  GrantRepository,
  GrantRow,
  GroupRepository,
  GroupRow,
  ScopeSelector,
  UnitRepository,
  UserRepository,
  UserRow,
  WorkspaceRepository,
  WorkspaceRow,
} from '../ports/persistence.ts'
import {
  documentsById,
  toCollectionEntity,
  toDocumentEntity,
  toGroupEntity,
  toWorkspaceEntity,
  unitsById,
} from './tenancy-entities.ts'

/**
 * The one place the platform decides what a request may do (ADR-012).
 *
 * It loads the scopes governing a document — the document, its ancestors, its
 * collection, its workspace, the units above it, the instance — together with
 * every grant attached anywhere on that chain, expands the request into the
 * principals it holds, and hands both to the domain resolver. Nothing above it
 * compares roles; routes ask for a capability and get an answer.
 *
 * One instance serves one request, and everything it loads is memoised on it:
 * the identity, the document and workspace rows, the scope chain, and the
 * grants attached to that chain. A route that authorises, reads, and then
 * builds an envelope pays for the walk once, and two checks of the same
 * document cost one query between them rather than one each.
 */

/**
 * Who is asking.
 *
 * A request with no user is the public principal. A request that arrived
 * through a share link also presents that link's *token* — the capability
 * itself, never an id — because an id in a request is a claim nobody has
 * checked, and checking it is this module's job (ADR-012).
 */
export interface RequestPrincipal {
  readonly userId: UserId | null
  readonly shareLinkToken: string | null
}

export interface Access {
  readonly role: Role | null
  readonly capabilities: Capabilities
  /** Instance admins bypass resolution entirely (ADR-012). */
  readonly isInstanceAdmin: boolean
}

export interface DocumentAccess extends Access {
  readonly document: DocumentRow
  readonly workspace: WorkspaceRow
}

export interface WorkspaceAccess extends Access {
  readonly workspace: WorkspaceRow
}

/**
 * A collection is a permission scope of its own (ADR-012), not a folder, so
 * "may this request manage things here?" has an answer that is not the
 * workspace's. Moving a document into a collection asks exactly that
 * question, and asking it of the workspace instead would let a deny at the
 * destination be stepped over (review finding H5).
 */
export interface CollectionAccess extends Access {
  readonly collection: CollectionRow
  readonly workspace: WorkspaceRow
}

export type AccessFailure =
  | { readonly kind: 'document-not-found'; readonly documentId: DocumentId }
  | { readonly kind: 'workspace-not-found'; readonly workspaceId: WorkspaceId }
  | { readonly kind: 'collection-not-found'; readonly collectionId: CollectionId }
  | {
      /** A document outside any collection cannot be placed in the permission tree. */
      readonly kind: 'document-without-collection'
      readonly documentId: DocumentId
    }
  | { readonly kind: 'broken-tree'; readonly failure: ScopeChainFailure }

export interface Authorizer {
  document(documentId: DocumentId): Promise<Result<DocumentAccess, AccessFailure>>
  workspace(workspaceId: WorkspaceId): Promise<Result<WorkspaceAccess, AccessFailure>>
  collection(collectionId: CollectionId): Promise<Result<CollectionAccess, AccessFailure>>
  /** Every principal this request holds, for filtering a list in one pass. */
  identities(): Promise<readonly Principal[]>
  /**
   * The share link this request presented, once it has been found and checked
   * against the clock, against revocation, and against policy — or null for
   * every reason it might not have been, which a caller answers identically
   * (ADR-011).
   *
   * It is here rather than beside the routes because this is where a
   * presented token is already resolved, and resolving it twice would be a
   * second lookup and a second chance for the two answers to differ.
   */
  shareLink(): Promise<ResolvedShareLink | null>
}

export interface AuthorizerRepositories {
  readonly users: UserRepository
  readonly groups: GroupRepository
  readonly units: UnitRepository
  readonly workspaces: WorkspaceRepository
  readonly collections: CollectionRepository
  readonly documents: DocumentRepository
  readonly grants: GrantRepository
}

const OWNER_ACCESS: Access = {
  role: 'owner',
  capabilities: capabilitiesForRole('owner'),
  isInstanceAdmin: true,
}

/** The identity of one request, resolved once and reused for every check it makes. */
interface ResolvedIdentity {
  readonly identity: RequestIdentity
  /** The valid link behind `identity.shareLinkId`, for the scope it carries. */
  readonly shareLink: ResolvedShareLink | null
  readonly isInstanceAdmin: boolean
}

/**
 * @param shareLinks what resolving a presented share-link token needs: the
 * clock it is checked against, the token service that hashes it, and the
 * policy that may forbid links altogether. Required rather than optional, so
 * that no composition root can quietly build an authorizer which ignores the
 * link a reader followed.
 */
export function createAuthorizer(
  repos: AuthorizerRepositories,
  principal: RequestPrincipal,
  shareLinks: ShareLinkDependencies,
): Authorizer {
  let resolved: Promise<ResolvedIdentity> | null = null
  const chains = new Map<string, ScopeChain>()
  const documents = new Map<DocumentId, Promise<DocumentRow | null>>()
  const workspaces = new Map<WorkspaceId, Promise<WorkspaceRow | null>>()
  const collections = new Map<CollectionId, Promise<CollectionRow | null>>()
  const grantsByChain = new Map<string, Promise<readonly GrantRow[]>>()

  function requestIdentity(): Promise<ResolvedIdentity> {
    resolved ??= loadIdentity(repos, principal, shareLinks)
    return resolved
  }

  /** The verdict for one chain: an instance admin's owner access, or what the grants say. */
  async function decide(chain: ScopeChain): Promise<Access> {
    const who = await requestIdentity()
    if (who.isInstanceAdmin) return OWNER_ACCESS
    const selectors = chain.map(toSelector)
    const grants = await memoise(grantsByChain, chainKey(selectors), () =>
      repos.grants.listForScopes(selectors),
    )
    const permission = resolvePermission({
      chain,
      identities: principalIdentities(who.identity),
      // A share link's allow is synthesised from the link rather than stored,
      // because the grants table cannot tell its two scopes apart: a stored
      // grant at a document is inherited by everything beneath it, which is
      // what `subtree` means and exactly what `document` must not do. Stored
      // grants still have the last word — a *deny* written against the link
      // closes that channel, and only that channel (ADR-012's amendment).
      grants: [
        ...toGrants(grants),
        ...(who.shareLink === null ? [] : shareLinkGrants(toShareLink(who.shareLink.link), chain)),
      ],
    })
    return {
      role: permission.role,
      capabilities: permission.capabilities,
      isInstanceAdmin: false,
    }
  }

  async function cachedChain(
    key: string,
    build: () => Promise<Result<ScopeChain, AccessFailure>>,
  ): Promise<Result<ScopeChain, AccessFailure>> {
    const cached = chains.get(key)
    if (cached !== undefined) return ok(cached)
    const built = await build()
    if (built.ok) chains.set(key, built.value)
    return built
  }

  return {
    async document(documentId) {
      const document = await memoise(documents, documentId, () =>
        repos.documents.findById(documentId),
      )
      if (document === null) return err({ kind: 'document-not-found', documentId })
      const workspace = await memoise(workspaces, document.workspaceId, () =>
        repos.workspaces.findById(document.workspaceId),
      )
      if (workspace === null) {
        return err({ kind: 'workspace-not-found', workspaceId: document.workspaceId })
      }

      const chain = await cachedChain(`document:${documentId}`, () =>
        documentChain(repos, document, workspace),
      )
      if (!chain.ok) return chain
      return ok({ document, workspace, ...(await decide(chain.value)) })
    },

    async workspace(workspaceId) {
      const workspace = await memoise(workspaces, workspaceId, () =>
        repos.workspaces.findById(workspaceId),
      )
      if (workspace === null) return err({ kind: 'workspace-not-found', workspaceId })

      const chain = await cachedChain(`workspace:${workspaceId}`, () =>
        workspaceChain(repos, workspace),
      )
      if (!chain.ok) return chain
      return ok({ workspace, ...(await decide(chain.value)) })
    },

    async collection(collectionId) {
      const collection = await memoise(collections, collectionId, () =>
        repos.collections.findById(collectionId),
      )
      if (collection === null) return err({ kind: 'collection-not-found', collectionId })
      const workspace = await memoise(workspaces, collection.workspaceId, () =>
        repos.workspaces.findById(collection.workspaceId),
      )
      if (workspace === null) {
        return err({ kind: 'workspace-not-found', workspaceId: collection.workspaceId })
      }

      const chain = await cachedChain(`collection:${collectionId}`, async () => {
        const above = await workspaceChain(repos, workspace)
        return above.ok
          ? ok([collectionScope(collectionId as DomainCollectionId), ...above.value])
          : above
      })
      if (!chain.ok) return chain
      return ok({ collection, workspace, ...(await decide(chain.value)) })
    },

    async identities() {
      return principalIdentities((await requestIdentity()).identity)
    },

    async shareLink() {
      return (await requestIdentity()).shareLink
    },
  }
}

/**
 * One load per key for the life of the request.
 *
 * Promises rather than values, so two checks started in the same tick share
 * the one query instead of racing to issue two.
 */
function memoise<K, V>(cache: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  const known = cache.get(key)
  if (known !== undefined) return known
  const loading = load()
  cache.set(key, loading)
  return loading
}

/** Two chains with the same scopes in the same order have the same grants. */
function chainKey(selectors: readonly ScopeSelector[]): string {
  return selectors.map((scope) => `${scope.kind}:${scope.id ?? ''}`).join('>')
}

async function loadIdentity(
  repos: AuthorizerRepositories,
  principal: RequestPrincipal,
  shareLinks: ShareLinkDependencies,
): Promise<ResolvedIdentity> {
  const [shareLink, account] = await Promise.all([
    loadShareLink(shareLinks, principal.shareLinkToken),
    loadAccount(repos, principal.userId),
  ])
  const shareLinkId = shareLink === null ? null : (shareLink.link.id as ShareLinkId)

  // A request with no user, and one whose session outlived its user, both
  // still hold the public principal and whatever link they followed. Falling
  // back to the anonymous identity narrows access rather than widening it:
  // the safe direction.
  if (account === null) {
    return { identity: { isAnonymous: true, shareLinkId }, shareLink, isInstanceAdmin: false }
  }

  const groupsById = new Map(
    account.groups.map((group) => [group.id as GroupId, toGroupEntity(group)]),
  )
  return {
    identity: {
      isAnonymous: false,
      user: { id: account.row.id, name: account.row.displayName, email: account.row.email },
      groupIds: groupsById.keys(),
      groupsById,
      shareLinkId,
    },
    shareLink,
    isInstanceAdmin: account.row.isInstanceAdmin,
  }
}

/**
 * The link a presented token names, or null.
 *
 * Every reason a token grants nothing — no such link, expired, revoked, or an
 * organisation that does not allow links at all — collapses to null here.
 * `resolveShareLink` tells them apart, which is what the audit log and an
 * administrator's list read; an identity has no use for the difference, and a
 * reader is answered identically for all four (ADR-011: no enumeration).
 */
async function loadShareLink(
  shareLinks: ShareLinkDependencies,
  token: string | null,
): Promise<ResolvedShareLink | null> {
  if (token === null) return null
  const resolved = await resolveShareLink(shareLinks, { token })
  return resolved.ok ? resolved.value : null
}

/** The signed-in user and the groups they are in, or null when there is no session. */
async function loadAccount(
  repos: AuthorizerRepositories,
  userId: UserId | null,
): Promise<{ readonly row: UserRow; readonly groups: readonly GroupRow[] } | null> {
  if (userId === null) return null
  const [row, groups] = await Promise.all([
    repos.users.findById(userId),
    repos.groups.listForUser(userId),
  ])
  return row === null ? null : { row, groups }
}

/** The document, its ancestors, its collection, its workspace, its units, the instance. */
async function documentChain(
  repos: AuthorizerRepositories,
  document: DocumentRow,
  workspace: WorkspaceRow,
): Promise<Result<ScopeChain, AccessFailure>> {
  if (document.collectionId === null) {
    return err({ kind: 'document-without-collection', documentId: document.id })
  }
  const [collection, ancestors, units] = await Promise.all([
    repos.collections.findById(document.collectionId),
    repos.documents.listAncestors(document.id),
    repos.units.listAncestors(workspace.unitId),
  ])
  if (collection === null) {
    return err({ kind: 'collection-not-found', collectionId: document.collectionId })
  }

  const chain = buildScopeChain({
    document: toDocumentEntity(document, document.collectionId),
    collection: toCollectionEntity(collection),
    workspace: toWorkspaceEntity(workspace),
    unitsById: unitsById(units),
    documentsById: documentsById(ancestors),
  })
  return chain.ok ? ok(chain.value) : err({ kind: 'broken-tree', failure: chain.error })
}

/** The workspace, its units, the instance: the chain for anything not yet a document. */
async function workspaceChain(
  repos: AuthorizerRepositories,
  workspace: WorkspaceRow,
): Promise<Result<ScopeChain, AccessFailure>> {
  const units = buildUnitChain(
    workspace.unitId as UnitId,
    unitsById(await repos.units.listAncestors(workspace.unitId)),
  )
  if (!units.ok) return err({ kind: 'broken-tree', failure: units.error })
  return ok([
    workspaceScope(workspace.id),
    ...units.value.map((unit) => unitScope(unit.id)),
    INSTANCE_SCOPE,
  ])
}

function toSelector(scope: Scope): ScopeSelector {
  switch (scope.kind) {
    case 'unit':
      return { kind: 'unit', id: scope.unitId }
    case 'workspace':
      return { kind: 'workspace', id: scope.workspaceId }
    case 'collection':
      return { kind: 'collection', id: scope.collectionId }
    case 'document':
      return { kind: 'document', id: scope.documentId }
    case 'instance':
      return { kind: 'instance', id: null }
  }
}

/**
 * Grant rows as domain grants, lazily.
 *
 * A row whose scope names no id outside `instance` scope, or whose principal
 * names none outside `public`, describes no scope and no principal that can
 * exist; it is dropped rather than guessed at, because guessing would mean
 * granting access on malformed data.
 */
export function* toGrants(rows: Iterable<GrantRow>): Generator<Grant> {
  for (const row of rows) {
    const scope = toScope(row)
    const principal = toPrincipal(row)
    if (scope !== null && principal !== null) {
      yield { principal, scope, role: row.role, effect: row.effect }
    }
  }
}

function toScope(row: GrantRow): Scope | null {
  if (row.scopeKind === 'instance') return INSTANCE_SCOPE
  if (row.scopeId === null) return null
  switch (row.scopeKind) {
    case 'unit':
      return unitScope(row.scopeId as UnitId)
    case 'workspace':
      return workspaceScope(row.scopeId as WorkspaceId)
    case 'collection':
      return collectionScope(row.scopeId as DomainCollectionId)
    case 'document':
      return documentScope(row.scopeId as DocumentId)
  }
}

function toPrincipal(row: GrantRow): Principal | null {
  if (row.principalKind === 'public') return PUBLIC_PRINCIPAL
  if (row.principalId === null) return null
  switch (row.principalKind) {
    case 'user':
      return userPrincipal(row.principalId as UserId)
    case 'group':
      return groupPrincipal(row.principalId as GroupId)
    case 'share_link':
      return shareLinkPrincipal(row.principalId as ShareLinkId)
  }
}
