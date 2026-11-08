import type { WorkspaceId } from '@quill/domain'

import type { ContentStore } from '../ports/content-store.ts'
import type { WorkspaceRepository } from '../ports/persistence.ts'

/**
 * A write refused because the workspace reads its content from an external
 * source (ADR-061): its sync job is its only writer.
 */
export class WorkspaceReadOnlyError extends Error {
  readonly workspaceId: WorkspaceId

  constructor(workspaceId: WorkspaceId) {
    super(`Workspace ${workspaceId} is read from a repository; only its sync job writes it.`)
    this.name = 'WorkspaceReadOnlyError'
    this.workspaceId = workspaceId
  }
}

/**
 * The content store people's requests are composed with (Decorator; ADR-061,
 * "Read-only above the content-store port"). Reads pass straight through;
 * `publish` and `putFile` refuse a sourced workspace with
 * {@link WorkspaceReadOnlyError}, so a route that forgets its capability check
 * still cannot write one. The sync job is composed with the store underneath.
 *
 * A workspace the repository does not know, such as the instance's own
 * settings workspace, is not sourced.
 */
export function refuseWritesToSourcedWorkspaces(
  store: ContentStore,
  workspaces: Pick<WorkspaceRepository, 'findById'>,
): ContentStore {
  const assertWritable = async (workspaceId: WorkspaceId): Promise<void> => {
    const workspace = await workspaces.findById(workspaceId)
    if (workspace?.origin.kind === 'sourced') throw new WorkspaceReadOnlyError(workspaceId)
  }
  return {
    read: (workspaceId, documentId, revision) => store.read(workspaceId, documentId, revision),
    history: (workspaceId, documentId, page) => store.history(workspaceId, documentId, page),
    diff: (workspaceId, documentId, from, to) => store.diff(workspaceId, documentId, from, to),
    listTree: (workspaceId, revision) => store.listTree(workspaceId, revision),
    head: (workspaceId) => store.head(workspaceId),
    readFile: (workspaceId, path, revision) => store.readFile(workspaceId, path, revision),
    async publish(request) {
      await assertWritable(request.workspaceId)
      return await store.publish(request)
    },
    async putFile(request) {
      await assertWritable(request.workspaceId)
      return await store.putFile(request)
    },
  }
}
