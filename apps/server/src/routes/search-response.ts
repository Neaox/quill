import type { CollectionRow, Contributor, DocumentRow, WorkspaceRow } from '@quill/application'
import type { SearchServiceHit, SearchServiceResults } from '@quill/search'
import type { CollectionId, DocumentId, WorkspaceId } from '@quill/domain'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import { FacetsSchema } from './search-facets.ts'

/**
 * A hit carries a document id, a title, and a snippet. A result row needs the
 * short key and slug its address is built from (ADR-035), the path, and where
 * the document sits — none of which the index holds, because none of it is
 * content. This is where the two are put together.
 *
 * Kept apart from the route so that assembling a response is a pure function
 * of what was loaded: the route decides what to load, this decides what the
 * answer looks like, and the shapes it has to be careful about — a document
 * that has gone since the query, a workspace group with nothing left in it —
 * are testable without a database or an HTTP request.
 */

const SnippetRangeSchema = Type.Object({
  start: Type.Integer({ minimum: 0 }),
  end: Type.Integer({ minimum: 0 }),
})

const SnippetSchema = Type.Object({
  /** The excerpt itself, plain text: `ranges` are offsets into this string. */
  text: Type.String(),
  /** Where the matches are, as character offsets, so a surface marks them however it likes (ADR-010). */
  ranges: Type.Array(SnippetRangeSchema),
})

const WorkspaceRefSchema = Type.Object({
  id: Type.String(),
  slug: Type.String(),
  name: Type.String(),
})

/** Somebody who has published a revision, by the name they published under and nothing else. */
const ContributorSchema = Type.Object({ name: Type.String() })

/** A result row names at most this many tags and people; the rest are counted or left to the document. */
const MAX_TAGS = 5
const MAX_CONTRIBUTORS = 3

const SearchHitSchema = Type.Object({
  documentId: Type.String(),
  /** The short key a readable address carries (ADR-035); with `slug` it is the whole link. */
  shortId: Type.String(),
  slug: Type.String(),
  title: Type.String(),
  path: Type.String(),
  workspaceId: Type.String(),
  /** Workspace, then collection: where the document sits, for a result that is not just a title. */
  breadcrumb: Type.Array(Type.String()),
  snippet: SnippetSchema,
  score: Type.Number(),
  /** The document's status as the row holds it (`draft`, `published`, `archived`). */
  status: Type.String(),
  /** When the document last changed, ISO 8601. */
  updatedAt: Type.String(),
  /** The tags it was indexed with, folded to lower case, in stored order: at most five. */
  tags: Type.Array(Type.String()),
  /** Who has published it, most recent publisher first: names only, never addresses, at most three. */
  contributors: Type.Array(ContributorSchema),
  /** How many distinct people have published it, so a row can say "Ada, Sam +2". */
  contributorCount: Type.Integer({ minimum: 0 }),
})

const WorkspaceHitsSchema = Type.Object({
  workspace: WorkspaceRefSchema,
  hits: Type.Array(SearchHitSchema),
})

export const SearchResultsSchema = Type.Object({
  /** The query as it was read back from the parsed form, so a client can show what was actually searched. */
  query: Type.String(),
  current: Type.Array(SearchHitSchema),
  elsewhere: Type.Array(WorkspaceHitsSchema),
  nextCursor: Type.Optional(Type.String()),
  /** Present only when `facets` was asked for: the counts of what the query matched. */
  facets: Type.Optional(FacetsSchema),
})

export type SearchHitResponse = Static<typeof SearchHitSchema>
export type SearchResponse = Static<typeof SearchResultsSchema>

export interface SearchContext {
  readonly documentsById: ReadonlyMap<DocumentId, DocumentRow>
  readonly workspacesById: ReadonlyMap<WorkspaceId, WorkspaceRow>
  readonly collectionsById: ReadonlyMap<CollectionId, CollectionRow>
  /** Everyone who has published each document on the page, most recent first, from one query. */
  readonly contributorsById: ReadonlyMap<DocumentId, readonly Contributor[]>
}

export function toSearchResponse(
  queryText: string,
  results: SearchServiceResults,
  context: SearchContext,
): SearchResponse {
  const present = (hit: SearchServiceHit): readonly SearchHitResponse[] => {
    const document = context.documentsById.get(hit.documentId)
    // A document deleted between the query and this read has no row left to
    // describe. Dropping it shows the reader what they would have seen a
    // moment later anyway, and can never be a leak.
    return document === undefined ? [] : [toHit(hit, document, context)]
  }

  return {
    query: queryText,
    current: results.current.flatMap(present),
    elsewhere: results.elsewhere.flatMap((group) => {
      const workspace = context.workspacesById.get(group.workspaceId)
      const hits = group.hits.flatMap(present)
      // A group with no workspace to name, or nothing left in it, is not a
      // suggestion — it is an empty heading.
      return workspace === undefined || hits.length === 0
        ? []
        : [{ workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name }, hits }]
    }),
    ...(results.nextCursor === undefined ? {} : { nextCursor: results.nextCursor }),
  }
}

/** Workspace, then collection: a result that says where the document lives, not just what it is called. */
function toHit(
  hit: SearchServiceHit,
  document: DocumentRow,
  context: SearchContext,
): SearchHitResponse {
  const workspace = context.workspacesById.get(document.workspaceId)
  const contributors = context.contributorsById.get(document.id) ?? []
  const collection =
    document.collectionId === null
      ? undefined
      : context.collectionsById.get(document.collectionId as CollectionId)

  return {
    documentId: document.id,
    shortId: document.shortId,
    slug: document.slug,
    title: hit.title,
    path: document.path,
    workspaceId: document.workspaceId,
    breadcrumb: [workspace?.name, collection?.name].filter((name) => name !== undefined),
    snippet: { text: hit.snippet.text, ranges: [...hit.snippet.ranges] },
    score: hit.score,
    status: document.status,
    updatedAt: document.updatedAt.toISOString(),
    tags: hit.tags.slice(0, MAX_TAGS),
    contributors: contributors
      .slice(0, MAX_CONTRIBUTORS)
      .map(({ name }) => ({ name: nameOnly(name) })),
    contributorCount: contributors.length,
  }
}

/**
 * A name, and never an address.
 *
 * A revision records whatever its author's tool called them, and a Git
 * configuration with an address where the name should be is common enough. The
 * response promises names only, so the part before the `@` stands in: it is
 * still recognisably the person, and the address is not disclosed to somebody
 * who could not otherwise see it.
 */
function nameOnly(name: string): string {
  const [localPart = ''] = name.split('@')
  return localPart.trim()
}
