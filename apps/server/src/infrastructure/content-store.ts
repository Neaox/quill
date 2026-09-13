import {
  FilesystemObjectStoreProvider,
  GitContentStore,
  MemoryObjectStoreProvider,
} from '@quill/content-store'
import type { ObjectStoreProvider } from '@quill/content-store'
import type { Clock, ContentStore } from '@quill/application'

import type { ContentStoreConfig } from '../config.ts'

/**
 * The content store, chosen by configuration (ADR-014).
 *
 * Both backends are the same Git object model over the same six-method object
 * store: the filesystem one is a bare repository per workspace that `git` can
 * read, and the in-memory one is the same layout in a `Map`, for tests and for
 * a throwaway instance. Nothing above this file knows which is in use.
 */
export function createContentStore(config: ContentStoreConfig, clock: Clock): ContentStore {
  const now = (): Date => clock.now()
  return new GitContentStore({
    provider: createProvider(config, now),
    now,
    // The jitter in the publish backoff, which the store takes as a port so a
    // test can make it deterministic; in a running server it is the real one.
    random: Math.random,
  })
}

function createProvider(config: ContentStoreConfig, now: () => Date): ObjectStoreProvider {
  return config.driver === 'filesystem'
    ? new FilesystemObjectStoreProvider(config.path, { now })
    : new MemoryObjectStoreProvider()
}
