import type {
  CollectionId,
  DocumentId,
  DocumentStatus,
  RevisionId,
  WorkspaceId,
} from '@quill/domain'
import { extractOutline, extractText } from '@quill/markdown'
import type { CoreFrontMatter, OutlineEntry } from '@quill/markdown'
import type { Root } from 'mdast'

import {
  headingWeight,
  INDEXABLE_DOCUMENT_VERSION,
  type IndexableDocument,
  type IndexableHeading,
} from './indexable-document.ts'

/** A document's identity and placement, which the AST and front matter do not carry themselves. */
export interface DocumentLocation {
  readonly documentId: DocumentId
  /** The revision the Markdown came from, recorded on the index entry (ADR-034). */
  readonly revision: RevisionId
  readonly workspaceId: WorkspaceId
  readonly collectionId: CollectionId | null
  readonly path: string
  readonly updatedAt: Date
}

export interface ProjectIndexableDocumentInput extends DocumentLocation {
  readonly frontMatter: CoreFrontMatter
  readonly ast: Root
}

/** A document whose front matter never says otherwise is indexed as published: this projection only ever runs from a `DocumentPublished` event. */
const DEFAULT_STATUS: DocumentStatus = 'published'

/**
 * Projects a published document into the shape a search engine adapter
 * indexes (ADR-010), using `@quill/markdown`'s own extractors so the text
 * search sees is exactly the text a reader sees: `extractText` for the body
 * and a title fallback, `extractOutline` for the heading tree, which is
 * flattened here because ranking treats headings as a weighted bag, not a
 * tree.
 */
export function projectIndexableDocument(input: ProjectIndexableDocumentInput): IndexableDocument {
  const text = extractText(input.ast)
  const outline = extractOutline(input.ast)

  return {
    version: INDEXABLE_DOCUMENT_VERSION,
    documentId: input.documentId,
    revision: input.revision,
    workspaceId: input.workspaceId,
    collectionId: input.collectionId,
    path: input.path,
    title: input.frontMatter.title ?? text.title ?? input.path,
    headings: flattenHeadings(outline),
    body: text.body,
    tags: input.frontMatter.tags ?? [],
    owners: input.frontMatter.owners ?? [],
    status: input.frontMatter.status ?? DEFAULT_STATUS,
    updatedAt: input.updatedAt,
  }
}

/** Depth-first, so a section's own heading always precedes the subsections nested under it. */
function flattenHeadings(entries: readonly OutlineEntry[]): readonly IndexableHeading[] {
  return entries.flatMap((entry) => [
    { text: entry.text, depth: entry.depth, weight: headingWeight(entry.depth) },
    ...flattenHeadings(entry.children),
  ])
}
