import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import {
  frontMatterRecord,
  frontMatterSource,
  type DocumentAst,
  type DocumentEditorHandle,
} from '@quill/editor'
import { frontMatterNode } from '@quill/markdown'

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

type Editor = NonNullable<DocumentEditorHandle['editor']>

export interface DraftFrontMatter {
  /** The record the properties line shows and edits. */
  readonly record: Readonly<Record<string, unknown>>
  /** The block's YAML as written, for editing it as source. */
  readonly source: string | undefined
  /** Called on every editor change: picks up a front matter block that moved. */
  follow(editor: Editor | null): void
}

/**
 * The front matter of a document being edited, following its block.
 *
 * Every property change is a transaction on the document's front matter block
 * (`applyFrontMatter`), so it is one step of the editor's undo history, and an
 * undo or a redo moves the block too. The record therefore *follows the
 * block*: whenever an edit leaves the block's YAML different, the record is
 * read back from it, shown, and written to the draft envelope that autosave
 * sends. Comparing the YAML first keeps that to the edits that touched it;
 * typing in the body costs one string comparison.
 */
export function useDraftFrontMatter(
  documentId: string,
  initial: Readonly<Record<string, unknown>>,
  initialAst: DocumentAst | undefined,
): DraftFrontMatter {
  const write = useWriteDraftFrontMatter(documentId)
  const [front, setFront] = useState(() => ({
    record: initial,
    source: initialAst === undefined ? undefined : frontMatterNode(initialAst)?.value,
  }))

  return {
    ...front,
    follow(editor) {
      if (editor === null) return
      const source = frontMatterSource(editor.state.doc)
      if (source === front.source) return
      const record = { ...frontMatterRecord(editor.state.doc, initial) }
      setFront({ record, source })
      write(record)
    },
  }
}
