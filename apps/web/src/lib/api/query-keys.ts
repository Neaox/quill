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
  /** The sign-in page's provider buttons (ADR-011). One list per instance. */
  oidcProviders: ['oidc-providers'] as const,
  units: (parentId?: string) => ['units', parentId ?? null] as const,
  /**
   * The organisation's settings (ADR-034). One entry for the instance: every
   * screen that renders with the theme, the navigation or the policies reads
   * it, and a save replaces it with what the server answered rather than
   * invalidating, because the response *is* the new state plus its revision.
   */
  organisationSettings: () => ['organisation-settings'] as const,
  /**
   * A workspace's settings, keyed by the spelling that asked for them — the
   * route carries a slug, a write carries the id — exactly as `workspace`
   * above is. `workspace-settings` is the prefix they share.
   */
  workspaceSettings: (idOrSlug: string) => ['workspace-settings', idOrSlug] as const,
  /** Every secret's name and key id. Never a value: none is ever sent. */
  secrets: () => ['secrets'] as const,
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
  attachments: (documentId: string) => ['attachments', documentId] as const,
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
  /** Every share link on one document, as the share dialog lists them. */
  shareLinks: (documentId: string) => ['share-links', documentId] as const,
  /**
   * The anonymous reading surface, keyed by the token that is the whole of
   * the capability. Its own top-level segments, sharing nothing with the
   * signed-in world's entries: a share-link page is a different reader
   * looking at a different thing, and an invalidation on either side must
   * never reach across.
   */
  sharedDocument: (token: string) => ['shared-document', token] as const,
  sharedBody: (token: string, reference: string) => ['shared-body', token, reference] as const,
  publishedContent: (documentId: string) => ['published-content', documentId] as const,
  history: (documentId: string) => ['history', documentId] as const,
  diff: (documentId: string, from: string | null, to: string) =>
    ['diff', documentId, from, to] as const,
  /**
   * One page of search results, keyed by the workspace the search was run
   * *from*, the query, and the cursor — the three things that decide what
   * comes back. The workspace is part of the key even though search crosses
   * workspaces (quill-plan.md §15), because it is what puts a hit in `current`
   * rather than in `elsewhere`; `null` is a search with no workspace in scope.
   *
   * The palette asks for one page at a time (`search`); the results page pages
   * through with `useInfiniteQuery`, whose cursors are page params rather than
   * part of the key, and so has its own segment.
   */
  search: (workspaceId: string | null, query: string, cursor: string | null) =>
    ['search', workspaceId, query, cursor] as const,
  searchResults: (workspaceId: string | null, query: string) =>
    ['search-results', workspaceId, query] as const,
}
