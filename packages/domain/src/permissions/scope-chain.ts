import type { CollectionId, DocumentId, UnitId, WorkspaceId } from '../ids.ts'
import type { Result } from '../result.ts'
import { err, ok } from '../result.ts'
import type { Collection } from '../tenancy/collection.ts'
import type { Document } from '../tenancy/document.ts'
import type { OrganisationalUnit } from '../tenancy/organisational-unit.ts'
import type { Workspace } from '../tenancy/workspace.ts'
import type { Scope } from './scope.ts'
import {
  INSTANCE_SCOPE,
  collectionScope,
  documentScope,
  unitScope,
  workspaceScope,
} from './scope.ts'

/**
 * The scopes that govern one document, ordered from the most specific to the
 * least: the document, each ancestor document up to the root of its
 * collection (nearest first), the collection, the workspace, each unit from
 * its own up to the root, and finally the instance.
 */
export type ScopeChain = readonly Scope[]

export type ScopeChainFailure =
  | { readonly kind: 'unknown-unit'; readonly unitId: UnitId }
  | { readonly kind: 'unit-cycle'; readonly unitId: UnitId }
  | { readonly kind: 'unknown-document'; readonly documentId: DocumentId }
  | { readonly kind: 'document-cycle'; readonly documentId: DocumentId }
  | {
      readonly kind: 'collection-outside-workspace'
      readonly collectionId: CollectionId
      readonly workspaceId: WorkspaceId
    }
  | {
      readonly kind: 'document-outside-collection'
      readonly documentId: DocumentId
      readonly collectionId: CollectionId
    }
  | {
      readonly kind: 'document-outside-workspace'
      readonly documentId: DocumentId
      readonly workspaceId: WorkspaceId
    }
  | {
      readonly kind: 'document-ancestor-outside-collection'
      readonly documentId: DocumentId
      readonly collectionId: CollectionId
    }

export interface ScopeChainInput {
  readonly document: Document
  readonly collection: Collection
  readonly workspace: Workspace
  readonly unitsById: ReadonlyMap<UnitId, OrganisationalUnit>

  /** Every document that might be walked as an ancestor, keyed by id. */
  readonly documentsById: ReadonlyMap<DocumentId, Document>
}

interface AncestorWalk<Id, T> {
  /** Where the walk begins; a document walk starts one level up, so this may be null. */
  readonly start: Id | null
  readonly byId: ReadonlyMap<Id, T>
  readonly parentIdOf: (item: T) => Id | null
  /** Ids already on the path before the walk starts, so a loop back onto them is a cycle. */
  readonly seen?: Iterable<Id>
  readonly unknown: (id: Id) => ScopeChainFailure
  readonly cycle: (id: Id) => ScopeChainFailure
  /** Checked on every ancestor before it is accepted onto the chain. */
  readonly validate?: (item: T) => ScopeChainFailure | null
}

/**
 * Walks parent pointers from `start` to the root, nearest first.
 *
 * Shared by the unit and document ancestor walks below: both need the same
 * cycle-safe traversal and differ only in what they look up and how, if at
 * all, each ancestor is validated before it is accepted onto the chain.
 */
function walkAncestors<Id, T>(walk: AncestorWalk<Id, T>): Result<readonly T[], ScopeChainFailure> {
  const chain: T[] = []
  const seen = new Set<Id>(walk.seen)
  let current = walk.start

  while (current !== null) {
    if (seen.has(current)) return err(walk.cycle(current))
    seen.add(current)

    const item = walk.byId.get(current)
    if (item === undefined) return err(walk.unknown(current))

    const violation = walk.validate?.(item) ?? null
    if (violation !== null) return err(violation)

    chain.push(item)
    current = walk.parentIdOf(item)
  }

  return ok(chain)
}

/**
 * The units from `from` up to the root, nearest first.
 *
 * The walk tracks the units it has seen so a parent pointer that loops back on
 * itself returns a failure instead of hanging the request that triggered it.
 */
export function buildUnitChain(
  from: UnitId,
  unitsById: ReadonlyMap<UnitId, OrganisationalUnit>,
): Result<readonly OrganisationalUnit[], ScopeChainFailure> {
  return walkAncestors({
    start: from,
    byId: unitsById,
    parentIdOf: (unit) => unit.parentId,
    unknown: (unitId) => ({ kind: 'unknown-unit', unitId }),
    cycle: (unitId) => ({ kind: 'unit-cycle', unitId }),
  })
}

/**
 * The ancestor documents above `document`, nearest first, stopping at the
 * root document of its collection.
 *
 * Every ancestor must belong to the same collection as `document` itself: a
 * grant on a document reaches its own subtree and no further (the plan,
 * section 14), so a parent pointer that escapes the collection is a data
 * error rather than a wider grant of access.
 */
export function buildDocumentAncestorChain(
  document: Document,
  documentsById: ReadonlyMap<DocumentId, Document>,
): Result<readonly Document[], ScopeChainFailure> {
  return walkAncestors({
    start: document.parentId,
    byId: documentsById,
    parentIdOf: (ancestor) => ancestor.parentId,
    seen: [document.id],
    unknown: (documentId) => ({ kind: 'unknown-document', documentId }),
    cycle: (documentId) => ({ kind: 'document-cycle', documentId }),
    validate: (ancestor) =>
      ancestor.collectionId === document.collectionId
        ? null
        : {
            kind: 'document-ancestor-outside-collection',
            documentId: ancestor.id,
            collectionId: document.collectionId,
          },
  })
}

/** Null when the collection really belongs to the workspace. */
export function collectionPlacementFailure(
  collection: Collection,
  workspace: Workspace,
): ScopeChainFailure | null {
  return collection.workspaceId === workspace.id
    ? null
    : {
        kind: 'collection-outside-workspace',
        collectionId: collection.id,
        workspaceId: workspace.id,
      }
}

/**
 * Null when the document really sits in that collection and workspace.
 *
 * Resolving a document against someone else's collection would silently hand
 * back the wrong answer, so the mismatch is a failure rather than a guess.
 */
export function documentPlacementFailure(
  document: Document,
  collection: Collection,
  workspace: Workspace,
): ScopeChainFailure | null {
  if (document.collectionId !== collection.id) {
    return {
      kind: 'document-outside-collection',
      documentId: document.id,
      collectionId: collection.id,
    }
  }
  if (document.workspaceId !== workspace.id) {
    return {
      kind: 'document-outside-workspace',
      documentId: document.id,
      workspaceId: workspace.id,
    }
  }
  return null
}

export function buildScopeChain(input: ScopeChainInput): Result<ScopeChain, ScopeChainFailure> {
  const { document, collection, workspace, unitsById, documentsById } = input

  const misplaced =
    collectionPlacementFailure(collection, workspace) ??
    documentPlacementFailure(document, collection, workspace)
  if (misplaced !== null) return err(misplaced)

  const ancestors = buildDocumentAncestorChain(document, documentsById)
  if (!ancestors.ok) return ancestors

  const units = buildUnitChain(workspace.unitId, unitsById)
  if (!units.ok) return units

  return ok([
    documentScope(document.id),
    ...ancestors.value.map((ancestor) => documentScope(ancestor.id)),
    collectionScope(collection.id),
    workspaceScope(workspace.id),
    ...units.value.map((unit) => unitScope(unit.id)),
    INSTANCE_SCOPE,
  ])
}
