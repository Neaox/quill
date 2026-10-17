import type { DocumentId, Principal, ScopeChainFailure } from '@quill/domain'

import type { CollectionRow, DocumentRow, WorkspaceRow } from '../ports/persistence.ts'
import type { OrganisationSettings } from '../settings/documents.ts'
import { documentReference } from './document-path.ts'
import { visibleDocumentIds } from './list-visible-documents.ts'
import { loadPublicSite, publicNavigationOf } from './public-site.ts'
import type { PublicNavigationNode, PublicSiteDependencies } from './public-site.ts'
import { readOrganisationSettings } from './settings.ts'

/**
 * The read model behind the reader preview (`GET /preview/d/:documentRef`).
 *
 * A member asks "what will a reader see?" of any document they may read,
 * published to the web or not, and the answer is rendered by the public
 * site's own templates. So this answers the same questions `loadPublicSite`
 * answers — which organisation, which theme, which documents, how they nest —
 * with two differences, each deliberate:
 *
 * - **The reader is the member asking**, not the public principal. A preview
 *   of a collection that is not published yet would otherwise be empty, which
 *   is the one thing a preview must not be. The route has already checked
 *   `view` on the document through the resolver; this only decides what else
 *   the navigation may list, by the same materialise-and-combine pass the
 *   signed-in tree uses (ADR-012).
 * - **The whole workspace is the navigation**, one section per collection, as
 *   a site spanning more than one collection would show it. Each section is
 *   built by `publicNavigationOf`, so it nests, orders and drops drafts exactly
 *   as the public site does.
 *
 * Entries are keyed by the document's readable reference (ADR-035) rather
 * than by a public path, because a preview links to other previews.
 */

export interface ReaderPreviewCommand {
  readonly documentId: DocumentId
  readonly identities: readonly Principal[]
  /** An instance admin sees every published document, as everywhere else. */
  readonly seesEverything: boolean
}

export interface ReaderPreviewSection {
  readonly collection: CollectionRow
  /** The section's tree; each node's `path` is the document's readable reference. */
  readonly navigation: readonly PublicNavigationNode[]
}

export interface ReaderPreview {
  readonly document: DocumentRow
  readonly collection: CollectionRow
  readonly workspace: WorkspaceRow
  readonly organisation: OrganisationSettings
  readonly sections: readonly ReaderPreviewSection[]
  /** Where an anonymous reader finds this page today, or null when it is not on the web. */
  readonly publicAddress: { readonly siteSlug: string; readonly path: string } | null
}

export type ReaderPreviewResult =
  | { readonly kind: 'preview'; readonly preview: ReaderPreview }
  | { readonly kind: 'not-found' }
  /**
   * The theme is part of what is being previewed, and an unreadable settings
   * file is not folded into the defaults anywhere else (`SettingsRead`), so a
   * preview in somebody else's colours is refused rather than shown.
   */
  | { readonly kind: 'settings-unreadable' }
  | { readonly kind: 'broken-tree'; readonly failure: ScopeChainFailure }

export async function loadReaderPreview(
  deps: PublicSiteDependencies,
  command: ReaderPreviewCommand,
): Promise<ReaderPreviewResult> {
  const { repos } = deps.uow
  const document = await repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found' }

  const [workspace, collections, documents, organisation] = await Promise.all([
    repos.workspaces.findById(document.workspaceId),
    repos.collections.listByWorkspace(document.workspaceId),
    repos.documents.listByWorkspace(document.workspaceId),
    readOrganisationSettings(deps),
  ])
  const collection = collections.find((row) => row.id === document.collectionId)
  // A document filed in no collection, or whose workspace row is gone, has no
  // place in the tenancy tree; the route's authorizer refuses it first.
  /* v8 ignore next */
  if (workspace === null || collection === undefined) return { kind: 'not-found' }
  if (organisation.kind !== 'settings') return { kind: 'settings-unreadable' }

  const byCollection = Map.groupBy(documents, (row) => row.collectionId)
  const visible = command.seesEverything
    ? null
    : await visibleDocumentIds(deps, {
        workspace,
        collections,
        byCollection,
        identities: command.identities,
      })
  /* v8 ignore next -- the tree was just read from the database as one workspace's rows. */
  if (visible !== null && !visible.ok) return { kind: 'broken-tree', failure: visible.failure }

  const shown = (row: DocumentRow): boolean =>
    row.headRevision !== null && (visible === null || visible.ids.has(row.id))
  const references = new Map(documents.map((row) => [row.id, documentReference(row)]))

  const sections = collections.flatMap((candidate): readonly ReaderPreviewSection[] => {
    const rows = (byCollection.get(candidate.id) ?? []).filter(shown)
    // An empty collection is not a section a reader would ever be shown, but
    // the one being previewed always is: it is where the eyebrow points.
    if (rows.length === 0 && candidate.id !== collection.id) return []
    return [{ collection: candidate, navigation: publicNavigationOf(rows, references) }]
  })

  return {
    kind: 'preview',
    preview: {
      document,
      collection,
      workspace,
      organisation: organisation.document,
      sections,
      publicAddress: await publicAddressOf(deps, collection, document),
    },
  }
}

/**
 * Where the page is live, asked of the public site itself.
 *
 * Not re-derived here: `loadPublicSite` is the one authority on what is on a
 * site — the policy, the switch, the public principal's grants, the published
 * revision — and a preview that disagreed with it about whether a page is on
 * the web would be the most misleading thing it could say.
 */
async function publicAddressOf(
  deps: PublicSiteDependencies,
  collection: CollectionRow,
  document: DocumentRow,
): Promise<ReaderPreview['publicAddress']> {
  const siteSlug = collection.publicSite?.enabled === true ? collection.publicSite.siteSlug : null
  if (siteSlug === null) return null
  const loaded = await loadPublicSite(deps, siteSlug)
  if (loaded.kind !== 'site') return null
  const path = loaded.site.pathById.get(document.id)
  return path !== undefined && loaded.site.pages.has(path) ? { siteSlug, path } : null
}
