import { renderDocument } from '@quill/application'
import type { RenderDocumentDependencies, WorkspaceRow } from '@quill/application'
import type { WorkspaceId } from '@quill/domain'

import { indexDocument } from '../infrastructure/search/index-document.ts'
import type { IndexDocumentDependencies } from '../infrastructure/search/index-document.ts'

/**
 * `quill reindex` — rebuilding an index from the system of record (ADR-034,
 * ADR-010).
 *
 * The search index is an index and not a system of record: everything in it
 * is derived from published Markdown in the content store, so it can be
 * thrown away and rebuilt, and never needs backing up as authoritative. This
 * is the command that rebuilds it, per workspace or for the whole instance,
 * and it is the reason an operator can upgrade the projection, change the
 * ranking columns, or recover from a consumer that was switched off for a
 * week without anybody having to republish anything.
 *
 * It runs through the very same `indexDocument` the outbox consumer runs, so
 * a rebuilt index is the same index and not a second implementation that
 * agrees with the first until it does not.
 *
 * The render cache is rebuilt too, but only when asked for (`render`): it is
 * a separate index with its own key (ADR-031) and rebuilding it costs a
 * render per document, where reindexing costs a parse. It is here rather than
 * in a command of its own because `renderDocument` is one call and both walks
 * read exactly the same documents — doing them separately would read the
 * content store twice to reach the same place.
 *
 * Documents are walked one at a time on purpose. A rebuild is not on anybody's
 * critical path, and a command that saturates the connection pool and the
 * content store is one an operator cannot run on a live instance.
 */

export interface ReindexDependencies
  extends IndexDocumentDependencies, RenderDocumentDependencies {}

export interface ReindexCommand {
  /** One workspace, or every workspace in the instance when absent (ADR-034). */
  readonly workspaceId?: WorkspaceId | undefined
  /** Rebuild each document's cached body as well as its index entry. */
  readonly render?: boolean | undefined
  /** Called after each workspace, so a long rebuild says where it has got to. */
  readonly onWorkspace?: ((progress: WorkspaceProgress) => void) | undefined
}

export interface WorkspaceProgress {
  readonly workspaceId: WorkspaceId
  readonly name: string
  readonly indexed: number
  readonly removed: number
}

export interface ReindexResult {
  readonly workspaces: number
  readonly indexed: number
  /** Documents that turned out to have no published content, and so were taken out of the index. */
  readonly removed: number
  readonly rendered: number
}

export async function reindex(
  deps: ReindexDependencies,
  command: ReindexCommand = {},
): Promise<ReindexResult> {
  const workspaces = await targets(deps, command.workspaceId)

  let indexed = 0
  let removed = 0
  let rendered = 0

  for (const workspace of workspaces) {
    const before = { indexed, removed }
    const documents = await deps.uow.repos.documents.listByWorkspace(workspace.id as WorkspaceId)

    for (const document of documents) {
      const outcome = await indexDocument(deps, document.id)
      if (outcome.kind === 'indexed') {
        indexed += 1
        if (command.render === true) {
          // Only ever a document that has just been indexed, which means it
          // has published content: `renderDocument` has something to render.
          await renderDocument(deps, { documentId: document.id })
          rendered += 1
        }
      } else {
        removed += 1
      }
    }

    command.onWorkspace?.({
      workspaceId: workspace.id as WorkspaceId,
      name: workspace.name,
      indexed: indexed - before.indexed,
      removed: removed - before.removed,
    })
  }

  return { workspaces: workspaces.length, indexed, removed, rendered }
}

/** A workspace that does not exist is an empty rebuild, not a failure: the operator mistyped an id. */
async function targets(
  deps: ReindexDependencies,
  workspaceId: WorkspaceId | undefined,
): Promise<readonly WorkspaceRow[]> {
  if (workspaceId === undefined) return deps.uow.repos.workspaces.listAll()
  const workspace = await deps.uow.repos.workspaces.findById(workspaceId)
  return workspace === null ? [] : [workspace]
}
