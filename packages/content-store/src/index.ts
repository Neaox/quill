/**
 * The content store: a Git object model over a six-method `ObjectStore` port
 * (ADR-014). Nothing above this package knows about repositories, trees, refs,
 * or commits — so nothing above this package is offered them here either.
 *
 * This barrel is the adapter, its backends, their options, and their errors,
 * and the `ExternalSource` adapter that reads a repository Quill does not own
 * (ADR-061).
 * The Git vocabulary the implementation is built from — objects, trees,
 * trailers, commit walks — is reachable through `@quill/content-store/internal`
 * for the tools that genuinely need it, such as a revisions-index rebuild.
 */

export type { ObjectEntry, ObjectStore, ObjectStoreProvider } from './object-store.ts'
export { MemoryObjectStore, MemoryObjectStoreProvider } from './memory-object-store.ts'
export {
  FilesystemObjectStore,
  FilesystemObjectStoreProvider,
  LeakedLockError,
  type FilesystemObjectStoreOptions,
} from './filesystem/filesystem-object-store.ts'

export {
  ContentStoreError,
  GitContentStore,
  type GitContentStoreOptions,
  type HistoryPage,
  type HistorySlice,
  type PublishRequest,
} from './git-content-store.ts'

export { ContentPathError } from './git/tree-path.ts'
export { GitObjectError } from './git/objects.ts'

export { RefLockPackingHook, type PackingHook, type PackingResult } from './packing.ts'

export {
  GitCliExternalSource,
  type GitCliExternalSourceOptions,
} from './external-source/git-cli-external-source.ts'
export type { SourceCredential } from './external-source/git-cli.ts'
export { MINIMUM_GIT_VERSION } from './external-source/git-version.ts'
