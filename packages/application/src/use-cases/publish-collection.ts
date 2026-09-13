import type { DocumentId, RevisionId, UserId } from '@quill/domain'

import type {
  CollectionId,
  CollectionRow,
  GrantRow,
  RepositoryBundle,
  UnitOfWork,
} from '../ports/persistence.ts'
import type { Settings } from '../ports/settings.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { createGrant } from './create-grant.ts'
import { namedSlug } from './document-path.ts'
import { readOrganisationSettings } from './settings.ts'
import type { SettingsDependencies } from './settings.ts'

/**
 * Turning a collection into a public site, and turning it off again
 * (ADR-023, use cases 27 and 30).
 *
 * Publishing is two facts written together, and they are deliberately not one
 * fact:
 *
 * - **The address**, on the collection's row: whether the site is on, the slug
 *   it answers at, and which document its home shows. These are settings, and
 *   the slug is kept when a site is turned off so that putting it back up
 *   answers at the same place and every link anybody kept still works.
 * - **The permission**, as an ordinary grant — `(public, collection, viewer,
 *   allow)` — so that the resolver already knows the answer. Nothing about
 *   public reading is a second permission system: a public collection *is* a
 *   viewer grant to the public principal (ADR-012), which is also why one
 *   document can be carved back out with a deny at document scope without any
 *   of this knowing.
 *
 * Publishing is refused outright when the organisation's
 * `policies.publicPublishingAllowed` is false; unpublishing never is, because
 * a policy must not be able to strand a site that is already up.
 *
 * Both write **inside one transaction**. The address and the permission are
 * the same fact stated twice, and a half-written pair is worse than either
 * outcome: a site enabled with no grant serves an empty index, and — the one
 * that matters — an unpublish that switched the site off and then failed to
 * remove the grant would leave a viewer grant to `public` standing at a
 * collection whose settings screen says it is not published.
 */

export const PUBLIC_PUBLISHING_AUDIT_EVENTS = {
  published: 'collection.published',
  unpublished: 'collection.unpublished',
} as const

export interface PublishCollectionDependencies extends SettingsDependencies {
  readonly uow: UnitOfWork
  readonly settings: Settings
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface PublishCollectionCommand {
  readonly collectionId: CollectionId
  /** Defaults to the slug the site already had, then to the collection's own. */
  readonly siteSlug?: string | undefined
  /** Absent leaves the home as it was; null clears it back to the index. */
  readonly homeDocumentId?: DocumentId | null | undefined
  readonly publishedBy: UserId
}

export type PublishCollectionResult =
  | { readonly kind: 'published'; readonly collection: CollectionRow }
  | { readonly kind: 'not-found' }
  /** The organisation does not allow public publishing (`policies.publicPublishingAllowed`). */
  | { readonly kind: 'not-allowed' }
  /** Another collection already answers at this address. */
  | { readonly kind: 'slug-taken'; readonly siteSlug: string }
  /** The home document named is not in this collection, so the site could not show it. */
  | { readonly kind: 'home-not-in-collection' }
  /** The home document has never been published, so the site would show its index instead. */
  | { readonly kind: 'home-not-published' }
  /** The organisation's settings cannot be read, so no policy can be applied (ADR-034). */
  | {
      readonly kind: 'settings-unreadable'
      readonly reason: string
      readonly revision: RevisionId
    }

export async function publishCollection(
  deps: PublishCollectionDependencies,
  command: PublishCollectionCommand,
): Promise<PublishCollectionResult> {
  const collection = await deps.uow.repos.collections.findById(command.collectionId)
  if (collection === null) return { kind: 'not-found' }

  const organisation = await readOrganisationSettings(deps)
  if (organisation.kind === 'unreadable') {
    return {
      kind: 'settings-unreadable',
      reason: organisation.reason,
      revision: organisation.revision,
    }
  }
  if (!organisation.document.policies.publicPublishingAllowed) return { kind: 'not-allowed' }

  const siteSlug = namedSlug(command.siteSlug ?? collection.publicSite?.siteSlug ?? collection.name)
  const home = await resolveHome(deps, collection, command.homeDocumentId)
  if (home === 'not-in-collection') return { kind: 'home-not-in-collection' }
  if (home === 'not-published') return { kind: 'home-not-published' }

  return deps.uow.run(async (tx) => {
    const written = await tx.collections.setPublicSite(collection.id, {
      enabled: true,
      siteSlug,
      homeDocumentId: home,
    })
    // The address is claimed by the unique index rather than by a read before
    // it, so two administrators publishing the same slug at the same moment
    // are told the same thing as a caller who was second by a minute.
    if (written.kind === 'slug-taken') return { kind: 'slug-taken', siteSlug }

    // A republish at a different address leaves the old slug's redirects
    // describing a site that no longer exists — and frees that slug for
    // another collection, which would inherit them. They go with the address.
    const previous = collection.publicSite?.siteSlug
    if (previous !== undefined && previous !== siteSlug) {
      await tx.publicRedirects.deleteForSite(previous)
    }

    await grantPublicViewer(deps, tx, collection.id, command.publishedBy)
    await audit(deps, tx, {
      type: PUBLIC_PUBLISHING_AUDIT_EVENTS.published,
      actorUserId: command.publishedBy,
      targetId: collection.id,
      metadata: {
        workspaceId: collection.workspaceId,
        siteSlug,
        homeDocumentId: home,
        ...(previous === undefined || previous === siteSlug ? {} : { previousSiteSlug: previous }),
      },
    })
    return { kind: 'published', collection: written.collection }
  })
}

/**
 * The home document this publish should end with.
 *
 * An omitted field leaves whatever was there — a republish is not a reset —
 * and an explicit `null` clears it. A document that is not in this collection
 * is refused rather than stored, because the site could never show it; so is
 * one that has never been published, because the site would silently fall back
 * to its index and the administrator would debug it twice.
 */
async function resolveHome(
  deps: PublishCollectionDependencies,
  collection: CollectionRow,
  requested: DocumentId | null | undefined,
): Promise<DocumentId | null | 'not-in-collection' | 'not-published'> {
  if (requested === undefined) return collection.publicSite?.homeDocumentId ?? null
  if (requested === null) return null
  const document = await deps.uow.repos.documents.findById(requested)
  if (document === null || document.collectionId !== collection.id) return 'not-in-collection'
  return document.headRevision === null ? 'not-published' : requested
}

export interface UnpublishCollectionCommand {
  readonly collectionId: CollectionId
  readonly unpublishedBy: UserId
}

export type UnpublishCollectionResult =
  | { readonly kind: 'unpublished'; readonly collection: CollectionRow }
  | { readonly kind: 'not-found' }
  /** It was never published, so there is nothing to take down. */
  | { readonly kind: 'not-published' }

export async function unpublishCollection(
  deps: PublishCollectionDependencies,
  command: UnpublishCollectionCommand,
): Promise<UnpublishCollectionResult> {
  const collection = await deps.uow.repos.collections.findById(command.collectionId)
  if (collection === null) return { kind: 'not-found' }
  const site = collection.publicSite
  if (site === null) return { kind: 'not-published' }

  return deps.uow.run(async (tx) => {
    // The slug stays. A site put back up answers where it always did, and the
    // address stays claimed in the meantime so nobody else can take it.
    const written = await tx.collections.setPublicSite(collection.id, { ...site, enabled: false })
    /* v8 ignore next -- the address is this collection's already, so it cannot be taken. */
    if (written.kind === 'slug-taken') return { kind: 'not-published' }
    for (const grant of await publicViewerGrants(tx, collection.id)) {
      await tx.grants.delete(grant.id)
    }
    await audit(deps, tx, {
      type: PUBLIC_PUBLISHING_AUDIT_EVENTS.unpublished,
      actorUserId: command.unpublishedBy,
      targetId: collection.id,
      metadata: { workspaceId: collection.workspaceId, siteSlug: site.siteSlug },
    })
    return { kind: 'unpublished', collection: written.collection }
  })
}

/**
 * The viewer grant to the public principal at this collection, if it is not
 * already there.
 *
 * Written through `createGrant` like every other grant, so the domain's rules
 * — the public principal never above viewer, a deny only at document scope —
 * are checked here too rather than being bypassed by the one command that
 * creates public access (ADR-012).
 */
async function grantPublicViewer(
  deps: PublishCollectionDependencies,
  tx: RepositoryBundle,
  collectionId: CollectionId,
  createdBy: UserId,
): Promise<void> {
  if ((await publicViewerGrants(tx, collectionId)).length > 0) return
  await createGrant(
    // `createGrant` reads `repos` and never opens a transaction of its own;
    // `run` is here because `UnitOfWork` declares it, and it stays inside the
    // one already open rather than starting a second.
    /* v8 ignore next */
    { ...deps, uow: { repos: tx, run: (fn) => fn(tx) } },
    {
      principalKind: 'public',
      principalId: null,
      scopeKind: 'collection',
      scopeId: collectionId,
      role: 'viewer',
      effect: 'allow',
      createdBy,
    },
  )
}

/** Every allow held by the public principal at this collection. */
async function publicViewerGrants(
  tx: RepositoryBundle,
  collectionId: CollectionId,
): Promise<readonly GrantRow[]> {
  const grants = await tx.grants.listForScope('collection', collectionId)
  return grants.filter((grant) => grant.principalKind === 'public' && grant.effect === 'allow')
}

async function audit(
  deps: PublishCollectionDependencies,
  tx: RepositoryBundle,
  event: {
    readonly type: string
    readonly actorUserId: UserId
    readonly targetId: string
    readonly metadata: Readonly<Record<string, unknown>>
  },
): Promise<void> {
  await tx.audit.write({
    id: deps.ids.uuid(),
    type: event.type,
    actorUserId: event.actorUserId,
    targetType: 'collection',
    targetId: event.targetId,
    metadata: event.metadata,
    now: deps.clock.now(),
  })
}
