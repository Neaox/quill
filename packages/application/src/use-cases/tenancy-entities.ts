import type {
  Collection,
  CollectionId,
  Document,
  DocumentId,
  GroupId,
  OrganisationalUnit,
  UnitId,
  Workspace,
} from '@quill/domain'

import type {
  CollectionRow,
  DocumentRow,
  GroupRow,
  UnitRow,
  WorkspaceRow,
} from '../ports/persistence.ts'

/**
 * Repository rows as the domain entities the permission rules read.
 *
 * A row carries what the database needs — timestamps, paths, template
 * provenance — and an entity carries what the rules read. Translating in one
 * place keeps the ids branded (the port still spells unit, group, and
 * collection ids as plain strings) and keeps every caller of
 * `buildScopeChain` and `materialiseEffectivePermissions` reading the same
 * way.
 */

export function toUnitEntity(row: UnitRow): OrganisationalUnit {
  return {
    id: row.id as UnitId,
    parentId: row.parentId as UnitId | null,
    name: row.name,
    slug: row.slug,
    label: row.label,
  }
}

export function unitsById(rows: readonly UnitRow[]): ReadonlyMap<UnitId, OrganisationalUnit> {
  return new Map(rows.map((row) => [row.id as UnitId, toUnitEntity(row)]))
}

export function toWorkspaceEntity(row: WorkspaceRow): Workspace {
  return { id: row.id, unitId: row.unitId as UnitId, name: row.name, slug: row.slug }
}

export function toCollectionEntity(row: CollectionRow): Collection {
  return {
    id: row.id as CollectionId,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
  }
}

export function toGroupEntity(row: GroupRow) {
  return {
    id: row.id as GroupId,
    unitId: row.unitId as UnitId,
    parentGroupId: row.parentGroupId as GroupId | null,
    name: row.name,
  }
}

/** A document row as the entity, placed in the collection the caller has already established. */
export function toDocumentEntity(row: DocumentRow, collectionId: string): Document {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    collectionId: collectionId as CollectionId,
    parentId: row.parentId,
    slug: row.slug,
    title: row.title,
    status: row.status,
  }
}

/**
 * Ancestor rows keyed by id, skipping any outside a collection: the chain
 * builder rejects an ancestor in a different collection anyway, and a
 * document in none cannot be one.
 */
export function documentsById(rows: Iterable<DocumentRow>): ReadonlyMap<DocumentId, Document> {
  const byId = new Map<DocumentId, Document>()
  for (const row of rows) {
    if (row.collectionId !== null) byId.set(row.id, toDocumentEntity(row, row.collectionId))
  }
  return byId
}
