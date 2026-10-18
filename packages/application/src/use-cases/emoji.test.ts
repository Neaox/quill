import { describe, expect, it } from 'vitest'

import { concatChunks, readBlob } from '../ports/blob-store.ts'
import { defaultOrganisationSettings } from '../settings/documents.ts'
import { MAX_EMOJI_BYTES, MAX_EMOJI_FRAMES, MAX_EMOJI_MILLISECONDS } from '../settings/emoji.ts'
import { createFakeSettings } from '../test-support/fake-settings.ts'
import {
  chunked,
  imageFixture,
  isoBox,
  pngChunk,
  pngFile,
  uint32s,
} from '../test-support/image-fixtures.ts'
import { createInMemoryBlobStore } from '../test-support/in-memory-blob-store.ts'
import { readEmojiImage, uploadEmojiImage } from './emoji.ts'

const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>',
)

const author = { name: 'Ada', email: 'ada@example.com' }

const upload = (bytes: Uint8Array, declaredContentType: string) => {
  const blobStore = createInMemoryBlobStore()
  return {
    blobStore,
    result: uploadEmojiImage({ blobStore }, { declaredContentType, body: chunked(bytes) }),
  }
}

/** A GIF's loop count, from its loop extension. */
function loopCount(bytes: Uint8Array | null): number | undefined {
  const at = new TextDecoder('latin1').decode(bytes ?? new Uint8Array()).indexOf('NETSCAPE2.0')
  return bytes?.[at + 13]
}

describe('uploading an emoji image (ADR-038)', () => {
  it('stores an SVG as it came, and names it by its hash', async () => {
    const { blobStore, result } = upload(SVG, 'image/svg+xml')
    const uploaded = await result
    if (uploaded.kind !== 'uploaded') throw new Error(uploaded.kind)
    expect(uploaded.mediaType).toBe('image/svg+xml')
    expect(await readBlob(blobStore, uploaded.hash)).toEqual(SVG)
  })

  it('takes a raster’s metadata off on the way in', async () => {
    const tagged = pngFile({ chunks: [pngChunk('tEXt', new TextEncoder().encode('Author\0Ada'))] })
    const { blobStore, result } = upload(tagged, 'image/png')
    const uploaded = await result
    if (uploaded.kind !== 'uploaded') throw new Error(uploaded.kind)
    const stored = await readBlob(blobStore, uploaded.hash)
    expect(stored?.length).toBeLessThan(tagged.length)
    expect((await upload(imageFixture('plain.webp'), 'image/webp').result).kind).toBe('uploaded')
  })

  it.each([
    ['image/jpeg', 'plain.jpg'],
    ['image/gif', 'plain.gif'],
    ['image/avif', 'plain.avif'],
  ] as const)('takes a %s, with no still for a picture that does not move', async (type, name) => {
    const uploaded = await upload(imageFixture(name), type).result
    if (uploaded.kind !== 'uploaded') throw new Error(uploaded.kind)
    expect(uploaded.mediaType).toBe(type)
    expect(uploaded.still).toBeUndefined()
    expect(uploaded.frames).toBeUndefined()
  })

  it('stores an animated GIF’s first frame beside it, for a reader who asks for less motion', async () => {
    const { blobStore, result } = upload(imageFixture('animated.gif'), 'image/gif')
    const uploaded = await result
    if (uploaded.kind !== 'uploaded') throw new Error(uploaded.kind)
    if (uploaded.still === undefined) throw new Error('no still')

    const animation = await readBlob(blobStore, uploaded.hash)
    const still = await readBlob(blobStore, uploaded.still)
    expect(still?.length).toBeLessThan(animation?.length ?? 0)
    expect(new TextDecoder().decode(still?.subarray(0, 6))).toBe('GIF89a')
  })

  it('serves a GIF bounded to three plays, keeping the upload as it came (ADR-047)', async () => {
    const { blobStore, result } = upload(imageFixture('animated.gif'), 'image/gif')
    const uploaded = await result
    if (uploaded.kind !== 'uploaded') throw new Error(uploaded.kind)
    expect(uploaded).toMatchObject({ frames: 2, milliseconds: 200, plays: 3 })
    if (uploaded.original === undefined) throw new Error('no original')

    expect(loopCount(await readBlob(blobStore, uploaded.hash))).toBe(2)
    expect(loopCount(await readBlob(blobStore, uploaded.original))).toBe(0)
  })

  it('records no original when the upload already stopped soon enough', async () => {
    const once = Uint8Array.from(imageFixture('animated.gif'))
    once[new TextDecoder('latin1').decode(once).indexOf('NETSCAPE2.0') + 13] = 1
    const uploaded = await upload(once, 'image/gif').result
    if (uploaded.kind !== 'uploaded') throw new Error(uploaded.kind)
    expect(uploaded.plays).toBe(2)
    expect(uploaded.original).toBeUndefined()
  })

  it('stores an animated PNG’s default image beside it', async () => {
    const uploaded = await upload(imageFixture('animated.png'), 'image/png').result
    if (uploaded.kind !== 'uploaded') throw new Error(uploaded.kind)
    expect(uploaded.still).toMatch(/^[0-9a-f]{64}$/u)
    expect(uploaded).toMatchObject({ frames: 2, milliseconds: 200, plays: 3 })
    expect(uploaded.original).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('takes an animated WebP as it is, its still left to the image pipeline (ADR-047)', async () => {
    const uploaded = await upload(imageFixture('animated-exif.webp'), 'image/webp').result
    if (uploaded.kind !== 'uploaded') throw new Error(uploaded.kind)
    expect(uploaded.still).toBeUndefined()
    // Timed, for the record, but neither bounded nor given a still yet.
    expect(uploaded).toMatchObject({ frames: 2, milliseconds: 200 })
    expect(uploaded.plays).toBeUndefined()
    expect(uploaded.original).toBeUndefined()
  })

  it('refuses an animation longer than ten seconds, saying how long it is', async () => {
    const slow = Uint8Array.from(imageFixture('animated.gif'))
    // Every graphic control's delay set to six seconds, for twelve in all.
    for (let at = slow.indexOf(0xf9); at !== -1; at = slow.indexOf(0xf9, at + 1)) {
      if (slow[at - 1] === 0x21) slow.set([0x58, 0x02], at + 3)
    }
    expect(await upload(slow, 'image/gif').result).toEqual({
      kind: 'animation-over-limits',
      frames: 2,
      milliseconds: 12_000,
      maxFrames: MAX_EMOJI_FRAMES,
      maxMilliseconds: MAX_EMOJI_MILLISECONDS,
    })
  })

  it('refuses an animation of more than three hundred frames', async () => {
    const control = new Uint8Array(8)
    new DataView(control.buffer).setUint32(0, 301)
    const many = pngFile({ chunks: [pngChunk('acTL', control)] })
    expect(await upload(many, 'image/png').result).toMatchObject({
      kind: 'animation-over-limits',
      frames: 301,
    })
  })

  it('refuses what is not an emoji image, by its bytes', async () => {
    expect(await upload(new Uint8Array(), 'image/png').result).toEqual({ kind: 'empty' })
    expect(await upload(imageFixture('plain.png'), 'image/svg+xml').result).toEqual({
      kind: 'type-mismatch',
      declared: 'image/svg+xml',
      sniffed: 'image/png',
    })
    expect(await upload(new TextEncoder().encode('%PDF-1.7'), 'application/pdf').result).toEqual({
      kind: 'type-not-allowed',
      sniffed: 'application/pdf',
    })
    expect(await upload(new Uint8Array(MAX_EMOJI_BYTES + 1), 'image/png').result).toEqual({
      kind: 'too-large',
      maxBytes: MAX_EMOJI_BYTES,
    })
  })

  it('refuses a raster that cannot be walked', async () => {
    const cut = imageFixture('plain.png').subarray(0, 20)
    expect((await upload(cut, 'image/png').result).kind).toBe('malformed')
  })

  it('lets a store failure through as the failure it is', async () => {
    const blobStore = createInMemoryBlobStore()
    const failing = {
      ...blobStore,
      put: () => Promise.reject(new Error('disk full')),
    }
    await expect(
      uploadEmojiImage(
        { blobStore: failing },
        { declaredContentType: 'image/svg+xml', body: chunked(SVG) },
      ),
    ).rejects.toThrow('disk full')
  })
})

describe('serving an emoji image', () => {
  it('serves only an image the organisation’s settings name', async () => {
    const blobStore = createInMemoryBlobStore()
    const settings = createFakeSettings()
    const deps = { blobStore, settings }
    const uploaded = await uploadEmojiImage(deps, {
      declaredContentType: 'image/svg+xml',
      body: chunked(SVG),
    })
    if (uploaded.kind !== 'uploaded') throw new Error(uploaded.kind)
    const file = `acme.${uploaded.hash.slice(0, 16)}.svg`

    // Uploaded but not saved: nothing to serve, and nothing at all yet.
    expect(await readEmojiImage(deps, file)).toBeNull()

    const entry = {
      name: 'acme',
      hash: uploaded.hash,
      mediaType: 'image/svg+xml',
      width: 16,
      height: 16,
    } as const
    await settings.writeOrganisation({
      document: { ...defaultOrganisationSettings(), emoji: [entry] },
      expectedRevision: null,
      author,
    })
    expect(await readEmojiImage(deps, file)).toEqual({ mediaType: 'image/svg+xml', bytes: SVG })
    expect(await readEmojiImage(deps, 'acme.ffffffffffffffff.svg')).toBeNull()

    await blobStore.delete(uploaded.hash)
    expect(await readEmojiImage(deps, file)).toBeNull()
  })
})

/** The still AVIF fixtures declare `miaf` as a compatible brand; here it names a sequence instead. */
function asSequence(file: Uint8Array, ...movie: Uint8Array[]): Uint8Array {
  const sequence = Uint8Array.from(file)
  const miaf = new TextDecoder('latin1').decode(sequence).indexOf('miaf')
  sequence.set(new TextEncoder().encode('avis'), miaf)
  return concatChunks([sequence, ...movie])
}

describe('uploading an AVIF image sequence as an emoji', () => {
  it('refuses a sequence that has no movie to time it by', async () => {
    const uploaded = await upload(asSequence(imageFixture('plain.avif')), 'image/avif').result
    expect(uploaded).toEqual({ kind: 'malformed', reason: 'an image sequence with no movie' })
  })

  it('refuses a sequence whose metadata stripping would change, since its frames could not be found', async () => {
    const movie = isoBox(
      'moov',
      isoBox('mvhd', uint32s(0, 0, 0, 1000, 500)),
      isoBox(
        'trak',
        isoBox('mdia', isoBox('minf', isoBox('stbl', isoBox('stsz', uint32s(0, 0, 3))))),
      ),
    )
    const uploaded = await upload(asSequence(imageFixture('exif.avif'), movie), 'image/avif').result
    expect(uploaded).toMatchObject({
      kind: 'malformed',
      reason: expect.stringContaining('metadata'),
    })
  })
})
