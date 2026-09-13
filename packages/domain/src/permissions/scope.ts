import type { CollectionId, DocumentId, UnitId, WorkspaceId } from '../ids.ts'

/** The places a grant can be attached, from the least specific to the most. */
export const SCOPE_KINDS = ['instance', 'unit', 'workspace', 'collection', 'document'] as const

export type ScopeKind = (typeof SCOPE_KINDS)[number]

export interface InstanceScope {
  readonly kind: 'instance'
}

export interface UnitScope {
  readonly kind: 'unit'
  readonly unitId: UnitId
}

export interface WorkspaceScope {
  readonly kind: 'workspace'
  readonly workspaceId: WorkspaceId
}

export interface CollectionScope {
  readonly kind: 'collection'
  readonly collectionId: CollectionId
}

export interface DocumentScope {
  readonly kind: 'document'
  readonly documentId: DocumentId
}

export type Scope = InstanceScope | UnitScope | WorkspaceScope | CollectionScope | DocumentScope

const SPECIFICITY: Readonly<Record<ScopeKind, number>> = {
  instance: 0,
  unit: 1,
  workspace: 2,
  collection: 3,
  document: 4,
}

/** The whole instance. Every scope chain ends here. */
export const INSTANCE_SCOPE: InstanceScope = { kind: 'instance' }

export function unitScope(id: UnitId): UnitScope {
  return { kind: 'unit', unitId: id }
}

export function workspaceScope(id: WorkspaceId): WorkspaceScope {
  return { kind: 'workspace', workspaceId: id }
}

export function collectionScope(id: CollectionId): CollectionScope {
  return { kind: 'collection', collectionId: id }
}

export function documentScope(id: DocumentId): DocumentScope {
  return { kind: 'document', documentId: id }
}

/**
 * Higher is narrower: instance 0, unit 1, workspace 2, collection 3, document 4.
 *
 * This ranks kinds, not scopes. A scope chain holds one scope per ancestor unit
 * and one per ancestor document, and within each kind every entry ranks the
 * same, so which of two units, or two documents, wins is decided by position
 * on the chain, never by this number.
 */
export function scopeSpecificity(scope: Scope): number {
  return SPECIFICITY[scope.kind]
}

/**
 * A stable key for set and map membership.
 *
 * The kind is part of the key so a collection and a document that happen to
 * share a UUID can never be mistaken for each other.
 */
export function scopeKey(scope: Scope): string {
  switch (scope.kind) {
    case 'unit':
      return `unit:${scope.unitId}`
    case 'workspace':
      return `workspace:${scope.workspaceId}`
    case 'collection':
      return `collection:${scope.collectionId}`
    case 'document':
      return `document:${scope.documentId}`
    case 'instance':
      return 'instance'
  }
}
