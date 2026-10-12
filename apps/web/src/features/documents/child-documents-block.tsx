import { NestedList } from '@quill/ui'

import { useDocument } from '../../lib/api/index.ts'
import { useChildDocuments } from '../../lib/documents/use-child-documents.ts'
import { RouterLink } from '../../lib/routing/router-link.tsx'

export interface ChildDocumentsBlockProps {
  readonly documentId: string
  readonly workspaceSlug: string
  /** How many generations to list, from the block's `depth` setting. */
  readonly depth: number
}

/**
 * What fills a `::children` block when a document is read.
 *
 * The cached body holds only a slot for it (ADR-031, ADR-032): the documents
 * beneath this one change when somebody moves or adds a document, which is a
 * different cadence from this document's own text. So the list is drawn here, at
 * view time, from the workspace tree the sidebar already holds, and each entry is
 * a routed link like every other address in the application (ADR-035).
 *
 * It draws nothing until the tree has arrived: an empty list and a list that has
 * not loaded are different statements, and only the first is worth printing.
 */
export function ChildDocumentsBlock({
  documentId,
  workspaceSlug,
  depth,
}: ChildDocumentsBlockProps) {
  const document = useDocument(documentId)
  const children = useChildDocuments(document.data, workspaceSlug)

  if (children === undefined) return null
  if (children.length === 0) {
    return <p className="text-sm text-muted">This document has no child documents.</p>
  }
  // The slot is already a labelled region, so the list needs no name of its own.
  return <NestedList items={children} depth={depth} linkComponent={RouterLink} />
}
