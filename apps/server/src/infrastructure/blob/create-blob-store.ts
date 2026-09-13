import type { BlobStore } from '@quill/application'

import type { BlobStoreConfig } from '../../config.ts'
import { FilesystemBlobStore } from './filesystem-blob-store.ts'
import { S3BlobStore } from './s3-blob-store.ts'

/**
 * The blob store, chosen by configuration (ADR-034, D16).
 *
 * Both backends are the same content-addressed object store behind the one
 * port: files under a directory, or objects in an S3-compatible bucket.
 * Nothing above this file knows which is in use, which is what lets
 * `BLOB_STORE` be an operator's decision rather than a code path.
 */
export function createBlobStore(config: BlobStoreConfig): BlobStore {
  return config.driver === 'filesystem'
    ? new FilesystemBlobStore(config.path)
    : new S3BlobStore(config)
}

export { FilesystemBlobStore } from './filesystem-blob-store.ts'
export { S3BlobStore } from './s3-blob-store.ts'
export type { S3BlobStoreOptions } from './s3-blob-store.ts'
