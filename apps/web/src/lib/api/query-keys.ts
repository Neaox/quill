/**
 * Every TanStack Query key used by `src/lib/api`, in one place, so a cache
 * invalidation in one hook can never silently drift from the key another
 * hook reads with (ADR-013: server state lives in TanStack Query). Each
 * resource gets its own top-level segment rather than nesting (for example
 * `['workspace', id]` and `['workspace-documents', id]` instead of
 * `['workspaces', id]` and `['workspaces', id, 'documents']`) so a partial
 * match on one resource's key can never also match another's.
 */
export const queryKeys = {
  me: ['me'] as const,
  units: (parentId?: string) => ['units', parentId ?? null] as const,
  workspaceList: () => ['workspace-list'] as const,
  /**
   * A workspace is addressable two ways — its id and its slug (ADR-035) — and
   * a query is keyed by whichever spelling asked for it. `workspaces` is the
   * prefix they share, for a write that has to reach both.
   */
  workspaces: () => ['workspace'] as const,
  workspace: (idOrSlug: string) => ['workspace', idOrSlug] as const,
  workspaceDocuments: (workspaceId: string) => ['workspace-documents', workspaceId] as const,
  workspaceTree: (workspaceId: string) => ['workspace-tree', workspaceId] as const,
  /**
   * A document is addressable three ways (its id, its short key, and a
   * title-slug plus that key — ADR-035), and a query is keyed by whichever
   * spelling asked for it, so one document can hold more than one entry.
   * `documents` is the prefix every one of them shares: a write invalidates
   * that, so no spelling can be left showing yesterday's title.
   */
  documents: () => ['document'] as const,
  document: (id: string) => ['document', id] as const,
  draft: (documentId: string) => ['draft', documentId] as const,
  lock: (documentId: string) => ['lock', documentId] as const,
  /**
   * The rendered body is content-addressed (ADR-031), so the revision is part
   * of the key: asking for an older revision is a different entry rather than
   * an invalidation of the current one, and `undefined` (the head revision)
   * is its own entry that a publish invalidates.
   */
  rendered: (documentId: string, revision?: string) =>
    ['rendered', documentId, revision ?? null] as const,
  envelope: (documentId: string) => ['envelope', documentId] as const,
  publishedContent: (documentId: string) => ['published-content', documentId] as const,
  history: (documentId: string) => ['history', documentId] as const,
  diff: (documentId: string, from: string | null, to: string) =>
    ['diff', documentId, from, to] as const,
}
