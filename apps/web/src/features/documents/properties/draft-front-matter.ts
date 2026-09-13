import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { queryKeys, type DraftDto } from '../../../lib/api/index.ts'
import { readDraftContent } from '../../../lib/documents/draft-content.ts'

/**
 * The draft's front matter, which is the record a publish serialises.
 *
 * A draft is an envelope of `{ version, frontMatter, ast }` and the editor only
 * ever handles the tree; the front matter travels beside it (see
 * `lib/documents/draft-content.ts`). So when the properties strip changes a
 * value, the change has to land on the envelope, not only on the block inside
 * the tree — the serialiser applies the *record* onto the block's YAML, so a
 * record left behind would quietly undo the edit at publish.
 *
 * The envelope lives in the query cache, which is where `useDraftClient` reads
 * it from on its way to the server (ADR-013: server state is TanStack Query's).
 * Writing it here therefore reaches autosave without a second copy of the draft
 * existing anywhere: the next save carries the new record, and the refetch that
 * follows a save returns the same thing the server has just stored.
 */
export function useWriteDraftFrontMatter(
  documentId: string,
): (frontMatter: Record<string, unknown>) => void {
  const queryClient = useQueryClient()

  return useCallback(
    (frontMatter: Record<string, unknown>) => {
      queryClient.setQueryData<DraftDto>(queryKeys.draft(documentId), (previous) => {
        if (previous === undefined) return previous
        const content = readDraftContent(previous.ast)
        // A draft this release cannot read is not one it may rewrite (ADR-033).
        if (content === null) return previous
        return {
          ...previous,
          ast: { version: content.version, frontMatter, ast: content.ast },
        }
      })
    },
    [documentId, queryClient],
  )
}
