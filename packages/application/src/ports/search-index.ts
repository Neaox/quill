import type { DocumentId, WorkspaceId } from '@quill/domain'

/**
 * The search port (ADR-010). PostgreSQL full-text search implements it
 * first; another engine is another implementation of the same interface.
 */
export interface IndexableDocument {
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly headings: readonly string[]
  readonly body: string
  readonly tags: readonly string[]
  readonly updatedAt: Date
}

export interface SearchQuery {
  readonly text: string
  readonly workspaceId?: WorkspaceId
  readonly tags?: readonly string[]
  readonly limit: number
  readonly cursor?: string
}

export interface SearchResult {
  readonly documentId: DocumentId
  readonly workspaceId: WorkspaceId
  readonly title: string
  /** Highlighted snippet with `<mark>` around matches; already escaped. */
  readonly snippet: string
  readonly score: number
}

export interface SearchResults {
  readonly results: readonly SearchResult[]
  readonly nextCursor?: string
}

/** Opaque handle to who is searching; permission filtering happens inside. */
export interface SearchPrincipal {
  readonly principalIds: readonly string[]
}

export interface SearchIndex {
  index(doc: IndexableDocument): Promise<void>
  remove(documentId: DocumentId): Promise<void>
  query(q: SearchQuery, principal: SearchPrincipal): Promise<SearchResults>
}
