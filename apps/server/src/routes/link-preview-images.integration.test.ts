import { randomBytes } from 'node:crypto'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'

/**
 * The pictures link previews show, served from our own origin (ADR-042). The
 * thing to get right is what is *not* served: the blob store holds attachments
 * under the same kind of hash, and a hash is not a permission.
 */

let harness: ServerHarness
let picture: Uint8Array
let pictureHash: string
let strangerHash: string
let corruptHash: string

async function webp(colour: string, size: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: size, height: size, channels: 3, background: colour } })
      .webp()
      .toBuffer(),
  )
}

async function store(bytes: Uint8Array, contentType: string): Promise<string> {
  const stored = await harness.deps.blobStore.put(
    (async function* () {
      yield bytes
    })(),
    contentType,
  )
  return stored.hash
}

const preview = (thumbnail: string) => ({
  version: 1,
  url: 'https://blog.example/post',
  canonicalUrl: 'https://blog.example/post',
  title: 'T',
  description: null,
  siteName: null,
  kind: 'website',
  thumbnail: { hash: thumbnail, width: 10, height: 10, mediaType: 'image/webp' },
  favicon: null,
  layer: 'page',
  fetchedAt: '2026-01-01T00:00:00.000Z',
})

beforeAll(async () => {
  harness = await createServerHarness()
  picture = await webp('#36c', 10)
  pictureHash = await store(picture, 'image/webp')
  // A file somebody uploaded as an attachment: it is in the same store, and it is a perfectly good WebP.
  strangerHash = await store(await webp('#c33', 12), 'image/webp')
  corruptHash = await store(new TextEncoder().encode('<script>alert(1)</script>'), 'image/webp')

  const { linkPreviews } = harness.deps.uow.repos
  const now = harness.clock.now()
  await linkPreviews.putReady({
    scope: 'public',
    key: 'https://blog.example/post',
    document: preview(pictureHash),
    now,
  })
  await linkPreviews.putReady({
    scope: 'public',
    key: 'https://blog.example/corrupt',
    document: preview(corruptHash),
    now,
  })
}, 30_000)

afterAll(async () => {
  await harness.close()
})

const get = (hash: string, headers: Record<string, string> = {}) =>
  harness.app.inject({ method: 'GET', url: `/link-previews/images/${hash}`, headers })

describe('GET /link-previews/images/:hash', () => {
  it('serves a picture a preview shows, to anyone, as an inert WebP', async () => {
    const response = await get(pictureHash)
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('image/webp')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
    expect(response.headers['content-disposition']).toBe('inline')
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(new Uint8Array(response.rawPayload)).toEqual(picture)
  })

  it('is immutable, because the address is the content', async () => {
    const response = await get(pictureHash)
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(response.headers['etag']).toBe(`"${pictureHash}"`)
  })

  it('answers a repeat visit from the tag without reading the file', async () => {
    const open = vi.spyOn(harness.deps.blobStore, 'open')
    const response = await get(pictureHash, { 'if-none-match': `"${pictureHash}"` })
    expect(response.statusCode).toBe(304)
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('does not serve a file in the store that no preview shows, however good a picture it is', async () => {
    expect((await get(strangerHash)).statusCode).toBe(404)
  })

  it('answers a file that is not there exactly as one that is there but not shown', async () => {
    const missing = await get('f'.repeat(64))
    const hidden = await get(strangerHash)
    expect(missing.statusCode).toBe(hidden.statusCode)
    expect(missing.body).toBe(hidden.body)
  })

  it('does not serve bytes that are not a WebP even when a preview names them', async () => {
    const response = await get(corruptHash)
    expect(response.statusCode).toBe(404)
    expect(response.body).not.toContain('script')
  })

  it.each(['abc', 'A'.repeat(64), `${'a'.repeat(63)}g`, 'a'.repeat(65), '..%2f..%2fetc'])(
    'refuses %s, which is not a hash',
    async (hash) => {
      expect((await get(hash)).statusCode).toBeGreaterThanOrEqual(400)
    },
  )

  it('refuses a picture whose preview has been swept', async () => {
    const { linkPreviews } = harness.deps.uow.repos
    const hash = await store(await webp('#0a0', 14), 'image/webp')
    await linkPreviews.putReady({
      scope: 'public',
      key: 'https://blog.example/short-lived',
      document: preview(hash),
      now: new Date('2020-01-01T00:00:00.000Z'),
    })
    expect((await get(hash)).statusCode).toBe(200)
    await linkPreviews.deleteFetchedBefore(new Date('2021-01-01T00:00:00.000Z'))
    expect((await get(hash)).statusCode).toBe(404)
  })

  it('does not serve a picture whose file has gone from the store', async () => {
    const { linkPreviews } = harness.deps.uow.repos
    const gone = 'd'.repeat(64)
    await linkPreviews.putReady({
      scope: 'public',
      key: 'https://blog.example/dangling',
      document: preview(gone),
      now: harness.clock.now(),
    })
    expect((await get(gone)).statusCode).toBe(404)
  })

  it('streams a picture that arrives in more than one piece, whole', async () => {
    // Noise does not compress, so this is well over a single read of the store.
    const pixels = randomBytes(400 * 400 * 3)
    const noisy = new Uint8Array(
      await sharp(pixels, { raw: { width: 400, height: 400, channels: 3 } })
        .webp({ lossless: true })
        .toBuffer(),
    )
    expect(noisy.byteLength).toBeGreaterThan(200_000)
    const hash = await store(noisy, 'image/webp')
    await harness.deps.uow.repos.linkPreviews.putReady({
      scope: 'public',
      key: 'https://blog.example/noisy',
      document: preview(hash),
      now: harness.clock.now(),
    })
    const response = await get(hash)
    expect(response.statusCode).toBe(200)
    expect(new Uint8Array(response.rawPayload)).toEqual(noisy)
  })
})
