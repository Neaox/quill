import type { DocumentId } from '@quill/domain'

import type { CollectionId, CollectionRow, DocumentRow, UnitOfWork } from '../ports/persistence.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { publicDocumentPaths } from './public-site.ts'

/**
 * Keeping a public address working after the page behind it moves (ADR-035).
 *
 * A public URL is built from the collection's slug and the document's current
 * title, which is what makes it readable and what makes a rename change it.
 * ADR-035 accepts that cost here, and only here, on one condition: the old
 * address keeps working. So a rename or a move of a document in a published
 * collection writes the address it used to have into `public_redirects`, and
 * the route answers that address with a `301` to wherever the document lives
 * now.
 *
 * Three things are deliberate.
 *
 * **The table never decides an address.** A row is only ever old path →
 * document id; the current path is recomputed from the document every time.
 * So a redirect cannot become a second, stale opinion about where a page is.
 *
 * **The previous address is derived, not remembered.** The events carry what
 * changed — the former title, the former collection — and the address is
 * recomputed from the collection as it is now with that one fact put back.
 * Storing the address on the row instead would be a fourth copy of a rule that
 * already has one home (`publicDocumentPaths`).
 *
 * **A collection that has ever been published keeps writing redirects**, even
 * while its site is switched off, because a site that comes back must not come
 * back with its history of addresses missing.
 */

export interface PublicRedirectDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface RecordRenameRedirectCommand {
  readonly documentId: DocumentId
  /** The title the document had before the rename; '' when the event did not carry one. */
  readonly previousTitle: string
}

/**
 * Records where this document used to answer, after a rename.
 *
 * Silent about everything that is not a public address: a document that has
 * gone, one filed in no collection, one whose collection has never been
 * published, and a rename whose slug did not change — `Set up` to `Set-up`,
 * say — all write nothing.
 */
export async function recordRenameRedirect(
  deps: PublicRedirectDependencies,
  command: RecordRenameRedirectCommand,
): Promise<void> {
  const document = await findPublishedIn(deps, command.documentId)
  if (document === null) return
  const { collection, row, siblings } = document

  const before = publicDocumentPaths(
    collection,
    siblings.map((sibling) =>
      sibling.id === row.id ? { ...sibling, title: command.previousTitle } : sibling,
    ),
  )
  await moveAddress(deps, {
    collection,
    documentId: row.id,
    from: before.get(row.id),
    to: publicDocumentPaths(collection, siblings).get(row.id),
  })
}

export interface RecordMoveRedirectCommand {
  readonly documentId: DocumentId
  readonly fromCollectionId: CollectionId | null
}

/**
 * Records where this document used to answer, after a move between
 * collections.
 *
 * The old address belongs to the collection it left, which may be a different
 * site from the one it joined — or the only published one of the two. Both
 * halves are considered: the redirect is written on the site it left, and any
 * redirect standing at its new address is removed so the page cannot redirect
 * to itself.
 */
export async function recordMoveRedirect(
  deps: PublicRedirectDependencies,
  command: RecordMoveRedirectCommand,
): Promise<void> {
  const { repos } = deps.uow
  const row = await repos.documents.findById(command.documentId)
  if (row === null) return

  if (command.fromCollectionId !== null) {
    const from = await repos.collections.findById(command.fromCollectionId)
    if (from?.publicSite != null) {
      // The document has already left, so its former siblings are what the
      // collection holds now plus the document itself.
      const before = publicDocumentPaths(from, [
        ...(await repos.documents.listByCollection(from.id)),
        row,
      ])
      const path = before.get(row.id)
      /* v8 ignore next -- the document was just put into the list the table was built from. */
      if (path !== undefined) await record(deps, from.publicSite.siteSlug, path, row.id)
    }
  }

  const arrived = await findPublishedIn(deps, command.documentId)
  if (arrived === null) return
  const to = publicDocumentPaths(arrived.collection, arrived.siblings).get(row.id)
  /* v8 ignore next -- the document is one of the siblings the table was built from. */
  if (to !== undefined) {
    await repos.publicRedirects.deleteAt(arrived.collection.publicSite.siteSlug, to)
  }
}

/** A document in a collection that has ever been published, with its siblings. */
async function findPublishedIn(
  deps: PublicRedirectDependencies,
  documentId: DocumentId,
): Promise<{
  readonly row: DocumentRow
  readonly collection: CollectionRow & {
    readonly publicSite: NonNullable<CollectionRow['publicSite']>
  }
  readonly siblings: readonly DocumentRow[]
} | null> {
  const { repos } = deps.uow
  const row = await repos.documents.findById(documentId)
  if (row === null || row.collectionId === null) return null
  const collection = await repos.collections.findById(row.collectionId)
  if (collection?.publicSite == null) return null
  return {
    row,
    collection: { ...collection, publicSite: collection.publicSite },
    siblings: await repos.documents.listByCollection(collection.id),
  }
}

/** Writes the redirect for an address that changed, and clears the one it landed on. */
async function moveAddress(
  deps: PublicRedirectDependencies,
  input: {
    readonly collection: CollectionRow & {
      readonly publicSite: NonNullable<CollectionRow['publicSite']>
    }
    readonly documentId: DocumentId
    readonly from: string | undefined
    readonly to: string | undefined
  },
): Promise<void> {
  const { siteSlug } = input.collection.publicSite
  if (input.from === undefined || input.to === undefined || input.from === input.to) return
  await record(deps, siteSlug, input.from, input.documentId)
  await deps.uow.repos.publicRedirects.deleteAt(siteSlug, input.to)
}

async function record(
  deps: PublicRedirectDependencies,
  siteSlug: string,
  path: string,
  documentId: DocumentId,
): Promise<void> {
  await deps.uow.repos.publicRedirects.record({
    id: deps.ids.uuid(),
    siteSlug,
    path,
    documentId,
    now: deps.clock.now(),
  })
}
