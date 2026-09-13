import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { readBlob } from '@quill/application'

import { verifySignature } from '../../test-support/verify-sigv4.ts'
import { S3BlobStore } from './s3-blob-store.ts'

/**
 * The S3 adapter against a fake service in this process.
 *
 * A fake rather than MinIO, so the suite has no service to be running and no
 * reason to skip: what is worth proving here is the adapter's own behaviour —
 * the key it computes, the method it uses, what it does with a 404, what it
 * does with an error document — and every one of those is visible from the
 * other end of a real HTTP request. The fake is a real server, so the request
 * really is signed, serialised, sent, and parsed; only the storage behind it
 * is a `Map`.
 *
 * And it **verifies the signature**, the way a service does: it derives the
 * signing key from the secret, rebuilds the canonical request from what
 * arrived, and compares (`test-support/verify-sigv4.ts`). A fake that only
 * noticed an `Authorization` header would pass an adapter that signed the
 * wrong method or forgot a header — every one of which is a `403` from a real
 * service and a green test here. Anything that does not verify is answered
 * `403`, so every case below proves the signature as well as the behaviour.
 *
 * The MinIO in `docker-compose.yml` remains the local target for running the
 * product against S3 by hand, and for the operations guide's restore drill.
 */

const ACCESS_KEY_ID = 'quill'
const SECRET_ACCESS_KEY = 'quillquill'

interface FakeService {
  readonly origin: string
  readonly objects: Map<string, Buffer>
  readonly requests: { method: string; url: string; authorization: string | undefined }[]
  /** Every request the signature check refused, so a test can assert there were none. */
  readonly unsigned: string[]
  /** Makes the next request of this method answer with a failure instead. */
  fail(method: string, status: number, body: string): void
  reset(): void
}

let server: Server
let service: FakeService

function bodyOf(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const received: Buffer[] = []
    request.on('data', (chunk: Buffer) => received.push(chunk))
    request.on('end', () => resolve(Buffer.concat(received)))
    request.on('error', reject)
  })
}

beforeAll(async () => {
  const objects = new Map<string, Buffer>()
  const requests: FakeService['requests'] = []
  const unsigned: string[] = []
  const failures = new Map<string, { status: number; body: string }>()

  server = createServer((request, response) => {
    void handle(request, response)
  })

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET'
    const url = request.url ?? '/'
    requests.push({ method, url, authorization: request.headers.authorization })

    // The body has to be read before the signature can be checked against it,
    // which is what a service does too.
    const body = await bodyOf(request)
    const verified = verifySignature({
      method,
      url,
      headers: request.headers,
      body,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      service: 's3',
    })
    if (!verified.valid) {
      unsigned.push(`${method} ${url}: ${verified.reason ?? 'unverified'}`)
      response
        .writeHead(403)
        .end(
          `<Error><Code>SignatureDoesNotMatch</Code><Message>${verified.reason}</Message></Error>`,
        )
      return
    }

    const failure = failures.get(method)
    if (failure !== undefined) {
      failures.delete(method)
      response.writeHead(failure.status).end(failure.body)
      return
    }

    // Path style, which is what every self-hosted gateway speaks:
    // `/<bucket>/<key…>`.
    const key = url
    switch (method) {
      case 'PUT': {
        objects.set(key, body)
        response.writeHead(200).end()
        return
      }
      case 'GET': {
        const bytes = objects.get(key)
        if (bytes === undefined) {
          response.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>')
          return
        }
        response.writeHead(200, { 'content-length': String(bytes.length) }).end(bytes)
        return
      }
      case 'HEAD': {
        response.writeHead(objects.has(key) ? 200 : 404).end()
        return
      }
      case 'DELETE': {
        objects.delete(key)
        response.writeHead(204).end()
        return
      }
      /* v8 ignore next 3 -- the adapter uses exactly the four methods above. */
      default:
        response.writeHead(405).end()
    }
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  /* v8 ignore next -- a listening TCP server always has an address object. */
  const port = typeof address === 'object' && address !== null ? address.port : 0

  service = {
    origin: `http://127.0.0.1:${port}`,
    objects,
    requests,
    unsigned,
    fail(method, status, body) {
      failures.set(method, { status, body })
    },
    reset() {
      objects.clear()
      requests.length = 0
      unsigned.length = 0
      failures.clear()
    },
  }
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      /* v8 ignore next -- the server is listening and closes cleanly. */
      if (error !== undefined && error !== null) reject(error)
      else resolve()
    })
  })
})

beforeEach(() => {
  service.reset()
})

/**
 * Every case goes through the fake, and the fake answers `403` to anything it
 * cannot verify — so a signing regression already fails the behaviour it broke.
 * This is the belt beside that, called where it reads as an assertion.
 */
function expectEverythingWasSigned(): void {
  expect(service.unsigned).toStrictEqual([])
}

function storeAgainstFake(prefix = '', secretAccessKey = SECRET_ACCESS_KEY): S3BlobStore {
  return new S3BlobStore({
    bucket: 'quill',
    region: 'us-east-1',
    endpoint: service.origin,
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey,
    forcePathStyle: true,
    prefix,
  })
}

async function* chunks(...parts: readonly string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield new TextEncoder().encode(part)
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** A store whose transport records the request instead of making one. */
function recordingStore(options: Partial<ConstructorParameters<typeof S3BlobStore>[0]>): {
  store: S3BlobStore
  urls: string[]
} {
  const urls: string[] = []
  const store = new S3BlobStore({
    bucket: 'quill',
    region: 'eu-west-2',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    forcePathStyle: false,
    prefix: '',
    fetch: async (input) => {
      urls.push(input instanceof Request ? input.url : String(input))
      return new Response(null, { status: 404 })
    },
    ...options,
  })
  return { store, urls }
}

describe('S3BlobStore', () => {
  it('stores and reads back an object addressed by its own hash', async () => {
    const store = storeAgainstFake()
    const ref = await store.put(chunks('hello ', 'world'), 'text/plain')

    expect(ref).toStrictEqual({ hash: sha256('hello world'), size: 11, contentType: 'text/plain' })
    expect(await readBlob(store, ref.hash)).toStrictEqual(new TextEncoder().encode('hello world'))
    expectEverythingWasSigned()
  })

  it('signs every request, in a way a service verifies', async () => {
    const store = storeAgainstFake()
    await store.put(chunks('signed'), 'text/plain')

    expect(service.requests.length).toBeGreaterThan(0)
    for (const request of service.requests) {
      expect(request.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=quill\//u)
    }
    // The fake rebuilt each canonical request and derived each signature; an
    // adapter that signed the wrong method or path would be in `unsigned`.
    expect(service.unsigned).toStrictEqual([])
  })

  it('is refused by the service when the secret is wrong', async () => {
    const store = storeAgainstFake('', 'the-wrong-secret')

    await expect(store.put(chunks('refused'), 'text/plain')).rejects.toThrow(
      /the object store answered 403/u,
    )
    expect(service.unsigned).toHaveLength(1)
    expect(service.unsigned[0]).toContain('does not match this request')
  })

  it('fans the key out, and puts it under the configured prefix', async () => {
    const store = storeAgainstFake('instances/one/')
    const ref = await store.put(chunks('prefixed'), 'text/plain')
    const fanned = `${ref.hash.slice(0, 2)}/${ref.hash.slice(2, 4)}/${ref.hash}`

    expect([...service.objects.keys()]).toStrictEqual([`/quill/instances/one/${fanned}`])
  })

  it('checks before it writes, so the same bytes are never sent twice', async () => {
    const store = storeAgainstFake()
    await store.put(chunks('once'), 'text/plain')
    service.requests.length = 0
    await store.put(chunks('once'), 'text/plain')

    expect(service.requests.map((request) => request.method)).toStrictEqual(['HEAD'])
  })

  it('answers nothing for a key the service does not hold', async () => {
    const store = storeAgainstFake()
    const absent = sha256('never written')

    expect(await store.open(absent)).toBeNull()
    expect(await store.has(absent)).toBe(false)
    expect(await readBlob(store, absent)).toBeNull()
  })

  it('removes an object, and a removal of nothing is not an error', async () => {
    const store = storeAgainstFake()
    const ref = await store.put(chunks('transient'), 'text/plain')

    await store.delete(ref.hash)
    expect(await store.has(ref.hash)).toBe(false)
    await expect(store.delete(ref.hash)).resolves.toBeUndefined()
  })

  it('treats a 404 from a delete as the object already being gone', async () => {
    const store = storeAgainstFake()
    service.fail('DELETE', 404, '<Error><Code>NoSuchKey</Code></Error>')

    await expect(store.delete(sha256('absent'))).resolves.toBeUndefined()
  })

  it('carries the service error into the message, bounded', async () => {
    const store = storeAgainstFake()
    service.fail('PUT', 403, `<Error><Code>AccessDenied</Code></Error>${'x'.repeat(1000)}`)

    await expect(store.put(chunks('refused'), 'text/plain')).rejects.toThrow(
      /Could not store blob [0-9a-f]{64}: the object store answered 403\..*AccessDenied/su,
    )
  })

  it('reports a failed read and a failed check rather than answering falsely', async () => {
    const store = storeAgainstFake()
    const ref = await store.put(chunks('present'), 'text/plain')

    service.fail('GET', 500, 'internal')
    await expect(store.open(ref.hash)).rejects.toThrow('Could not read blob')

    service.fail('HEAD', 500, '')
    await expect(store.has(ref.hash)).rejects.toThrow('Could not check blob')
  })

  it('still names the status when the error document cannot be read', async () => {
    const torn = new Response('unreadable', { status: 503 })
    Object.defineProperty(torn, 'text', {
      value: () => Promise.reject(new Error('the connection went away')),
    })
    const { store } = recordingStore({ fetch: async () => torn })

    await expect(store.has(sha256('anything'))).rejects.toThrow(/the object store answered 503/u)
  })

  it('lets go of a body nobody finished reading', async () => {
    const store = storeAgainstFake()
    const ref = await store.put(chunks('a body somebody stops reading'), 'text/plain')

    const body = await store.open(ref.hash)
    expect(body).not.toBeNull()
    const reader = body?.[Symbol.asyncIterator]()
    await reader?.next()
    // What a client disconnecting looks like from here: the generator is
    // returned rather than run to the end, which is what has to cancel the
    // underlying reader instead of leaving a socket held.
    await expect(reader?.return?.(undefined)).resolves.toMatchObject({ done: true })

    // And the store still works afterwards, which it would not if the
    // connection had been left in the pool half-read.
    expect(await readBlob(store, ref.hash)).toStrictEqual(
      new TextEncoder().encode('a body somebody stops reading'),
    )
    expectEverythingWasSigned()
  })

  it('refuses an address that is not a SHA-256', async () => {
    const store = storeAgainstFake()
    await expect(store.has('../../secret')).rejects.toThrow('lower-case hex SHA-256')
  })

  describe('the URL it addresses', () => {
    const hash = sha256('anything')
    const fanned = `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`

    it('uses the virtual-hosted AWS endpoint for the region by default', async () => {
      const { store, urls } = recordingStore({})
      await store.has(hash)
      expect(urls).toStrictEqual([`https://quill.s3.eu-west-2.amazonaws.com/${fanned}`])
    })

    it('uses the path-style AWS endpoint when asked to', async () => {
      const { store, urls } = recordingStore({ forcePathStyle: true })
      await store.has(hash)
      expect(urls).toStrictEqual([`https://s3.eu-west-2.amazonaws.com/quill/${fanned}`])
    })

    it('puts the bucket in the host of a custom endpoint when path style is off', async () => {
      const { store, urls } = recordingStore({ endpoint: 'https://objects.example.com' })
      await store.has(hash)
      expect(urls).toStrictEqual([`https://quill.objects.example.com/${fanned}`])
    })

    it('keeps the path of a custom endpoint that has one', async () => {
      const { store, urls } = recordingStore({
        endpoint: 'https://gateway.example.com/s3/',
        forcePathStyle: true,
      })
      await store.has(hash)
      expect(urls).toStrictEqual([`https://gateway.example.com/s3/quill/${fanned}`])
    })
  })
})
