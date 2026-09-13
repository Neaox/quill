import { visibleDocumentIds } from '@quill/application'
import type { UnitOfWork, VisibilityFilter } from '@quill/application'
import { groupPrincipal, PUBLIC_PRINCIPAL, shareLinkPrincipal, userPrincipal } from '@quill/domain'
import type {
  DocumentId,
  GroupId,
  Principal,
  ShareLinkId,
  UserId,
  WorkspaceId,
} from '@quill/domain'

/**
 * What a search query may look at, resolved the way every other list resolves
 * it (ADR-012).
 *
 * A search crosses workspaces, so the question "which documents may this
 * request see?" is asked of several workspaces at once — but it must be
 * answered by the same walk the navigation tree and the flat document list
 * use, or search becomes a second implementation of the permission model, and
 * the amendment to ADR-012 exists precisely because a second implementation
 * drifted. So this calls `visibleDocumentIds`, which materialises a
 * workspace's effective-permission rows with the domain's own
 * `materialiseEffectivePermissions` and combines them with the one
 * `combineContributions` that `resolvePermission` also ends in. Nothing here
 * decides anything about permissions; it decides *where* to ask, and how much
 * of it to ask at once.
 *
 * The answer is then applied inside the SQL (`postgres-search-index.ts`),
 * never over rows already fetched: a document a principal cannot read must
 * not be counted, ranked, or paged past.
 *
 * Three things keep the cost bounded:
 *
 * - **A workspace the caller may read whole is named, not enumerated.** The
 *   ordinary case is a grant at the workspace and no document-scope deny
 *   below it, and then every document in the workspace is visible — so the
 *   query says `workspace_id = ANY(...)` and no document id travels at all.
 *   Only a workspace where the walk withheld something contributes ids.
 * - **A bounded number of workspaces per request.** The workspace the caller
 *   is in is resolved first and always; the rest follow in order, at most
 *   {@link WORKSPACES_PER_BATCH} of them, and the search's own cursor carries
 *   where to resume. A member of forty workspaces pays for five walks, not
 *   forty.
 * - **Serially, not all at once.** One walk at a time leaves the connection
 *   pool for the requests that are not searching; a fan-out across every
 *   readable workspace is how one search becomes everybody's outage.
 *
 * Nothing is cached. A permission cache that went stale would show somebody a
 * document that had just been taken away from them, which is a disclosure
 * rather than a slow query; the materialised effective-permission table
 * (ADR-012, ADR-034, scheduled in quill-plan.md §15) is the answer, and when
 * it exists this resolver becomes a join inside the same SQL without
 * `PostgresSearchIndex` changing, because the seam is here rather than in the
 * query.
 */

/**
 * How many workspaces one search request resolves permissions for.
 *
 * Five covers the workspace somebody is in and the handful they move between,
 * which is what the suggestions under `elsewhere` are for; beyond that the
 * cursor carries the rest, and nothing is hidden — only deferred to the next
 * page.
 */
export const WORKSPACES_PER_BATCH = 5

export type VisibleDocuments =
  | {
      /**
       * An instance administrator bypasses resolution entirely (ADR-012), so
       * the query is restricted by workspace and by nothing else.
       */
      readonly kind: 'everything'
    }
  | {
      readonly kind: 'scoped'
      /** Workspaces every document of which the caller may read. */
      readonly wholeWorkspaces: readonly WorkspaceId[]
      /** The documents they may read in the workspaces where that is not true of all of them. */
      readonly documentIds: readonly DocumentId[]
    }

export interface VisibleDocumentRequest {
  readonly filter: VisibilityFilter
  /** Resolved first, and never deferred to a later page: it is where the caller is looking. */
  readonly currentWorkspaceId?: WorkspaceId | undefined
  /** Where in the ordered workspace list this batch starts; 0 for a first page. */
  readonly from: number
}

export interface VisibleDocumentsBatch {
  readonly visible: VisibleDocuments
  /** The workspaces this batch covers, which is what the query is restricted to. */
  readonly workspaceIds: readonly WorkspaceId[]
  /** Where the next batch starts, or null when every readable workspace has been covered. */
  readonly nextFrom: number | null
}

export interface VisibleDocumentResolver {
  resolve(request: VisibleDocumentRequest): Promise<VisibleDocumentsBatch>
}

export interface VisibleDocumentResolverDependencies {
  readonly uow: UnitOfWork
}

export function createVisibleDocumentResolver(
  deps: VisibleDocumentResolverDependencies,
): VisibleDocumentResolver {
  return {
    async resolve(request: VisibleDocumentRequest): Promise<VisibleDocumentsBatch> {
      const ordered = orderWorkspaces(request)
      const batch = ordered.slice(request.from, request.from + WORKSPACES_PER_BATCH)
      const nextFrom =
        request.from + WORKSPACES_PER_BATCH < ordered.length
          ? request.from + WORKSPACES_PER_BATCH
          : null

      if (batch.length === 0) {
        return {
          visible: { kind: 'scoped', wholeWorkspaces: [], documentIds: [] },
          workspaceIds: [],
          nextFrom: null,
        }
      }

      const identities = [...principalsFromKeys(request.filter.principalKeys)]
      if (await holdsInstanceAdmin(deps, identities)) {
        return { visible: { kind: 'everything' }, workspaceIds: batch, nextFrom }
      }

      const wholeWorkspaces: WorkspaceId[] = []
      const documentIds: DocumentId[] = []
      // Serially: one permission walk at a time leaves the pool for the
      // requests that are not searching.
      for (const workspaceId of batch) {
        const resolved = await resolveWorkspace(deps, workspaceId, identities)
        if (resolved.kind === 'whole') wholeWorkspaces.push(workspaceId)
        else documentIds.push(...resolved.ids)
      }

      return {
        visible: { kind: 'scoped', wholeWorkspaces, documentIds },
        workspaceIds: batch,
        nextFrom,
      }
    },
  }
}

/**
 * The workspaces to walk, in the order they are walked: the one the caller is
 * in first, then the rest as the filter listed them.
 *
 * The order is total and stable, which is what lets the cursor say "resume at
 * the sixth" and mean the same thing on the next request.
 */
function orderWorkspaces(request: VisibleDocumentRequest): readonly WorkspaceId[] {
  const { currentWorkspaceId } = request
  if (currentWorkspaceId === undefined) return request.filter.workspaceIds
  const rest = request.filter.workspaceIds.filter((id) => id !== currentWorkspaceId)
  return request.filter.workspaceIds.includes(currentWorkspaceId)
    ? [currentWorkspaceId, ...rest]
    : rest
}

/**
 * The principals behind a filter's keys.
 *
 * `VisibilityFilter` carries the stable keys `principalKey` produces rather
 * than the principals themselves, because that is what an index adapter joins
 * on; reading them back here is what lets the resolution above run on the
 * ordinary domain path. A key this build does not recognise is dropped rather
 * than guessed at: an unknown principal that resolved to *something* could
 * only ever widen what a request sees.
 */
export function* principalsFromKeys(keys: Iterable<string>): Generator<Principal> {
  for (const key of keys) {
    if (key === 'public') {
      yield PUBLIC_PRINCIPAL
      continue
    }
    const separator = key.indexOf(':')
    if (separator === -1) continue
    const id = key.slice(separator + 1)
    if (id.length === 0) continue
    switch (key.slice(0, separator)) {
      case 'user':
        yield userPrincipal(id as UserId)
        break
      case 'group':
        yield groupPrincipal(id as GroupId)
        break
      case 'share-link':
        yield shareLinkPrincipal(id as ShareLinkId)
        break
      default:
        break
    }
  }
}

/** Instance administration is not a scoped capability (ADR-012): an admin reads every workspace they can name. */
async function holdsInstanceAdmin(
  deps: VisibleDocumentResolverDependencies,
  identities: readonly Principal[],
): Promise<boolean> {
  const users = await Promise.all(
    identities.flatMap((principal) =>
      principal.kind === 'user' ? [deps.uow.repos.users.findById(principal.userId)] : [],
    ),
  )
  return users.some((user) => user !== null && user.isInstanceAdmin)
}

type ResolvedWorkspace =
  | { readonly kind: 'whole' }
  | { readonly kind: 'some'; readonly ids: readonly DocumentId[] }

/**
 * One workspace's answer: all of it, or the documents of it.
 *
 * "All of it" is the ordinary case — a grant at the workspace with nothing
 * withheld below it — and saying so keeps thousands of ids out of the query.
 * The comparison is against the workspace's whole document count, so a single
 * document-scope deny anywhere in it drops back to listing what is left.
 */
async function resolveWorkspace(
  deps: VisibleDocumentResolverDependencies,
  workspaceId: WorkspaceId,
  identities: readonly Principal[],
): Promise<ResolvedWorkspace> {
  const { repos } = deps.uow
  const workspace = await repos.workspaces.findById(workspaceId)
  // A workspace the caller named that no longer exists contributes nothing,
  // rather than failing a search across every other workspace with it.
  if (workspace === null) return { kind: 'some', ids: [] }

  const [collections, documents] = await Promise.all([
    repos.collections.listByWorkspace(workspaceId),
    repos.documents.listByWorkspace(workspaceId),
  ])

  const visible = await visibleDocumentIds(deps, {
    workspace,
    collections,
    byCollection: Map.groupBy(documents, (document) => document.collectionId),
    identities,
  })
  // A tenancy tree that contradicts itself hides that workspace's documents
  // rather than leaking them; the same failure is a 500 on a direct read,
  // where there is one workspace to report it about.
  if (!visible.ok) return { kind: 'some', ids: [] }

  return visible.ids.size === documents.length && documents.length > 0
    ? { kind: 'whole' }
    : { kind: 'some', ids: [...visible.ids] }
}
