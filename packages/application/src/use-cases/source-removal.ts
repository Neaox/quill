import type { DocumentId } from '@quill/domain'

import type { DocumentRow, UnitOfWork } from '../ports/persistence.ts'
import type { SourcePathRow } from '../ports/source-sync.ts'

/**
 * What became of a page whose file left its repository (ADR-061, "A deleted
 * file is archived, never a 404"; ADR-046).
 *
 * The sync job archives a document when its file is removed, or leaves the
 * source's paths, and keeps its path map entry. So an archived document of a
 * sourced workspace is a page that existed and was removed on purpose: it
 * answers 410 with its title and the commit that removed it. When the
 * manifest's `redirects` name its old path, the old address leads to the page
 * the redirect names instead: a redirect to a path that was itself removed and
 * redirected is followed, up to `MAX_REDIRECT_HOPS`, and a cycle ends the walk.
 *
 * A rename Git pairs needs none of this: the document keeps its id and key,
 * so every address it had still opens it (ADR-035).
 */

/** How many redirects are followed before the walk gives up, as ADR-046 has it. */
export const MAX_REDIRECT_HOPS = 5

export interface SourceRemoval {
  readonly title: string
  /** When the sync recorded the removal. */
  readonly removedAt: Date
  /** The source revision (the commit) that removed it; null when none was recorded. */
  readonly revision: string | null
  /** The page the manifest redirects its old path to, when there is a live one. */
  readonly replacement: DocumentId | null
}

/** The paths of a sourced workspace's path map, and the manifest's redirects. */
export interface SourceAddresses {
  /** Every path the source has had, live or archived, by path. */
  readonly paths: ReadonlyMap<string, SourcePathRow>
  readonly redirects: ReadonlyMap<string, string>
}

export async function readSourceAddresses(
  uow: UnitOfWork,
  document: Pick<DocumentRow, 'workspaceId'>,
): Promise<SourceAddresses> {
  const [rows, state] = await Promise.all([
    uow.repos.sourcePaths.listByWorkspace(document.workspaceId),
    uow.repos.sourceSyncState.find(document.workspaceId),
  ])
  return {
    paths: new Map(rows.map((row) => [row.path, row])),
    redirects: new Map(state?.layout?.redirects ?? []),
  }
}

/**
 * The live document a removed path's redirects lead to, or null: the first
 * redirect target that is a live path, following targets that were removed
 * and redirected in turn.
 */
export function followRedirects(path: string, addresses: SourceAddresses): DocumentId | null {
  const seen = new Set<string>([path])
  let from = path
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    const to = addresses.redirects.get(from)
    if (to === undefined || seen.has(to)) return null
    const row = addresses.paths.get(to)
    if (row === undefined) return null
    if (row.archivedAt === null) return row.documentId
    seen.add(to)
    from = to
  }
  return null
}

/**
 * Why a document of a sourced workspace is not there to read, or null when
 * it is: a document that is not archived, or not in a sourced workspace.
 */
export async function readSourceRemoval(
  deps: { readonly uow: UnitOfWork },
  document: DocumentRow,
): Promise<SourceRemoval | null> {
  if (document.status !== 'archived') return null
  const { repos } = deps.uow
  if ((await repos.workspaceSources.find(document.workspaceId)) === null) return null
  const [addresses, latest] = await Promise.all([
    readSourceAddresses(deps.uow, document),
    repos.revisions.latestForDocument(document.id),
  ])
  const row = [...addresses.paths.values()].find(
    (candidate) => candidate.documentId === document.id,
  )
  const replacement = row === undefined ? null : followRedirects(row.path, addresses)
  return {
    title: document.title,
    removedAt: row?.archivedAt ?? document.updatedAt,
    revision: latest?.sourceRevision ?? null,
    replacement: replacement === document.id ? null : replacement,
  }
}
