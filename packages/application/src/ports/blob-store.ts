/**
 * Attachments and source artifacts live in a blob store addressed by content
 * hash (decision D16). Filesystem and S3-compatible implementations exist;
 * the application layer never knows which.
 *
 * The port is stream-first because an attachment is the one thing this
 * platform handles that has no useful upper bound in a caller's memory
 * (quill-plan.md section 31: "attachment transfers stream; nothing large is
 * buffered"). A store is content-addressed, so it has to hash every byte on
 * the way past anyway; hashing as they arrive is what lets an upload be
 * refused for size, or accepted, without ever holding the whole of it.
 */
export interface BlobRef {
  /** Lower-case hex SHA-256 of the bytes. */
  readonly hash: string
  readonly size: number
  readonly contentType: string
}

export interface BlobStore {
  /**
   * Writes the bytes and returns where they landed.
   *
   * Writing the same bytes twice is one object: the hash is the address, so a
   * second `put` of identical content is idempotent and costs no extra space.
   * An implementation must not publish a partial object under a hash — a
   * reader that finds a hash must find all of it.
   */
  put(chunks: AsyncIterable<Uint8Array>, contentType: string): Promise<BlobRef>
  /**
   * The bytes, lazily, or `null` when nothing is stored under this hash.
   *
   * Lazily so serving an attachment is a pipe rather than a buffer; the
   * iterable's chunking is the store's own and carries no meaning.
   */
  open(hash: string): Promise<AsyncIterable<Uint8Array> | null>
  has(hash: string): Promise<boolean>
  /** Removing an address that holds nothing is not an error. */
  delete(hash: string): Promise<void>
}

/**
 * The whole of a blob, for the callers small enough to want it: a test, a
 * checksum, a thumbnail later. Serving a document's attachment does not go
 * through here — it pipes `open` — which is why this is a helper beside the
 * port rather than a method on it.
 */
export async function readBlob(store: BlobStore, hash: string): Promise<Uint8Array | null> {
  const chunks = await store.open(hash)
  if (chunks === null) return null
  const collected: Uint8Array[] = []
  for await (const chunk of chunks) collected.push(chunk)
  return concatChunks(collected)
}

/** One buffer from many, with the total measured once rather than grown per chunk. */
export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const all = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    all.set(chunk, offset)
    offset += chunk.length
  }
  return all
}
