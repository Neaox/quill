import { PUBLIC_PRINCIPAL, slugify } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import type { CollectionRow, DocumentRow, UnitOfWork } from '../ports/persistence.ts'
import type { Settings } from '../ports/settings.ts'
import type { OrganisationSettings } from '../settings/documents.ts'
import { visibleDocumentIds } from './list-visible-documents.ts'
import { readOrganisationSettings } from './settings.ts'
import type { SettingsDependencies } from './settings.ts'

/**
 * The read model behind every public page (ADR-023, ADR-035).
 *
 * One load answers everything a server-rendered page needs — which collection
 * the address names, what the organisation configured, which of its documents
 * this anonymous reader may see, what each one's address is, and how they
 * nest — because every public route asks the same four questions and a site
 * that answered them differently in the navigation and on the page would be
 * leaking by inconsistency rather than by permission.
 *
 * Three rules hold the surface shut, and each has a test named after it:
 *
 * - **Only published documents exist here.** A document with no head revision
 *   is absent from the navigation, from the sitemap and from every path, so a
 *   draft cannot be reached even by guessing its address.
 * - **The reader is the public principal and nothing else.** Visibility is
 *   decided by the same materialise-and-combine pass the signed-in navigation
 *   tree uses (ADR-012), so a document carved out with a deny to `public` is
 *   absent here while the people who write it still see it in the app.
 * - **Publishing is a policy the organisation holds.** With
 *   `policies.publicPublishingAllowed` off, every address answers as if no
 *   site were there — so turning the policy off takes the sites down rather
 *   than merely hiding the control that made them.
 */

/** Where a public site lives: `/s/<siteSlug>`. */
export const PUBLIC_SITE_PREFIX = '/s'

export function publicSiteHref(siteSlug: string): string {
  return `${PUBLIC_SITE_PREFIX}/${siteSlug}`
}

/** The address of one page: the site, then the document's path within it. */
export function publicPageHref(siteSlug: string, path: string): string {
  return `${publicSiteHref(siteSlug)}/${path}`
}

/** What a document needs to have an address of its own. */
export interface AddressableDocument {
  readonly id: DocumentId
  readonly shortId: string
  readonly title: string
  readonly createdAt: Date
}

/**
 * Every document's path under its site, as `<collection slug>/<title slug>`.
 *
 * The words come from the *current* title, which is what makes a public
 * address readable and what makes a rename move it — the reason ADR-035 pays
 * for a redirect table here and nowhere else.
 *
 * Two rules make it total and stable:
 *
 * - A title that slugifies to nothing — one made of symbols — falls back to
 *   the document's short key, so every document has an address.
 * - When two titles slugify the same, the **earliest created** document keeps
 *   the plain segment and the others take their short key as a suffix. Sorting
 *   by creation rather than by whatever order the rows arrived in is what
 *   makes the table a function of the collection rather than of a query plan,
 *   and computing it over *every* document in the collection — not only the
 *   ones this reader may see — is what stops carving one page out of the site
 *   moving another page's address.
 *
 *   The one thing that does move an address is deleting the earliest of two
 *   documents that collide, which hands the plain segment to the survivor. It
 *   is left as it is: the alternative is suffixing every colliding document,
 *   which moves an address whenever a second one merely appears.
 */
export function publicDocumentPaths(
  collection: { readonly slug: string },
  documents: Iterable<AddressableDocument>,
): ReadonlyMap<DocumentId, string> {
  const ordered = [...documents].toSorted(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() || (left.id < right.id ? -1 : 1),
  )
  const taken = new Set<string>()
  const paths = new Map<DocumentId, string>()
  for (const document of ordered) {
    const words = slugify(document.title)
    const preferred = words.length === 0 ? document.shortId : words
    const segment = taken.has(preferred) ? `${preferred}-${document.shortId}` : preferred
    taken.add(segment)
    paths.set(document.id, `${collection.slug}/${segment}`)
  }
  return paths
}

/** One entry of a site's navigation tree, mirroring how the documents nest. */
export interface PublicNavigationNode {
  readonly documentId: DocumentId
  readonly title: string
  readonly path: string
  readonly children: readonly PublicNavigationNode[]
}

export interface PublicSite {
  readonly collection: CollectionRow
  readonly siteSlug: string
  readonly organisation: OrganisationSettings
  /** Every page of the site, by its path under `/s/<siteSlug>/`. */
  readonly pages: ReadonlyMap<string, DocumentRow>
  readonly pathById: ReadonlyMap<DocumentId, string>
  readonly navigation: readonly PublicNavigationNode[]
  /**
   * What the site's home shows: the collection's home document, or null when
   * none is set or the one that is set is not on the site, in which case the
   * home is an index of the navigation.
   */
  readonly home: DocumentRow | null
}

export type LoadPublicSiteResult =
  | { readonly kind: 'site'; readonly site: PublicSite }
  /**
   * No site answers here. One outcome for every reason — an unknown slug, a
   * site that has been unpublished, an organisation that no longer allows
   * publishing, and settings this release cannot read — because a reader with
   * no account learns nothing from the difference and the route answers all
   * four with the same page.
   */
  | { readonly kind: 'not-found' }

export interface PublicSiteDependencies extends SettingsDependencies {
  readonly uow: UnitOfWork
  readonly settings: Settings
}

export async function loadPublicSite(
  deps: PublicSiteDependencies,
  siteSlug: string,
): Promise<LoadPublicSiteResult> {
  const { repos } = deps.uow
  const collection = await repos.collections.findBySiteSlug(siteSlug)
  if (collection?.publicSite?.enabled !== true) return { kind: 'not-found' }

  const organisation = await readOrganisationSettings(deps)
  if (organisation.kind !== 'settings') return { kind: 'not-found' }
  if (!organisation.document.policies.publicPublishingAllowed) return { kind: 'not-found' }

  const workspace = await repos.workspaces.findById(collection.workspaceId)
  /* v8 ignore next -- a collection's workspace cannot be missing: the row cascades from it. */
  if (workspace === null) return { kind: 'not-found' }

  const documents = await repos.documents.listByCollection(collection.id)
  const pathById = publicDocumentPaths(collection, documents)

  // The scope chain of a document in this collection runs through this
  // collection, its workspace and the units above it, so the other
  // collections of the workspace decide nothing here and are not read.
  const visible = await visibleDocumentIds(deps, {
    workspace,
    collections: [collection],
    byCollection: new Map([[collection.id, documents]]),
    identities: [PUBLIC_PRINCIPAL],
  })
  /* v8 ignore next -- the tree was just read from the database as one collection's rows. */
  if (!visible.ok) return { kind: 'not-found' }

  const published = documents.filter(
    (document) => document.headRevision !== null && visible.ids.has(document.id),
  )

  const pages = new Map<string, DocumentRow>()
  for (const document of published) {
    const path = pathById.get(document.id)
    /* v8 ignore next -- every document in the collection is in the path table. */
    if (path === undefined) continue
    pages.set(path, document)
  }

  const home = collection.publicSite.homeDocumentId
  return {
    kind: 'site',
    site: {
      collection,
      siteSlug,
      organisation: organisation.document,
      pages,
      pathById,
      navigation: navigationOf(published, pathById),
      home: (home === null ? null : published.find((row) => row.id === home)) ?? null,
    },
  }
}

/**
 * The site's navigation, nesting as the documents do.
 *
 * A document whose parent is not on the site is lifted to the top rather than
 * disappearing with it — its own grant said it is public, and the reader must
 * not lose a page because the page above it was carved out — which is the same
 * rule the signed-in tree follows (`getWorkspaceTree`).
 */
function navigationOf(
  documents: readonly DocumentRow[],
  pathById: ReadonlyMap<DocumentId, string>,
): readonly PublicNavigationNode[] {
  const present = new Set(documents.map((document) => document.id))
  const byParent = Map.groupBy(documents, (document) =>
    document.parentId !== null && present.has(document.parentId) ? document.parentId : null,
  )
  const build = (rows: readonly DocumentRow[]): readonly PublicNavigationNode[] =>
    rows
      .toSorted((left, right) => left.title.localeCompare(right.title))
      .map((row) => ({
        documentId: row.id,
        title: row.title,
        /* v8 ignore next -- every document on the site is in the path table. */
        path: pathById.get(row.id) ?? '',
        children: build(byParent.get(row.id) ?? []),
      }))
  return build(byParent.get(null) ?? [])
}

/**
 * When each of these documents was last published, by document id.
 *
 * The head revision's timestamp rather than the row's `updated_at`, because
 * that column moves for reasons a reader never sees — a move, a status change
 * — and `lastmod` is a promise to a crawler that the page itself changed
 * (use case 29).
 */
export async function publishedAt(
  deps: { readonly uow: UnitOfWork },
  documents: readonly DocumentRow[],
): Promise<ReadonlyMap<DocumentId, Date>> {
  const heads = await deps.uow.repos.revisions.listHeads(documents.map((row) => row.id))
  const byDocument = new Map(heads.map((row) => [row.documentId, row.timestamp]))
  // A document the index has no row for — one restored from files before a
  // reindex — still has to answer with a date, and its row's own stamp is the
  // best one available.
  return new Map(
    documents.map((document) => [document.id, byDocument.get(document.id) ?? document.updatedAt]),
  )
}
