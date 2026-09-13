/**
 * Attachments and source artifacts live in a blob store addressed by content
 * hash (decision D16). Filesystem and S3-compatible implementations exist;
 * the application layer never knows which.
 */
export interface BlobRef {
  /** Lower-case hex SHA-256 of the bytes. */
  readonly hash: string
  readonly size: number
  readonly contentType: string
}

export interface BlobStore {
  put(bytes: Uint8Array, contentType: string): Promise<BlobRef>
  get(hash: string): Promise<Uint8Array | null>
  has(hash: string): Promise<boolean>
  delete(hash: string): Promise<void>
}
