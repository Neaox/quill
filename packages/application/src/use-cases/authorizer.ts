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

import type {
  CollectionId,
  CollectionRepository,
  CollectionRow,
  DocumentRepository,
  DocumentRow,
  GrantRepository,
  GrantRow,
  GroupRepository,
  ScopeSelector,
  UnitRepository,
  UserRepository,
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

/** Who is asking. A request with no user is the public principal, plus a share link if it followed one. */
export interface RequestPrincipal {
  readonly userId: UserId | null
  readonly shareLinkId: ShareLinkId | null
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
  readonly isInstanceAdmin: boolean
}

export function createAuthorizer(
  repos: AuthorizerRepositories,
  principal: RequestPrincipal,
): Authorizer {
  let resolved: Promise<ResolvedIdentity> | null = null
  const chains = new Map<string, ScopeChain>()
  const documents = new Map<DocumentId, Promise<DocumentRow | null>>()
  const workspaces = new Map<WorkspaceId, Promise<WorkspaceRow | null>>()
  const collections = new Map<CollectionId, Promise<CollectionRow | null>>()
  const grantsByChain = new Map<string, Promise<readonly GrantRow[]>>()

  function requestIdentity(): Promise<ResolvedIdentity> {
    resolved ??= loadIdentity(repos, principal)
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
      grants: toGrants(grants),
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
): Promise<ResolvedIdentity> {
  // TODO(M3): share links arrive with M3 and bring a `ShareLinkRepository`
  // with them. Until a presented link can be looked up — does it exist, has it
  // been revoked, has it expired, does its scope cover what is being asked —
  // an id from the request is an unvalidated claim, and honouring it would
  // hand a role to anybody who can spell one. So it is dropped here rather
  // than carried into the identity, which narrows access and never widens it.
  const anonymous: ResolvedIdentity = {
    identity: { isAnonymous: true, shareLinkId: null },
    isInstanceAdmin: false,
  }
  if (principal.userId === null) return anonymous

  const [row, groups] = await Promise.all([
    repos.users.findById(principal.userId),
    repos.groups.listForUser(principal.userId),
  ])
  // A session that outlived its user falls back to the anonymous identity,
  // which narrows access rather than widening it: the safe direction.
  if (row === null) return anonymous
  const groupsById = new Map(groups.map((group) => [group.id as GroupId, toGroupEntity(group)]))
  return {
    identity: {
      isAnonymous: false,
      user: { id: row.id, name: row.displayName, email: row.email },
      groupIds: groupsById.keys(),
      groupsById,
      // See the note above: unvalidated until M3, so never honoured.
      shareLinkId: null,
    },
    isInstanceAdmin: row.isInstanceAdmin,
  }
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
