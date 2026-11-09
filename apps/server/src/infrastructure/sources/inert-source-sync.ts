import type { ContentStore } from '@quill/application'

import type { SourceSyncPorts } from '../../dependencies.ts'

/**
 * Source sync for a process that never syncs: a script that seeds, sets a
 * secret, or describes the API. Every workspace reads as having no source to
 * open, so the job, were it ever asked, would answer `not-sourced`.
 */
export function inertSourceSync(contentStore: ContentStore): SourceSyncPorts {
  return {
    contentStore,
    sources: { forWorkspace: async () => null },
    lock: {
      withLock: async (_workspaceId, work) => ({ kind: 'ran', value: await work() }),
      isHeld: async () => false,
    },
    allowFileRemotesForTesting: false,
  }
}
