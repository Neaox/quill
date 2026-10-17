import { useCallback } from 'react'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'

/**
 * `POST /api/documents/links`: the reading addresses of the documents a body
 * links to, for this reader, every reference in one request (ADR-035).
 *
 * Not a query: the answer depends on who is reading and on other documents'
 * titles, and it is only ever wanted for the body that is mounted, so it is
 * asked for afresh each time a body is, like its child pages (ADR-054).
 */
/** The server's bound on one request; links past it keep their stored form and resolve when followed. */
const MAX_REFERENCES = 200

export function useDocumentLinksLoader(): (
  references: readonly string[],
  signal: AbortSignal,
) => Promise<ReadonlyMap<string, string>> {
  const client = useApiClient()
  return useCallback(
    async (references: readonly string[], signal: AbortSignal) => {
      const { links } = await request(
        client.POST('/api/documents/links', {
          body: { references: references.slice(0, MAX_REFERENCES) },
          signal,
        }),
      )
      return new Map(links.map((link) => [link.reference, link.href]))
    },
    [client],
  )
}
