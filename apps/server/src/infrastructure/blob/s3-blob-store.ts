import { createHash } from 'node:crypto'

import { AwsClient } from 'aws4fetch'

import { concatChunks, type BlobRef, type BlobStore } from '@quill/application'

/**
 * The S3-compatible blob store: one object per blob, keyed by its SHA-256.
 *
 * **Why not the AWS SDK.** `@aws-sdk/client-s3` is three megabytes of package
 * and some forty transitive `@smithy/*` and `@aws-sdk/*` dependencies, and
 * what this store needs of S3 is four REST calls — `PUT`, `GET`, `HEAD`,
 * `DELETE` on one key — with no multipart, no presigning, no pagination, and
 * no service discovery. `aws4fetch` is 65 KB with no dependencies and does the
 * one part that is genuinely hard, Signature Version 4, against Node's own
 * `fetch`. That is the whole of the deviation from "the well-known approach
 * wins" (`docs/architecture/patterns.md`): the familiar thing here is signed
 * HTTP, and the SDK is the part that would be novel weight.
 *
 * **Why the body is buffered.** An object's key is the hash of its content, so
 * this store cannot know where the bytes go until it has seen all of them —
 * which rules out a single streaming `PUT`. The buffer is therefore inherent
 * rather than lazy, and it is bounded: nothing reaches a blob store without
 * having passed `ATTACHMENT_MAX_BYTES` first, and the upload use case counts
 * as the bytes arrive rather than after. The filesystem store, which can write
 * to a temporary name and rename once the hash is known, does stream.
 */

export interface S3BlobStoreOptions {
  readonly bucket: string
  readonly region: string
  /** Absent for AWS itself; set for MinIO and every other compatible service. */
  readonly endpoint?: string | undefined
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly forcePathStyle: boolean
  /** Already normalised by `config.ts`: empty, or ending in one slash. */
  readonly prefix: string
  /** Injected so a test can drive the store against a fake service. */
  readonly fetch?: typeof fetch
}

export class S3BlobStore implements BlobStore {
  readonly #client: AwsClient
  readonly #options: S3BlobStoreOptions
  readonly #fetch: typeof fetch

  constructor(options: S3BlobStoreOptions) {
    this.#options = options
    this.#fetch = options.fetch ?? fetch
    this.#client = new AwsClient({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      service: 's3',
      region: options.region,
      // `fetch` is not passed to the client: aws4fetch's own `fetch` method
      // signs *and* sends, and this store wants the signed request so the
      // injected transport is the one that actually makes the call.
    })
  }

  async put(chunks: AsyncIterable<Uint8Array>, contentType: string): Promise<BlobRef> {
    const collected: Uint8Array[] = []
    for await (const chunk of chunks) collected.push(chunk)
    const bytes = concatChunks(collected)
    const hash = createHash('sha256').update(bytes).digest('hex')

    // The same bytes are the same object, so re-uploading one already there is
    // bytes on the wire for no change. One `HEAD` is cheaper than the `PUT` it
    // saves for every attachment a workspace shares.
    if (!(await this.has(hash))) {
      const response = await this.#send(hash, {
        method: 'PUT',
        body: bytes,
        headers: {
          'content-type': contentType,
          'content-length': String(bytes.length),
          // The payload hash the signature covers. It is the object's own
          // address, so this costs nothing extra and lets the service verify
          // what arrived.
          'x-amz-content-sha256': hash,
        },
      })
      await assertOk(response, 'store', hash)
    }

    return { hash, size: bytes.length, contentType }
  }

  async open(hash: string): Promise<AsyncIterable<Uint8Array> | null> {
    const response = await this.#send(hash, { method: 'GET' })
    if (response.status === 404) return null
    await assertOk(response, 'read', hash)
    return streamOf(response)
  }

  async has(hash: string): Promise<boolean> {
    const response = await this.#send(hash, { method: 'HEAD' })
    if (response.status === 404) return false
    await assertOk(response, 'check', hash)
    return true
  }

  async delete(hash: string): Promise<void> {
    const response = await this.#send(hash, { method: 'DELETE' })
    // S3 answers 204 whether or not the key was there, and a compatible
    // service that answers 404 means the same thing: it is gone.
    if (response.status === 404) return
    await assertOk(response, 'remove', hash)
  }

  async #send(hash: string, init: RequestInit): Promise<Response> {
    const signed = await this.#client.sign(this.#urlFor(hash), init)
    return this.#fetch(signed)
  }

  #urlFor(hash: string): string {
    if (!/^[0-9a-f]{64}$/u.test(hash)) {
      throw new Error(`A blob address is a lower-case hex SHA-256, received "${hash}"`)
    }
    const key = `${this.#options.prefix}${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`
    const { bucket, region, endpoint, forcePathStyle } = this.#options

    if (endpoint === undefined) {
      return forcePathStyle
        ? `https://s3.${region}.amazonaws.com/${bucket}/${key}`
        : `https://${bucket}.s3.${region}.amazonaws.com/${key}`
    }
    const base = new URL(endpoint)
    if (forcePathStyle) {
      const path = base.pathname.replace(/\/$/u, '')
      return `${base.origin}${path}/${bucket}/${key}`
    }
    return `${base.protocol}//${bucket}.${base.host}/${key}`
  }
}

/** How much of a service's error document is worth carrying into a log line. */
const ERROR_EXCERPT_LENGTH = 200

async function assertOk(response: Response, action: string, hash: string): Promise<void> {
  if (response.ok) return
  // S3 answers in XML, and the useful part is the `<Code>`; the excerpt is
  // bounded because an error document is not a size this platform controls.
  const body = await response.text().catch(() => '')
  throw new Error(
    `Could not ${action} blob ${hash}: the object store answered ${response.status}. ` +
      `${body.slice(0, ERROR_EXCERPT_LENGTH)}`.trim(),
  )
}

/**
 * The response body as chunks, without holding the whole of it.
 *
 * The `finally` runs however the generator ends — a reader that stopped early
 * because a client disconnected, a `return()` from a `for await` that broke,
 * or an error thrown downstream — and cancelling the reader is what tells the
 * fetch implementation to stop pulling and release the connection back to its
 * pool. Without it an abandoned read holds a socket until the service closes
 * it, which under load is how a pool runs dry.
 */
async function* streamOf(response: Response): AsyncGenerator<Uint8Array> {
  const body = response.body
  /* v8 ignore next -- a 200 from any S3-compatible service carries a body. */
  if (body === null) return
  const reader = body.getReader()
  let finished = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        finished = true
        return
      }
      yield value
    }
  } finally {
    // Cancelling a reader that has already read to the end is a no-op, but
    // saying so explicitly keeps the two paths apart: one released a stream
    // that finished, the other threw away one that did not.
    /* v8 ignore next 3 -- the swallow: cancelling a reader whose stream has
       already errored rejects, and this runs in a `finally` that may be
       unwinding that very error, which must not be replaced by this one. */
    if (!finished) {
      await reader.cancel().catch(() => {})
    }
    reader.releaseLock()
  }
}
