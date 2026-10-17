import { useCallback } from 'react'

import type { ChildPagesQuery } from '@quill/markdown/child-pages-slot'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import type { ChildPagesList } from './types.ts'

/** Lists the pages under a document for one `::children` slot (ADR-054). */
export type ChildPagesLoader = (
  documentId: string,
  query: ChildPagesQuery,
  signal: AbortSignal,
) => Promise<ChildPagesList>

/**
 * `GET /api/documents/:id/children`, as the reading view fills a slot with
 * it. Not a query: the list depends on who is reading and on other
 * documents, so it is asked for afresh each time the body is mounted, and
 * the server keeps the part worth keeping (ADR-054).
 */
export function useChildPagesLoader(): ChildPagesLoader {
  const client = useApiClient()
  return useCallback<ChildPagesLoader>(
    (documentId, query, signal) =>
      request(
        client.GET('/api/documents/{id}/children', {
          params: {
            path: { id: documentId },
            query: {
              depth: query.depth,
              sort: query.sort,
              excerpts: query.excerpts,
              icons: query.icons,
            },
          },
          signal,
        }),
      ),
    [client],
  )
}

/** One document's child pages, for its body's slots and its editor's preview; stable while the document is. */
export function useChildPagesOf(
  documentId: string,
): (query: ChildPagesQuery, signal: AbortSignal) => Promise<ChildPagesList> {
  const load = useChildPagesLoader()
  return useCallback(
    (query: ChildPagesQuery, signal: AbortSignal) => load(documentId, query, signal),
    [load, documentId],
  )
}
