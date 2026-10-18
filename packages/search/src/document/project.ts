import type {
  CollectionId,
  DocumentId,
  DocumentStatus,
  RevisionId,
  WorkspaceId,
} from '@quill/domain'
import { isDocumentStatus, isLifecycleState } from '@quill/domain'
import { documentIcon, documentSummary, extractOutline, extractText } from '@quill/markdown'
import type { CoreFrontMatter, OutlineEntry } from '@quill/markdown'
import type { Root } from 'mdast'

import {
  headingWeight,
  INDEXABLE_DOCUMENT_VERSION,
  type Contributor,
  type IndexableDocument,
  type IndexableHeading,
} from './indexable-document.ts'
import { extractProperties } from './properties.ts'

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
  /**
   * The words of the drawings the body shows — a draw.io diagram's labels
   * (ADR-043) — which a reader sees on the page but the Markdown does not say.
   * Searched as body text, after the prose.
   */
  readonly drawingText?: readonly string[]
  /**
   * Everyone who has published a revision of the document, as the revisions
   * recorded them, in any order and with repeats: the same person publishes
   * many times and not always spelling their name the same way.
   */
  readonly contributors?: readonly Contributor[]
  /**
   * The document's whole front matter, unknown keys included (rule 7: they
   * survive). `frontMatter` is the core fields read by type; this is where the
   * rest is found, for the generic properties `prop:` asks about.
   */
  readonly rawFrontMatter?: Readonly<Record<string, unknown>>
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
    body: [text.body, ...(input.drawingText ?? [])].filter((part) => part !== '').join('\n'),
    tags: input.frontMatter.tags ?? [],
    owners: input.frontMatter.owners ?? [],
    // One front-matter field, two meanings (ADR-005 amendment of 2026-10-17):
    // a legacy publication word is the `status:` filter's, a lifecycle state
    // is ranking's, and neither is ever read as the other.
    status: isDocumentStatus(input.frontMatter.status) ? input.frontMatter.status : DEFAULT_STATUS,
    lifecycle: isLifecycleState(input.frontMatter.status) ? input.frontMatter.status : undefined,
    updatedAt: input.updatedAt,
    summary: documentSummary(input.ast, input.frontMatter),
    icon: documentIcon(input.frontMatter),
    contributors: distinctContributors(input.contributors ?? []),
    properties: extractProperties(input.rawFrontMatter ?? {}),
  }
}

/**
 * One entry per address, under the first name it was published with.
 *
 * The address is the identity: it is stable where a display name is edited, and
 * it is what `team:` matches exactly. Case and stray spaces are not part of it.
 */
function distinctContributors(contributors: readonly Contributor[]): readonly Contributor[] {
  const byAddress = new Map<string, Contributor>()
  for (const { name, email } of contributors) {
    const address = email.trim().toLowerCase()
    if (!byAddress.has(address)) byAddress.set(address, { name: name.trim(), email: address })
  }
  return [...byAddress.values()]
}

/** Depth-first, so a section's own heading always precedes the subsections nested under it. */
function flattenHeadings(entries: readonly OutlineEntry[]): readonly IndexableHeading[] {
  return entries.flatMap((entry) => [
    { text: entry.text, depth: entry.depth, weight: headingWeight(entry.depth) },
    ...flattenHeadings(entry.children),
  ])
}
