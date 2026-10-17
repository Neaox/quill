import { internalReference } from '@quill/domain'
import type { DocumentId, LinkPreview, LinkPreviewView } from '@quill/domain'

import type { CollectionRow, DocumentRow, UnitOfWork } from '../ports/persistence.ts'
import type { Authorizer } from './authorizer.ts'
import { parseDocumentReference } from './document-path.ts'
import { MAX_LINKS_PER_READ } from './link-previews.ts'
import { publicPageHref } from './public-site.ts'
import type { PublicSite } from './public-site.ts'

/**
 * Previews of links to other documents of this instance (ADR-042, "Internal
 * links"): the first-party case of layer 1.
 *
 * - **Resolved by id, when read.** No fetch, and nothing stored: the title,
 *   the first paragraph and the place are the document's *now*, so a rename or
 *   a move shows on the next read and a deleted document is simply gone. There
 *   is no snapshot that could go stale, and so none that could outlive a
 *   permission change.
 * - **Per reader.** The rendered body is cached and shared; this is the per
 *   viewer step. A reader who may not view a document is told `blocked`, which
 *   the page draws as a plain, unlinked label: never the title, never a link.
 *   A document that does not exist is answered identically, so the answer
 *   cannot be used to find out which ids exist.
 * - **Two kinds of reader.** A signed-in member, or a share-link holder, is
 *   checked with the request's authorizer (ADR-012). An anonymous reader of a
 *   public site sees only the documents published on *that* site, and is
 *   pointed at their public pages, so a link never leads off the site.
 */

export interface InternalLinkDependencies {
  readonly uow: UnitOfWork
  /**
   * The first paragraph of a document's published body, or null. It costs a
   * render, so it is asked only for the links that will show it.
   */
  readonly describe: (documentId: DocumentId) => Promise<string | null>
}

export type InternalLinkViewer =
  | { readonly kind: 'authorized'; readonly authorizer: Authorizer }
  | { readonly kind: 'site'; readonly site: PublicSite }

export interface InternalLinkQuery {
  readonly viewer: InternalLinkViewer
  /** Internal keys (`/d/<reference>`); others are ignored. */
  readonly keys: readonly string[]
  /** The keys whose description will be shown; the rest are not described. */
  readonly described?: ReadonlySet<string>
}

const UNTITLED = 'Untitled'

/** The document each key names, by id or by its short key, in two queries at most. */
async function findDocuments(
  uow: UnitOfWork,
  keys: readonly string[],
): Promise<ReadonlyMap<string, DocumentRow>> {
  const references = keys.map((key) => ({
    key,
    reference: parseDocumentReference(internalReference(key)),
  }))
  const ids = references.flatMap(({ reference }) =>
    reference?.kind === 'uuid' ? [reference.documentId] : [],
  )
  const shortIds = references.flatMap(({ reference }) =>
    reference?.kind === 'short-id' ? [reference.shortId] : [],
  )
  const [byId, byShortId] = await Promise.all([
    ids.length === 0 ? [] : uow.repos.documents.listByIds(ids),
    shortIds.length === 0 ? [] : uow.repos.documents.listByShortIds(shortIds),
  ])
  const rows = new Map(byId.map((row): [string, DocumentRow] => [row.id, row]))
  const shortRows = new Map(byShortId.map((row): [string, DocumentRow] => [row.shortId, row]))
  return new Map(
    references.flatMap(({ key, reference }) => {
      const row =
        reference?.kind === 'uuid'
          ? rows.get(reference.documentId)
          : reference?.kind === 'short-id'
            ? shortRows.get(reference.shortId)
            : undefined
      return row === undefined ? [] : [[key, row] as const]
    }),
  )
}

function previewOf(
  key: string,
  row: DocumentRow,
  address: string,
  place: string | null,
  description: string | null,
): LinkPreview {
  const title = row.title.trim()
  return {
    url: key,
    canonicalUrl: address,
    title: title === '' ? UNTITLED : title,
    description,
    siteName: place,
    kind: 'article',
    thumbnail: null,
    favicon: null,
    layer: 'internal',
    fetchedAt: row.updatedAt.toISOString(),
  }
}

const blocked: LinkPreviewView = { state: 'blocked' }

async function describedAs(
  deps: InternalLinkDependencies,
  query: InternalLinkQuery,
  key: string,
  row: DocumentRow,
): Promise<string | null> {
  return query.described?.has(key) === true ? deps.describe(row.id) : null
}

export async function readInternalLinkPreviews(
  deps: InternalLinkDependencies,
  query: InternalLinkQuery,
): Promise<ReadonlyMap<string, LinkPreviewView>> {
  const keys = [...new Set(query.keys)].slice(0, MAX_LINKS_PER_READ)
  if (keys.length === 0) return new Map()
  return query.viewer.kind === 'site'
    ? readForSite(deps, query, query.viewer.site, keys)
    : readForReader(deps, query, query.viewer.authorizer, keys)
}

// ---------------------------------------------------------------------------
// A signed-in member, or a share link
// ---------------------------------------------------------------------------

async function readForReader(
  deps: InternalLinkDependencies,
  query: InternalLinkQuery,
  authorizer: Authorizer,
  keys: readonly string[],
): Promise<ReadonlyMap<string, LinkPreviewView>> {
  const found = await findDocuments(deps.uow, keys)
  // The authorizer memoises the tree it walks, so documents under one collection share the work.
  const viewable = await Promise.all(
    [...found].map(async ([key, row]) => {
      const access = await authorizer.document(row.id)
      return access.ok && access.value.capabilities.view ? [[key, row] as const] : []
    }),
  )
  const visible = new Map(viewable.flat())

  const places = await placesFor(deps.uow, authorizer, [...visible.values()])
  const views = await Promise.all(
    keys.map(async (key): Promise<readonly [string, LinkPreviewView]> => {
      const row = visible.get(key)
      if (row === undefined) return [key, blocked]
      const place = row.collectionId === null ? null : (places.get(row.collectionId) ?? null)
      const description = await describedAs(deps, query, key, row)
      return [
        key,
        {
          state: 'ready',
          preview: previewOf(key, row, `/d/${row.id}`, place, description),
          stale: false,
        },
      ]
    }),
  )
  return new Map(views)
}

/**
 * Where each document sits, as the collection's name, in one read plus the
 * reader's own access to each collection: a collection the reader cannot see
 * is not named, even when a grant on the document reaches them.
 */
async function placesFor(
  uow: UnitOfWork,
  authorizer: Authorizer,
  rows: readonly DocumentRow[],
): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(rows.flatMap((row) => row.collectionId ?? []))]
  if (ids.length === 0) return new Map()
  const collections = await uow.repos.collections.listByIds(ids)
  const named = await Promise.all(
    collections.map(async (collection: CollectionRow) => {
      const access = await authorizer.collection(collection.id)
      return access.ok && access.value.capabilities.view
        ? [[collection.id, collection.name] as const]
        : []
    }),
  )
  return new Map(named.flat())
}

// ---------------------------------------------------------------------------
// An anonymous reader of a public site
// ---------------------------------------------------------------------------

/** The page of the site a key names, if the site has it: by id, else by its short key. */
function pageOf(site: PublicSite, key: string): DocumentRow | null {
  const reference = parseDocumentReference(internalReference(key))
  if (reference === null) return null
  if (reference.kind === 'uuid') {
    const path = site.pathById.get(reference.documentId)
    return path === undefined ? null : (site.pages.get(path) ?? null)
  }
  return [...site.pages.values()].find((page) => page.shortId === reference.shortId) ?? null
}

async function readForSite(
  deps: InternalLinkDependencies,
  query: InternalLinkQuery,
  site: PublicSite,
  keys: readonly string[],
): Promise<ReadonlyMap<string, LinkPreviewView>> {
  const views = await Promise.all(
    keys.map(async (key): Promise<readonly [string, LinkPreviewView]> => {
      const row = pageOf(site, key)
      const path = row === null ? undefined : site.pathById.get(row.id)
      // A document that is not published on this site does not exist for this reader.
      if (row === null || path === undefined) return [key, blocked]
      const description = await describedAs(deps, query, key, row)
      return [
        key,
        {
          state: 'ready',
          preview: previewOf(
            key,
            row,
            publicPageHref(site.siteSlug, path),
            site.collection.name,
            description,
          ),
          stale: false,
        },
      ]
    }),
  )
  return new Map(views)
}
