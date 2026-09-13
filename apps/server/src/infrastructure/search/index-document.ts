import { readPublished } from '@quill/application'
import type { ReadPublishedDependencies, SearchIndex } from '@quill/application'
import { isDocumentStatus } from '@quill/domain'
import type { CollectionId, DocumentId, DocumentStatus, RevisionId } from '@quill/domain'
import { parseDocument } from '@quill/markdown'
import type { CoreFrontMatter } from '@quill/markdown'
import { projectIndexableDocument } from '@quill/search'

/**
 * Putting one published document into the search index, or taking it out.
 *
 * This is the whole of what indexing does, shared by the outbox consumer that
 * runs it on a publish and by `quill reindex`, which runs it over everything
 * (ADR-010: "indexing is driven by `DocumentPublished` outbox events. A
 * reindex command rebuilds the index from the content store."). Both take the
 * same route in, so a rebuilt index is the same index, and the test that
 * proves one proves the other.
 *
 * The projection itself is `@quill/search`'s `projectIndexableDocument`, over
 * the published Markdown read back from the content store: search sees the
 * text a reader sees, because it is extracted from the same tree the reader's
 * body is rendered from.
 *
 * Every path is idempotent. Indexing is an upsert, removal is a delete of
 * something that may not be there, and an unpublished or deleted document is
 * removed rather than left behind — at-least-once delivery means a consumer
 * has to be safe to run twice, and a reindex has to be safe to run at all.
 */

export interface IndexDocumentDependencies extends ReadPublishedDependencies {
  readonly searchIndex: SearchIndex
}

export type IndexDocumentOutcome =
  | { readonly kind: 'indexed'; readonly documentId: DocumentId; readonly revision: RevisionId }
  /** The document is gone, or has never been published: there is nothing to find, so nothing is indexed. */
  | { readonly kind: 'removed'; readonly documentId: DocumentId }

export async function indexDocument(
  deps: IndexDocumentDependencies,
  documentId: DocumentId,
): Promise<IndexDocumentOutcome> {
  const document = await deps.uow.repos.documents.findById(documentId)
  const published = await readPublished(deps, { documentId })

  if (document === null || published.kind !== 'found') {
    await deps.searchIndex.remove(documentId)
    return { kind: 'removed', documentId }
  }

  const { frontMatter, ast } = parseDocument(published.markdown)
  await deps.searchIndex.index(
    projectIndexableDocument({
      documentId,
      revision: published.revision,
      workspaceId: document.workspaceId,
      collectionId: document.collectionId as CollectionId | null,
      path: published.path,
      updatedAt: document.updatedAt,
      frontMatter: toCoreFrontMatter(documentId, frontMatter, document.title),
      ast,
    }),
  )

  return { kind: 'indexed', documentId, revision: published.revision }
}

/**
 * The front-matter fields the projection reads, taken from the document's own
 * front matter by type rather than by assertion.
 *
 * Front matter is open by design (ADR-005): a field may hold anything an
 * author or a workspace schema put there, so a value of the wrong shape is
 * simply not indexed under that name instead of being forced into it. That is
 * also why a status this build does not know falls back to the default rather
 * than reaching the index as a filter value nothing can ever match.
 *
 * The one field taken from the row rather than the content is the title, and
 * only because a rename is not a publish: it writes the new title into the
 * document *and* into the row, and the published Markdown catches up at the
 * next publish (ADR-015). Until then the row is what every other surface
 * shows, and a search result is not the place to be the last thing still
 * calling a document by its old name. `documents.title` is derived from the
 * same content this reads (ADR-034), so outside that window the two agree.
 */
function toCoreFrontMatter(
  documentId: DocumentId,
  frontMatter: Record<string, unknown>,
  title: string,
): CoreFrontMatter {
  const status: unknown = frontMatter['status']
  return {
    id: documentId,
    title,
    ...(isDocumentStatus(status) ? { status: status satisfies DocumentStatus } : {}),
    tags: strings(frontMatter['tags']),
    owners: strings(frontMatter['owners']),
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
}
