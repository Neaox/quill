import { describe, expect, it } from 'vitest'

import { createBlobStore } from './create-blob-store.ts'
import { FilesystemBlobStore } from './filesystem-blob-store.ts'
import { S3BlobStore } from './s3-blob-store.ts'

describe('createBlobStore', () => {
  it('builds the filesystem adapter for the self-host default', () => {
    expect(createBlobStore({ driver: 'filesystem', path: './data/blobs' })).toBeInstanceOf(
      FilesystemBlobStore,
    )
  })

  it('builds the S3 adapter when configuration names a bucket', () => {
    const store = createBlobStore({
      driver: 's3',
      bucket: 'quill',
      region: 'eu-west-2',
      endpoint: undefined,
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      forcePathStyle: false,
      prefix: '',
    })
    expect(store).toBeInstanceOf(S3BlobStore)
  })
})
