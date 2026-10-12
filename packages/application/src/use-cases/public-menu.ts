import { documentId, isUuid } from '@quill/domain'

import type { CollectionRow, DocumentRow, UnitOfWork, WorkspaceRow } from '../ports/persistence.ts'
import type { PublicMenu, PublicMenuLink } from '../settings/public-menu.ts'
import { menuTargetIds } from '../settings/public-menu.ts'
import { publicPageHref, publicSiteHref } from './public-site.ts'
import type { PublicSite } from './public-site.ts'

/**
 * The public menu, resolved: the settings file names documents and collections
 * by id (`settings/public-menu.ts`), and a page needs titles and addresses.
 *
 * **What a reader is shown.** A document link is in the header only while the
 * document is on a public site — published, visible to the public principal,
 * in a collection whose site is switched on, under an organisation that allows
 * publishing — and it carries the document's *current* title (unless the
 * administrator gave it a label) and its *current* address. A collection link
 * is there while its site is. Anything else is left out rather than linked to
 * a page that would answer 404, and a dropdown left with nothing in it is left
 * out with it. An address link is always there; it names nothing to look up.
 *
 * **Who decides "on a public site".** `loadPublicSite`, and nothing else — the
 * same rule the reader preview follows for its "live at" link. A second
 * reading of the policy, the switch, the grants and the published revision
 * here would be a second place for them to disagree, and a menu that linked
 * to a page its own site refused would be exactly that disagreement. The
 * site loader is injected, so the public routes pass the one their cache
 * already answers from and a site is resolved once however many pages ask.
 *
 * **Cost, never per link** (AGENTS.md rule 13). However long the menu: one
 * read for every document it names, one for the sites that are switched on,
 * and one site load per *distinct* site its targets sit on — each of which the
 * public routes already hold for the pages of that site. The menu is the same
 * on every page of every site, so the routes resolve it once and keep it with
 * the pages (`public-site/cache.ts`); because it is rendered into each page,
 * the page's `ETag` — a hash of the finished HTML — changes when a title in
 * it does, and the events that invalidate that cache (a rename, a move, a
 * publish) are the ones that change what this answers.
 */

export interface ResolvedMenuLink {
  readonly label: string
  readonly href: string
  /** True for an address off this site, which the header marks and opens with `noopener`. */
  readonly external: boolean
  /** Whether an external destination is told which page the reader came from. */
  readonly referrer: 'hidden' | 'sent'
}

export type ResolvedMenuItem =
  | { readonly kind: 'link'; readonly link: ResolvedMenuLink }
  | { readonly kind: 'group'; readonly label: string; readonly links: readonly ResolvedMenuLink[] }

export type ResolvedPublicMenu = readonly ResolvedMenuItem[]

/** A public site by its slug, or null when no site answers there. */
export type PublicSiteLoader = (siteSlug: string) => Promise<PublicSite | null>

export interface PublicMenuDependencies {
  readonly uow: UnitOfWork
  readonly loadSite: PublicSiteLoader
}

/** Where a document or collection is on the public web, or null when it is not. */
interface PublicPlacement {
  readonly title: string
  readonly href: string
}

interface Placements {
  readonly documents: ReadonlyMap<string, PublicPlacement>
  readonly collections: ReadonlyMap<string, PublicPlacement>
}

/**
 * Where on the public web each of these documents and collections is today.
 * An id that is absent from the answer is not on it — gone, private, a draft,
 * or on a site that is switched off.
 */
async function publicPlacements(
  deps: PublicMenuDependencies,
  documents: readonly DocumentRow[],
  collectionIds: readonly string[],
): Promise<Placements> {
  if (documents.length === 0 && collectionIds.length === 0) {
    return { documents: new Map(), collections: new Map() }
  }
  const sites = await deps.uow.repos.collections.listPublicSites()
  // Whether a site is on is `loadSite`'s to say, not a second reading here.
  const slugByCollection = new Map<string, string | undefined>(
    sites.map((row) => [row.id, row.publicSite?.siteSlug]),
  )

  const wanted = new Set<string>()
  for (const id of collectionIds) {
    const slug = slugByCollection.get(id)
    if (slug !== undefined) wanted.add(slug)
  }
  for (const document of documents) {
    const slug =
      document.collectionId === null ? undefined : slugByCollection.get(document.collectionId)
    if (slug !== undefined) wanted.add(slug)
  }
  const loaded = new Map(
    await Promise.all([...wanted].map(async (slug) => [slug, await deps.loadSite(slug)] as const)),
  )
  const siteOf = (collectionId: string | null): PublicSite | null => {
    if (collectionId === null) return null
    const slug = slugByCollection.get(collectionId)
    return slug === undefined ? null : (loaded.get(slug) ?? null)
  }

  const documentPlacements = new Map<string, PublicPlacement>()
  for (const document of documents) {
    const site = siteOf(document.collectionId)
    const path = site?.pathById.get(document.id)
    if (site === null || path === undefined || !site.pages.has(path)) continue
    documentPlacements.set(document.id, {
      title: document.title,
      href: publicPageHref(site.siteSlug, path),
    })
  }
  const collectionPlacements = new Map<string, PublicPlacement>()
  for (const id of collectionIds) {
    const site = siteOf(id)
    if (site === null) continue
    collectionPlacements.set(id, {
      title: site.collection.name,
      href: publicSiteHref(site.siteSlug),
    })
  }
  return { documents: documentPlacements, collections: collectionPlacements }
}

/** The ids that can name a document at all; anything else names nothing and is simply missing. */
function documentIds(ids: readonly string[]) {
  return ids.filter(isUuid).map(documentId)
}

/** An address off this site: anything absolute, since a rooted path is this site's own. */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//iu.test(href)
}

export async function resolvePublicMenu(
  deps: PublicMenuDependencies,
  menu: PublicMenu,
): Promise<ResolvedPublicMenu> {
  const targets = menuTargetIds(menu)
  const documents = await deps.uow.repos.documents.listByIds(documentIds(targets.documents))
  const placements = await publicPlacements(deps, documents, targets.collections)

  const resolve = (link: PublicMenuLink): ResolvedMenuLink | null => {
    if (link.kind === 'url') {
      return {
        label: link.label,
        href: link.href,
        external: isExternalHref(link.href),
        referrer: ('referrer' in link ? link.referrer : undefined) ?? 'hidden',
      }
    }
    const placed = (link.kind === 'document' ? placements.documents : placements.collections).get(
      link.id,
    )
    return placed === undefined
      ? null
      : {
          label: link.label ?? placed.title,
          href: placed.href,
          external: false,
          referrer: 'hidden',
        }
  }

  return menu.flatMap((item): ResolvedMenuItem[] => {
    if (item.kind !== 'group') {
      const link = resolve(item)
      return link === null ? [] : [{ kind: 'link', link }]
    }
    const links = item.items.flatMap((entry) => resolve(entry) ?? [])
    return links.length === 0 ? [] : [{ kind: 'group', label: item.label, links }]
  })
}

/**
 * What the menu editor shows about one document or collection a link names:
 * its current title, where it sits, and whether a reader will see it.
 */
export interface MenuTargetDescription {
  readonly kind: 'document' | 'collection'
  readonly id: string
  /**
   * `public`: in the header, at `href`. `not-public`: it exists, but is not on
   * a public site, so the link is left out until it is. `missing`: nothing has
   * this id any more — deleted — and the link should be repointed or removed.
   */
  readonly status: 'public' | 'not-public' | 'missing'
  /** The current title, or null when the target is missing. */
  readonly title: string | null
  readonly workspaceName: string | null
  /** The collection a document is filed in; null for a collection itself. */
  readonly collectionName: string | null
  readonly href: string | null
}

export interface DescribeMenuTargetsCommand {
  readonly documents: readonly string[]
  readonly collections: readonly string[]
}

/**
 * Every target named, described for the editor — an instance administrator's
 * view, so titles are shown whether or not the target is public; the routes
 * that call this are instance administration and nobody else's.
 *
 * The same reads as `resolvePublicMenu`, plus one for the collections and one
 * for the workspaces, whatever the number of targets.
 */
export async function describeMenuTargets(
  deps: PublicMenuDependencies,
  command: DescribeMenuTargetsCommand,
): Promise<readonly MenuTargetDescription[]> {
  const { repos } = deps.uow
  const documents = await repos.documents.listByIds(documentIds(command.documents))
  const collectionIds = new Set<string>(command.collections)
  for (const document of documents) {
    if (document.collectionId !== null) collectionIds.add(document.collectionId)
  }
  const [collections, workspaces, placements] = await Promise.all([
    repos.collections.listByIds([...collectionIds]),
    repos.workspaces.listAll(),
    publicPlacements(deps, documents, command.collections),
  ])
  const documentById = new Map<string, DocumentRow>(documents.map((row) => [row.id, row]))
  const collectionById = new Map<string, CollectionRow>(collections.map((row) => [row.id, row]))
  const workspaceById = new Map<string, WorkspaceRow>(workspaces.map((row) => [row.id, row]))

  return [
    ...command.documents.map((id): MenuTargetDescription => {
      const document = documentById.get(id)
      if (document === undefined) return missingTarget('document', id)
      const placed = placements.documents.get(id)
      return {
        kind: 'document',
        id,
        status: placed === undefined ? 'not-public' : 'public',
        title: document.title,
        workspaceName: nameOf(workspaceById, document.workspaceId),
        collectionName:
          document.collectionId === null ? null : nameOf(collectionById, document.collectionId),
        href: placed?.href ?? null,
      }
    }),
    ...command.collections.map((id): MenuTargetDescription => {
      const collection = collectionById.get(id)
      if (collection === undefined) return missingTarget('collection', id)
      const placed = placements.collections.get(id)
      return {
        kind: 'collection',
        id,
        status: placed === undefined ? 'not-public' : 'public',
        title: collection.name,
        workspaceName: nameOf(workspaceById, collection.workspaceId),
        collectionName: null,
        href: placed?.href ?? null,
      }
    }),
  ]
}

/**
 * The name of the workspace or collection a row just read sits in.
 *
 * Always there: a document's workspace and a collection's workspace cascade
 * their deletion to it, and a deleted collection leaves its documents filed in
 * none, so the null is for the type, not for a reader.
 */
function nameOf(rows: ReadonlyMap<string, { readonly name: string }>, id: string): string | null {
  /* v8 ignore next -- unreachable: the foreign keys above keep the row this names. */
  return rows.get(id)?.name ?? null
}

/** A target nothing has the id of any more. */
function missingTarget(kind: MenuTargetDescription['kind'], id: string): MenuTargetDescription {
  return {
    kind,
    id,
    status: 'missing',
    title: null,
    workspaceName: null,
    collectionName: null,
    href: null,
  }
}

/** One collection a link could point at, for the editor's combobox. */
export interface CollectionCandidate {
  readonly id: string
  readonly name: string
  readonly workspaceName: string
  readonly isPublic: boolean
}

/** Collections in any workspace whose name contains `query`, for an administrator's picker. */
export async function findCollectionCandidates(
  deps: { readonly uow: UnitOfWork },
  query: string,
  limit: number,
): Promise<readonly CollectionCandidate[]> {
  const { repos } = deps.uow
  const [collections, workspaces] = await Promise.all([
    repos.collections.searchByName(query.trim(), limit),
    repos.workspaces.listAll(),
  ])
  const workspaceById = new Map<string, WorkspaceRow>(workspaces.map((row) => [row.id, row]))
  return collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    /* v8 ignore next -- a collection's workspace cannot be missing: the row cascades from it. */
    workspaceName: workspaceById.get(collection.workspaceId)?.name ?? '',
    isPublic: collection.publicSite?.enabled === true,
  }))
}
