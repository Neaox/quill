import type { DocumentId, UnitId } from '../ids.ts'
import type { Result } from '../result.ts'
import { err, ok } from '../result.ts'
import type { Collection } from '../tenancy/collection.ts'
import type { Document } from '../tenancy/document.ts'
import type { OrganisationalUnit } from '../tenancy/organisational-unit.ts'
import type { Workspace } from '../tenancy/workspace.ts'
import type { Contribution } from './combine.ts'
import { supersedesAtScope } from './combine.ts'
import type { Grant } from './grant.ts'
import { principalKey } from './principal.ts'
import type { ScopeChainFailure } from './scope-chain.ts'
import {
  buildUnitChain,
  collectionPlacementFailure,
  documentPlacementFailure,
} from './scope-chain.ts'
import type { Scope } from './scope.ts'
import {
  INSTANCE_SCOPE,
  collectionScope,
  documentScope,
  scopeKey,
  unitScope,
  workspaceScope,
} from './scope.ts'

/**
 * One row of the materialised effective-permission table: what one principal
 * contributes to one document.
 *
 * The table is rebuilt from outbox events when grants change and serves search
 * filtering and list views, which cannot afford to resolve each document one at
 * a time (ADR-012). A row is emitted for a deny as well as for an allow,
 * because a deny only means anything beside the allows it discards: a consumer
 * takes the rows for the principals a request holds and runs
 * `combineContributions` over them, which is the same function
 * `resolvePermission` finishes with.
 */
export interface EffectivePermissionRow extends Contribution {
  readonly documentId: DocumentId
}

/**
 * One collection's documents, flat and in any order.
 *
 * Nesting comes from `Document.parentId`, the same field `buildScopeChain`
 * walks for a single document, so there is exactly one place a document's
 * place in the tree is recorded.
 */
export interface CollectionNode {
  readonly collection: Collection
  readonly documents: readonly Document[]
}

/** One workspace's documents, arranged the way the table is rebuilt. */
export interface WorkspaceTree {
  readonly workspace: Workspace
  readonly unitsById: ReadonlyMap<UnitId, OrganisationalUnit>
  readonly collections: readonly CollectionNode[]
}

export interface MaterialiseInput {
  readonly tree: WorkspaceTree
  readonly grants: Iterable<Grant>
}

/** One principal's contribution, before it is attached to a document. */
type Verdict = Omit<EffectivePermissionRow, 'documentId'>

/** What each principal is left with, keyed by `principalKey`. */
type Verdicts = ReadonlyMap<string, Verdict>

const NO_VERDICTS: Verdicts = new Map()

/**
 * Every principal that has a say over each document in the tree.
 *
 * The scopes above a document are the same for every document in a collection,
 * so the walk descends once, carrying the verdicts reached so far, instead of
 * rebuilding each document's chain from the instance downwards. Documents
 * nest the same way: a document's own verdicts are resolved once and cached,
 * so a parent shared by many children is never recomputed, and the walk
 * still costs one visit per grant plus one per row produced.
 *
 * Each row records the depth of the scope that decided it, counted down from
 * the instance, which is what lets a consumer tell an inherited deny from an
 * allow written below it without rebuilding the chain.
 *
 * Rows come out in traversal order, which makes the result reproducible without
 * a sort: collections and documents in the order given, inherited principals
 * before those the document itself names.
 */
export function materialiseEffectivePermissions(
  input: MaterialiseInput,
): Result<readonly EffectivePermissionRow[], ScopeChainFailure> {
  const { workspace, unitsById, collections } = input.tree

  const units = buildUnitChain(workspace.unitId, unitsById)
  if (!units.ok) return units

  const grantsByScope = groupGrantsByScope(input.grants)
  const at = (scope: Scope, depth: number): Verdicts =>
    verdictsAtScope(grantsByScope.get(scopeKey(scope)), scope, depth)

  // Depth counts down from the instance, so that within any one document a
  // larger depth means a nearer scope — the comparison `combineContributions`
  // makes, and the same numbering `resolvePermission` derives from the chain.
  let depth = 0
  let inherited = at(INSTANCE_SCOPE, depth)
  for (const unit of units.value.toReversed()) {
    depth += 1
    inherited = override(inherited, at(unitScope(unit.id), depth))
  }
  depth += 1
  inherited = override(inherited, at(workspaceScope(workspace.id), depth))
  const collectionDepth = depth + 1

  const documentsById = new Map<DocumentId, Document>()
  for (const { collection, documents } of collections) {
    const misplacedCollection = collectionPlacementFailure(collection, workspace)
    if (misplacedCollection !== null) return err(misplacedCollection)

    for (const document of documents) {
      const misplacedDocument = documentPlacementFailure(document, collection, workspace)
      if (misplacedDocument !== null) return err(misplacedDocument)
      documentsById.set(document.id, document)
    }
  }

  const rows: EffectivePermissionRow[] = []
  const cache = new Map<DocumentId, Resolved>()
  const onPath = new Set<DocumentId>()

  for (const { collection, documents } of collections) {
    const atCollection = override(inherited, at(collectionScope(collection.id), collectionDepth))
    const ctx: DocumentResolution = {
      atCollection: { verdicts: atCollection, depth: collectionDepth },
      documentsById,
      at,
      cache,
      onPath,
      rows,
    }

    for (const document of documents) {
      const result = resolveDocumentVerdicts(document, ctx)
      if (!result.ok) return result
    }
  }

  return ok(rows)
}

/** The verdicts in force at one point of the descent, and how deep that point is. */
interface Resolved {
  readonly verdicts: Verdicts
  readonly depth: number
}

interface DocumentResolution {
  /** The verdicts inherited from the instance down through this document's collection. */
  readonly atCollection: Resolved
  readonly documentsById: ReadonlyMap<DocumentId, Document>
  readonly at: (scope: Scope, depth: number) => Verdicts
  /** A document's own resolved verdicts, once known, so its children never redo the walk to the root. */
  readonly cache: Map<DocumentId, Resolved>
  /** Documents currently being resolved, so a parent pointer that loops back is a failure, not a hang. */
  readonly onPath: Set<DocumentId>
  readonly rows: EffectivePermissionRow[]
}

/**
 * The verdicts in force at `document`: what it inherits, overridden by
 * whatever it grants itself.
 *
 * Resolving a parent first and reusing its cached result is what keeps a
 * whole subtree to one visit per document, matching `buildScopeChain`'s
 * ordering (nearest ancestor wins) without repeating that ancestor's walk to
 * the instance for every one of its descendants.
 */
function resolveDocumentVerdicts(
  document: Document,
  ctx: DocumentResolution,
): Result<Resolved, ScopeChainFailure> {
  const cached = ctx.cache.get(document.id)
  if (cached !== undefined) return ok(cached)

  if (ctx.onPath.has(document.id)) {
    return err({ kind: 'document-cycle', documentId: document.id })
  }
  ctx.onPath.add(document.id)

  const parentId = document.parentId
  const inherited =
    parentId === null ? ok(ctx.atCollection) : resolveParentVerdicts(document, parentId, ctx)

  ctx.onPath.delete(document.id)
  if (!inherited.ok) return inherited

  const depth = inherited.value.depth + 1
  const own = ctx.at(documentScope(document.id), depth)
  collectRows(ctx.rows, document.id, inherited.value.verdicts, own)

  const resolved: Resolved = { verdicts: override(inherited.value.verdicts, own), depth }
  ctx.cache.set(document.id, resolved)
  return ok(resolved)
}

/** The verdicts `document` inherits from its parent, found by id and validated before use. */
function resolveParentVerdicts(
  document: Document,
  parentId: DocumentId,
  ctx: DocumentResolution,
): Result<Resolved, ScopeChainFailure> {
  const parent = ctx.documentsById.get(parentId)
  if (parent === undefined) return err({ kind: 'unknown-document', documentId: parentId })

  if (parent.collectionId !== document.collectionId) {
    return err({
      kind: 'document-ancestor-outside-collection',
      documentId: parent.id,
      collectionId: document.collectionId,
    })
  }

  return resolveDocumentVerdicts(parent, ctx)
}

function groupGrantsByScope(grants: Iterable<Grant>): ReadonlyMap<string, Grant[]> {
  const byScope = new Map<string, Grant[]>()
  for (const grant of grants) {
    const key = scopeKey(grant.scope)
    const atScope = byScope.get(key)
    if (atScope === undefined) byScope.set(key, [grant])
    else atScope.push(grant)
  }
  return byScope
}

function verdictsAtScope(
  grants: readonly Grant[] | undefined,
  scope: Scope,
  depth: number,
): Verdicts {
  if (grants === undefined) return NO_VERDICTS

  const verdicts = new Map<string, Verdict>()
  for (const grant of grants) {
    const key = principalKey(grant.principal)
    const current = verdicts.get(key)
    if (current === undefined || supersedesAtScope(grant, current)) {
      verdicts.set(key, {
        principal: grant.principal,
        role: grant.role,
        effect: grant.effect,
        depth,
        scope,
      })
    }
  }
  return verdicts
}

/** The nearer scope replaces what the further one said, principal by principal. */
function override(inherited: Verdicts, nearer: Verdicts): Verdicts {
  if (nearer.size === 0) return inherited
  const merged = new Map(inherited)
  for (const [key, verdict] of nearer) merged.set(key, verdict)
  return merged
}

/**
 * Appends this document's rows.
 *
 * The document's own verdicts are applied without merging the two maps, so a
 * document that names no principal of its own costs nothing beyond its rows.
 */
function collectRows(
  rows: EffectivePermissionRow[],
  documentId: DocumentId,
  inherited: Verdicts,
  own: Verdicts,
): void {
  for (const [key, verdict] of inherited) {
    if (!own.has(key)) rows.push({ documentId, ...verdict })
  }
  for (const verdict of own.values()) rows.push({ documentId, ...verdict })
}
