import { useQueries } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import type { LinkPreviewSource } from '@quill/editor'

import { linkPreviewImageUrl, linkPreviewQueryOptions, useApiClient } from '../../lib/api/index.ts'

/**
 * How the editor gets the preview of a link card (ADR-042).
 *
 * A card says which address it is showing (`request`), and this asks the server
 * for each address once, through the same cached read the reader's peek uses, so a
 * page looked at while writing is already stored by the time it is read. Only a
 * preview that is ready is handed back; a link that is still being fetched, blocked
 * or unavailable is drawn from its address, never as an error.
 */
export function useEditorLinkPreviews(): LinkPreviewSource {
  const client = useApiClient()
  const [wanted, setWanted] = useState<readonly string[]>([])
  const request = useCallback((url: string) => {
    setWanted((current) => (current.includes(url) ? current : [...current, url]))
  }, [])

  const known = useQueries({
    queries: wanted.map((url) => linkPreviewQueryOptions(client, url)),
    combine: (results) =>
      new Map(
        results.flatMap((result, index) => {
          const view = result.data
          const url = wanted[index]
          return view?.state === 'ready' && url !== undefined ? [[url, view.preview] as const] : []
        }),
      ),
  })

  return useMemo(
    () => ({ preview: (url) => known.get(url) ?? null, request, imageUrl: linkPreviewImageUrl }),
    [known, request],
  )
}
