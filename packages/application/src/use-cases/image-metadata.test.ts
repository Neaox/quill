import { describe, expect, it } from 'vitest'

import { concatChunks } from '../ports/blob-store.ts'
import { chunked, imageFixture, pngChunk, pngFile } from '../test-support/image-fixtures.ts'
import type { ImageFixtureName } from '../test-support/image-fixtures.ts'
import { MalformedImage, stripImageMetadata } from './image-metadata.ts'
import type { ImageMediaType } from './media-types.ts'

function strip(type: ImageMediaType, file: Uint8Array, chunkSize = 8): Promise<Uint8Array> {
  return collect(stripImageMetadata(type, chunked(file, chunkSize)))
}

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const out: Uint8Array[] = []
  for await (const chunk of chunks) out.push(chunk)
  return concatChunks(out)
}

function bytes(...values: readonly (number | string | Uint8Array)[]): Uint8Array {
  return concatChunks(
    values.map((value) =>
      typeof value === 'number'
        ? Uint8Array.from([value])
        : typeof value === 'string'
          ? new TextEncoder().encode(value)
          : value,
    ),
  )
}

function u16(value: number): Uint8Array {
  return Uint8Array.from([(value >>> 8) & 0xff, value & 0xff])
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value)
  return out
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}

function u64(value: number): Uint8Array {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, BigInt(value))
  return out
}

const TRAILING_ZIP = bytes('PK', 0x03, 0x04, 'a payload hidden after the picture')

/** Whether these bytes contain that ASCII run anywhere. */
function contains(haystack: Uint8Array, needle: string): boolean {
  return Buffer.from(haystack).includes(Buffer.from(needle))
}

/**
 * Every fixture with metadata carries the same EXIF block and the same XMP
 * packet; these are the strings that prove either is gone.
 */
const EXIF_MAKE = 'Quill Test Camera'
const XMP_AUTHOR = 'Secret Author'

describe('the source is consumed to its end', () => {
  // AVIF is absent: an ISO base media file has no end marker, so what follows
  // its last box is a broken box, and the file is refused (see the AVIF tests).
  it.each<[ImageMediaType, ImageFixtureName]>([
    ['image/png', 'plain.png'],
    ['image/jpeg', 'plain.jpg'],
    ['image/gif', 'plain.gif'],
    ['image/webp', 'plain.webp'],
  ])('%s: what follows the end of the image is read and dropped', async (type, name) => {
    const file = imageFixture(name)
    let delivered = 0
    async function* counted(): AsyncGenerator<Uint8Array> {
      for await (const chunk of chunked(bytes(file, TRAILING_ZIP), 16)) {
        delivered += chunk.length
        yield chunk
      }
    }
    expect(await collect(stripImageMetadata(type, counted()))).toStrictEqual(file)
    // Reading to the end is what lets the size cap upstream see every byte.
    expect(delivered).toBe(file.length + TRAILING_ZIP.length)
  })
})

describe('PNG', () => {
  it('keeps a picture with nothing to remove byte for byte, however it is chunked', async () => {
    const file = pngFile({ width: 40, height: 30 })
    for (const chunkSize of [1, 7, 64, 100_000]) {
      expect(await strip('image/png', file, chunkSize)).toStrictEqual(file)
    }
  })

  it('names the format in a refusal, and lets any other failure through as it was', async () => {
    const cut = pngFile().subarray(0, 20)
    const refusal = await strip('image/png', cut).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(MalformedImage)
    expect(refusal).toMatchObject({
      contentType: 'image/png',
      reason: 'the file ends before it should',
    })

    await expect(collect(stripImageMetadata('image/png', failing()))).rejects.toThrow(
      'the connection went away',
    )
  })

  it('is not troubled by an empty chunk in the stream', async () => {
    const file = pngFile()
    async function* withEmptyChunks(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array()
      for await (const chunk of chunked(file, 5)) {
        yield chunk
        yield new Uint8Array()
      }
    }
    expect(await collect(stripImageMetadata('image/png', withEmptyChunks()))).toStrictEqual(file)
  })

  it('removes the text, EXIF and time chunks an encoder writes, and nothing else', async () => {
    const stripped = await strip('image/png', imageFixture('meta.png'))
    expect(stripped).toStrictEqual(imageFixture('plain.png'))
    expect(contains(stripped, EXIF_MAKE)).toBe(false)
    expect(contains(stripped, XMP_AUTHOR)).toBe(false)
  })

  it('keeps every frame of an animation and drops its text', async () => {
    const stripped = await strip('image/png', imageFixture('animated.png'))
    expect(pngChunkTypes(stripped)).toStrictEqual([
      'IHDR',
      'acTL',
      'fcTL',
      'IDAT',
      'fcTL',
      'fdAT',
      'IEND',
    ])
  })

  it('keeps the chunks that change how the pixels look', async () => {
    const rendering = ['gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'tRNS', 'bKGD', 'pHYs', 'cICP']
    const file = pngFile({
      chunks: [
        ...rendering.map((type) => pngChunk(type, bytes(0x01, 0x02, 0x03, 0x04))),
        pngChunk('tIME', bytes(0x07, 0xea, 0x09, 0x0d, 0x0c, 0x00, 0x00)),
        pngChunk('tEXt', bytes('Author', 0x00, XMP_AUTHOR)),
        pngChunk('prVt', bytes('a private chunk')),
      ],
    })
    expect(pngChunkTypes(await strip('image/png', file))).toStrictEqual([
      'IHDR',
      ...rendering,
      'IDAT',
      'IEND',
    ])
  })

  it('stops at IEND, so a payload appended to the picture is not stored', async () => {
    const file = pngFile()
    expect(await strip('image/png', bytes(file, TRAILING_ZIP))).toStrictEqual(file)
  })

  it('refuses a file cut short inside a chunk, or with no IEND at all', async () => {
    const file = pngFile({ width: 8, height: 8 })
    await expect(strip('image/png', file.subarray(0, file.length - 20))).rejects.toThrow(
      MalformedImage,
    )
    await expect(strip('image/png', file.subarray(0, 8))).rejects.toThrow(MalformedImage)
  })
})

/** A source that breaks off with its own error, as a dropped connection does. */
async function* failing(): AsyncGenerator<Uint8Array> {
  yield pngFile().subarray(0, 20)
  throw new Error('the connection went away')
}

/** The chunk types of a PNG, in order, read the way a decoder reads them. */
function pngChunkTypes(file: Uint8Array): string[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const types: string[] = []
  for (let offset = 8; offset < file.length;) {
    const length = view.getUint32(offset)
    types.push(new TextDecoder().decode(file.subarray(offset + 4, offset + 8)))
    offset += 12 + length
  }
  return types
}

describe('JPEG', () => {
  it('keeps a picture with nothing to remove byte for byte, however it is chunked', async () => {
    const file = imageFixture('plain.jpg')
    for (const chunkSize of [1, 3, 7, 64, 100_000]) {
      expect(await strip('image/jpeg', file, chunkSize)).toStrictEqual(file)
    }
  })

  it('removes EXIF, XMP and the comment an encoder writes, and nothing else', async () => {
    const stripped = await strip('image/jpeg', imageFixture('exif.jpg'))
    expect(stripped).toStrictEqual(imageFixture('plain.jpg'))
    expect(contains(stripped, EXIF_MAKE)).toBe(false)
    expect(contains(stripped, XMP_AUTHOR)).toBe(false)
  })

  it('keeps every scan of a progressive picture', async () => {
    const original = imageFixture('progressive-exif.jpg')
    const stripped = await strip('image/jpeg', original)
    expect(jpegMarkers(stripped)).toStrictEqual(jpegMarkers(original).filter((m) => m !== 0xe1))
    expect(contains(stripped, EXIF_MAKE)).toBe(false)
  })

  it('keeps the colour profile and drops the EXIF beside it', async () => {
    const stripped = await strip('image/jpeg', imageFixture('icc-exif.jpg'))
    expect(contains(stripped, 'ICC_PROFILE')).toBe(true)
    expect(contains(stripped, EXIF_MAKE)).toBe(false)
  })

  it('tells the application segments apart by what they carry, not only their number', async () => {
    const plain = imageFixture('plain.jpg')
    // Everything below is spliced in after the JFIF segment, which ends at byte 20.
    const jfxx = segment(0xe0, bytes('JFXX', 0x00, 0x10, 'thumbnail bytes'))
    const mpf = segment(0xe2, bytes('MPF', 0x00, 'offsets to a second picture'))
    const icc = segment(0xe2, bytes('ICC_PROFILE', 0x00, 0x01, 0x01, 'profile'))
    const adobe = segment(0xee, bytes('Adobe', 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x01))
    const photoshop = segment(0xed, bytes('Photoshop 3.0', 0x00, '8BIM', 0x04, 0x04))
    const ducky = segment(0xec, bytes('Ducky', 0x00, 0x01, 0x00, 0x04, 0x00, 0x00, 0x00, 0x50))
    const reserved = segment(0xf3, bytes('an extension nothing reads'))
    const file = bytes(
      plain.subarray(0, 20),
      jfxx,
      mpf,
      icc,
      adobe,
      photoshop,
      ducky,
      reserved,
      plain.subarray(20),
    )

    const stripped = await strip('image/jpeg', file)
    expect(stripped).toStrictEqual(bytes(plain.subarray(0, 20), icc, adobe, plain.subarray(20)))
  })

  it('carries restart markers and stuffed bytes through the scan, across any chunk boundary', async () => {
    const plain = imageFixture('plain.jpg')
    const scanStart = plain.indexOf(0xda, 600) + 11 // past the SOS segment header
    const entropy = bytes(0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0x00, 0xff, 0xd7, 0x78)
    const file = bytes(plain.subarray(0, scanStart), entropy, plain.subarray(scanStart))
    for (const chunkSize of [1, 2, 3, 5]) {
      expect(await strip('image/jpeg', file, chunkSize)).toStrictEqual(file)
    }
  })

  it('stops at end-of-image, so a payload appended to the picture is not stored', async () => {
    const file = imageFixture('plain.jpg')
    expect(await strip('image/jpeg', bytes(file, TRAILING_ZIP))).toStrictEqual(file)
  })

  it('tolerates the fill bytes some writers put before a marker', async () => {
    const plain = imageFixture('plain.jpg')
    const padded = bytes(plain.subarray(0, 2), 0xff, 0xff, plain.subarray(3))
    expect(await strip('image/jpeg', padded)).toStrictEqual(plain)
  })

  it('refuses a file that ends before end-of-image, or whose markers are not markers', async () => {
    const plain = imageFixture('plain.jpg')
    await expect(strip('image/jpeg', plain.subarray(0, plain.length - 2))).rejects.toThrow(
      MalformedImage,
    )
    await expect(strip('image/jpeg', plain.subarray(0, 30))).rejects.toThrow(MalformedImage)
    // A byte where a marker's 0xFF should be.
    const broken = bytes(plain.subarray(0, 20), 0x00, plain.subarray(21))
    await expect(strip('image/jpeg', broken)).rejects.toThrow(MalformedImage)
    // A marker that carries no length where a segment is expected.
    const stray = bytes(plain.subarray(0, 20), 0xff, 0x01, plain.subarray(20))
    await expect(strip('image/jpeg', stray)).rejects.toThrow(MalformedImage)
    // A segment whose length does not even cover its own length field.
    const short = bytes(plain.subarray(0, 20), 0xff, 0xfe, 0x00, 0x01, plain.subarray(20))
    await expect(strip('image/jpeg', short)).rejects.toThrow(MalformedImage)
  })
})

/** A JPEG segment: marker, then a length that counts itself. */
function segment(marker: number, payload: Uint8Array): Uint8Array {
  return bytes(0xff, marker, u16(payload.length + 2), payload)
}

/** The marker sequence of a JPEG, skipping over the entropy-coded data. */
function jpegMarkers(file: Uint8Array): number[] {
  const markers: number[] = []
  let offset = 2
  while (offset < file.length) {
    const marker = file[offset + 1] as number
    markers.push(marker)
    if (marker === 0xd9) break
    offset += 2 + ((file[offset + 2] as number) << 8) + (file[offset + 3] as number)
    if (marker === 0xda) {
      while (
        !(
          file[offset] === 0xff &&
          file[offset + 1] !== 0x00 &&
          !((file[offset + 1] as number) >= 0xd0 && (file[offset + 1] as number) <= 0xd7)
        )
      ) {
        offset += 1
      }
    }
  }
  return markers
}

describe('GIF', () => {
  it('keeps a picture with nothing to remove byte for byte, however it is chunked', async () => {
    const file = imageFixture('plain.gif')
    for (const chunkSize of [1, 5, 64, 100_000]) {
      expect(await strip('image/gif', file, chunkSize)).toStrictEqual(file)
    }
  })

  it('removes the comment an encoder writes, and nothing else', async () => {
    // The encoder wrote the commented file as GIF89a, which is the version
    // that has comments, and the plain one as GIF87a; the rest is the same.
    const stripped = await strip('image/gif', imageFixture('comment.gif'))
    expect(stripped).toStrictEqual(bytes('GIF89a', imageFixture('plain.gif').subarray(6)))
  })

  it('keeps the loop count and every frame of an animation, and drops its comment', async () => {
    const stripped = await strip('image/gif', imageFixture('animated.gif'))
    expect(gifBlocks(stripped)).toStrictEqual([
      'application:NETSCAPE2.0',
      'graphic-control',
      'image',
      'graphic-control',
      'image',
      'trailer',
    ])
    expect(contains(stripped, 'animated comment')).toBe(false)
  })

  it('drops the application extensions that carry metadata, plain text, and what it does not know', async () => {
    const plain = imageFixture('plain.gif')
    // The header, the screen descriptor, and the global colour table.
    const head = plain.subarray(0, 13 + (3 << (((plain[10] as number) & 7) + 1)))
    const rest = plain.subarray(head.length)
    const xmp = bytes(0x21, 0xff, 0x0b, 'XMP DataXMP', 0x05, XMP_AUTHOR.slice(0, 5), 0x00)
    const iccp = bytes(0x21, 0xff, 0x0b, 'ICCRGBG1012', 0x03, 0x01, 0x02, 0x03, 0x00)
    const text = bytes(0x21, 0x01, 0x0c, new Uint8Array(12), 0x05, 'hello', 0x00)
    const odd = bytes(0x21, 0x7f, 0x02, 0xaa, 0xbb, 0x00)
    const shortApp = bytes(0x21, 0xff, 0x03, 'abc', 0x00)
    const stripped = await strip('image/gif', bytes(head, xmp, iccp, text, odd, shortApp, rest))
    expect(stripped).toStrictEqual(plain)
  })

  it('keeps a frame with its own colour table', async () => {
    const stripped = await strip('image/gif', imageFixture('animated.gif'))
    // The second frame of the fixture carries a local colour table; a decoder
    // would show the wrong colours without it.
    const secondImage = stripped.lastIndexOf(0x2c)
    expect((stripped[secondImage + 9] as number) & 0x80).toBe(0x80)
  })

  it('stops at the trailer, so a payload appended to the picture is not stored', async () => {
    const file = imageFixture('plain.gif')
    expect(await strip('image/gif', bytes(file, TRAILING_ZIP))).toStrictEqual(file)
  })

  it('refuses a file that ends inside a block, or with a block it cannot place', async () => {
    const plain = imageFixture('plain.gif')
    await expect(strip('image/gif', plain.subarray(0, plain.length - 4))).rejects.toThrow(
      MalformedImage,
    )
    await expect(strip('image/gif', plain.subarray(0, 10))).rejects.toThrow(MalformedImage)
    const broken = bytes(plain.subarray(0, 19), 0x99, plain.subarray(19))
    await expect(strip('image/gif', broken)).rejects.toThrow(MalformedImage)
  })
})

/** The blocks of a GIF after its colour table, named. */
function gifBlocks(file: Uint8Array): string[] {
  const blocks: string[] = []
  let offset = 13
  const flags = file[10] as number
  if (flags & 0x80) offset += 3 * (2 << (flags & 7))
  const subBlocks = (): void => {
    for (;;) {
      const size = file[offset] as number
      offset += 1 + size
      if (size === 0) return
    }
  }
  while (offset < file.length) {
    const introducer = file[offset] as number
    if (introducer === 0x3b) {
      blocks.push('trailer')
      break
    }
    if (introducer === 0x2c) {
      blocks.push('image')
      const imageFlags = file[offset + 9] as number
      offset += 10
      if (imageFlags & 0x80) offset += 3 * (2 << (imageFlags & 7))
      offset += 1
      subBlocks()
      continue
    }
    const label = file[offset + 1] as number
    if (label === 0xf9) blocks.push('graphic-control')
    else if (label === 0xff) {
      blocks.push(`application:${new TextDecoder().decode(file.subarray(offset + 3, offset + 14))}`)
    } else blocks.push(`extension:${label}`)
    offset += 2
    subBlocks()
  }
  return blocks
}

describe('WebP', () => {
  it('keeps a picture in the simple format byte for byte', async () => {
    const file = imageFixture('plain.webp')
    for (const chunkSize of [1, 5, 64, 100_000]) {
      expect(await strip('image/webp', file, chunkSize)).toStrictEqual(file)
    }
  })

  it('removes the EXIF and XMP chunks, clears their flags, and restates the length', async () => {
    const stripped = await strip('image/webp', imageFixture('exif.webp'))
    expect(webpChunks(stripped)).toStrictEqual(['VP8X', 'VP8L'])
    expect(riffLength(stripped)).toBe(stripped.length - 8)
    expect(stripped[20]).toBe(0x00) // the VP8X flags: EXIF and XMP no longer claimed
    expect(contains(stripped, EXIF_MAKE)).toBe(false)
    expect(contains(stripped, XMP_AUTHOR)).toBe(false)
  })

  it('keeps every frame of an animation and its loop, and drops the EXIF after them', async () => {
    const stripped = await strip('image/webp', imageFixture('animated-exif.webp'))
    expect(webpChunks(stripped)).toStrictEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF'])
    expect(stripped[20]).toBe(0x02) // animation still claimed, EXIF not
    expect(riffLength(stripped)).toBe(stripped.length - 8)
  })

  it('keeps the colour profile and its flag', async () => {
    const stripped = await strip('image/webp', imageFixture('icc-exif.webp'))
    expect(webpChunks(stripped)).toStrictEqual(['VP8X', 'ICCP', 'VP8L'])
    expect(stripped[20]).toBe(0x20)
  })

  it('keeps the alpha plane and drops a chunk it does not know', async () => {
    const vp8 = imageFixture('plain.webp').subarray(12)
    const vp8x = chunkOf('VP8X', bytes(0x10, 0, 0, 0, 1, 0, 0, 1, 0, 0))
    const alph = chunkOf('ALPH', bytes(0x00, 0xff, 0xff, 0xff, 0xff))
    const unknown = chunkOf('QUIL', bytes('anything at all'))
    const file = webpFile(vp8x, alph, unknown, vp8)
    expect(await strip('image/webp', file)).toStrictEqual(webpFile(vp8x, alph, vp8))
  })

  it('keeps the padding byte an odd-sized chunk carries', async () => {
    const odd = chunkOf('ICCP', bytes(0x01, 0x02, 0x03))
    expect(odd.length % 2).toBe(0)
    const vp8 = imageFixture('plain.webp').subarray(12)
    const vp8x = chunkOf('VP8X', bytes(0x20, 0, 0, 0, 1, 0, 0, 1, 0, 0))
    const file = webpFile(vp8x, odd, vp8)
    expect(await strip('image/webp', file)).toStrictEqual(file)
  })

  it('drops what follows the RIFF, and refuses a RIFF that promises more than arrived', async () => {
    const file = imageFixture('plain.webp')
    expect(await strip('image/webp', bytes(file, TRAILING_ZIP))).toStrictEqual(file)
    await expect(strip('image/webp', file.subarray(0, file.length - 4))).rejects.toThrow(
      MalformedImage,
    )
    const overrun = bytes(file.subarray(0, 16), u32le(1000), file.subarray(20))
    await expect(strip('image/webp', overrun)).rejects.toThrow(MalformedImage)
    await expect(strip('image/webp', file.subarray(0, 10))).rejects.toThrow(MalformedImage)
    // A RIFF whose length leaves room for part of a chunk header only.
    const cut = bytes('RIFF', u32le(8), 'WEBP', 'VP8 ')
    await expect(strip('image/webp', cut)).rejects.toThrow(MalformedImage)
  })
})

function chunkOf(fourcc: string, payload: Uint8Array): Uint8Array {
  const padding = payload.length % 2 === 1 ? bytes(0x00) : new Uint8Array()
  return bytes(fourcc, u32le(payload.length), payload, padding)
}

function webpFile(...chunks: readonly Uint8Array[]): Uint8Array {
  const body = bytes(...chunks)
  return bytes('RIFF', u32le(4 + body.length), 'WEBP', body)
}

function riffLength(file: Uint8Array): number {
  return new DataView(file.buffer, file.byteOffset).getUint32(4, true)
}

function webpChunks(file: Uint8Array): string[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const chunks: string[] = []
  for (let offset = 12; offset < file.length;) {
    chunks.push(new TextDecoder().decode(file.subarray(offset, offset + 4)))
    const size = view.getUint32(offset + 4, true)
    offset += 8 + size + (size % 2)
  }
  return chunks
}

describe('AVIF', () => {
  it('keeps a picture with nothing to remove byte for byte', async () => {
    const file = imageFixture('plain.avif')
    for (const chunkSize of [1, 5, 64, 100_000]) {
      expect(await strip('image/avif', file, chunkSize)).toStrictEqual(file)
    }
  })

  it('removes the EXIF and XMP items and every reference to them, keeping the picture where it was', async () => {
    const original = imageFixture('exif.avif')
    const stripped = await strip('image/avif', original)

    const before = avifItems(original)
    const after = avifItems(stripped)
    expect(before.map((item) => item.type)).toStrictEqual(['av01', 'Exif', 'mime'])
    expect(after.map((item) => item.type)).toStrictEqual(['av01'])
    // The primary item's bytes, read through the rewritten locations, are the
    // bytes the original located.
    expect(after[0]?.data).toStrictEqual(before[0]?.data)
    expect(avifBoxes(stripped)).toStrictEqual(['ftyp', 'meta', 'mdat'])
    expect(contains(stripped, EXIF_MAKE)).toBe(false)
    expect(contains(stripped, XMP_AUTHOR)).toBe(false)
    expect(contains(stripped, 'cdsc')).toBe(false)
    expect(stripped.length).toBeLessThan(original.length)
  })

  it('drops free space', async () => {
    const file = imageFixture('plain.avif')
    const free = box('free', bytes('room for a payload'))
    // The picture's one extent, stated at byte 113 of the fixture's location
    // table, moves by the length of the box put in front of it.
    const meta = Uint8Array.from(file.subarray(32, 32 + 235))
    meta.set(u32(275 + free.length), 113 - 32)
    const withFree = bytes(file.subarray(0, 32), meta, free, file.subarray(32 + 235))
    expect(await strip('image/avif', withFree)).toStrictEqual(file)
  })

  it('reads every byte, and refuses what follows the last box, having no end marker to stop at', async () => {
    const file = imageFixture('plain.avif')
    let delivered = 0
    async function* counted(): AsyncGenerator<Uint8Array> {
      for await (const chunk of chunked(bytes(file, TRAILING_ZIP), 16)) {
        delivered += chunk.length
        yield chunk
      }
    }
    await expect(collect(stripImageMetadata('image/avif', counted()))).rejects.toThrow(
      MalformedImage,
    )
    expect(delivered).toBe(file.length + TRAILING_ZIP.length)
  })

  it('rewrites a location table in every shape the format allows', async () => {
    for (const shape of [
      { ilocVersion: 1, offsetSize: 8, lengthSize: 8, baseOffsetSize: 4, indexSize: 0 },
      { ilocVersion: 2, offsetSize: 4, lengthSize: 0, baseOffsetSize: 8, indexSize: 4 },
      { ilocVersion: 0, offsetSize: 0, lengthSize: 4, baseOffsetSize: 4, indexSize: 0 },
    ] as const) {
      const file = syntheticAvif({ ...shape, infeVersion: 3, iinfVersion: 1, ipmaVersion: 1 })
      const stripped = await strip('image/avif', file)
      expect(avifItems(stripped).map((item) => [item.type, item.data])).toStrictEqual([
        ['av01', PIXELS],
      ])
      expect(contains(stripped, EXIF_MAKE)).toBe(false)
    }
  })

  it('blanks metadata stored beside the tables, where nothing can be allowed to move', async () => {
    // Construction method 1: the item's bytes are inside `idat`, in `meta`
    // itself, so they are overwritten rather than removed.
    const file = syntheticAvif({ ilocVersion: 1, metadataMethod: 1 })
    const stripped = await strip('image/avif', file)
    expect(avifItems(stripped).map((item) => [item.type, item.data])).toStrictEqual([
      ['av01', PIXELS],
    ])
    expect(contains(stripped, EXIF_MAKE)).toBe(false)
    expect(contains(stripped, 'idat')).toBe(true)
  })

  it('re-points a picture stored beside the tables, and drops an item with no bytes of its own', async () => {
    const file = syntheticAvif({ ilocVersion: 1, pixelsMethod: 1, metadataMethod: 2 })
    const stripped = await strip('image/avif', file)
    expect(avifItems(stripped).map((item) => [item.type, item.data])).toStrictEqual([
      ['av01', PIXELS],
    ])
  })

  it('keeps the references between surviving items, and only those', async () => {
    const file = syntheticAvif({
      irefVersion: 1,
      references: [
        { type: 'cdsc', from: 2, to: [1] }, // from the metadata: goes
        { type: 'auxl', from: 1, to: [2] }, // to nothing but the metadata: goes
        { type: 'dimg', from: 1, to: [2, 1] }, // partly to the metadata: trimmed
      ],
    })
    const stripped = await strip('image/avif', file)
    expect(contains(stripped, 'cdsc')).toBe(false)
    expect(contains(stripped, 'auxl')).toBe(false)
    const reference = Buffer.from(stripped).indexOf('dimg')
    expect(reference).toBeGreaterThan(0)
    // from 1, one reference, to 1: ids are four bytes wide in version 1.
    expect(stripped.subarray(reference + 4, reference + 14)).toStrictEqual(
      bytes(u32(1), u16(1), u32(1)),
    )
  })

  it('handles the wide box header, and a box that runs to the end of the file', async () => {
    for (const file of [syntheticAvif({ largeMdat: true }), syntheticAvif({ mdatToEnd: true })]) {
      const stripped = await strip('image/avif', file)
      expect(avifItems(stripped).map((item) => [item.type, item.data])).toStrictEqual([
        ['av01', PIXELS],
      ])
    }
  })

  describe('refuses', () => {
    const fixture = imageFixture('exif.avif')
    /** The fixture with bytes overwritten at `offset`. */
    const patched = (offset: number, ...replacement: readonly (number | string)[]) => {
      const copy = Uint8Array.from(fixture)
      copy.set(bytes(...replacement), offset)
      return copy
    }
    it.each<[string, () => Uint8Array]>([
      ['a file cut short inside a box', () => fixture.subarray(0, 300)],
      ['a file cut short before its last box ends', () => fixture.subarray(0, fixture.length - 10)],
      ['a file too short to hold a box header', () => bytes(u32(5), 'ftyp')],
      ['bytes after the last box too few to be a box', () => bytes(fixture, 0x00, 0x00)],
      ['a box that overruns its parent', () => patched(44, ...u32(5000))],
      ['a wide box header cut short', () => bytes(fixture, u32(1), 'mdat', u32(0))],
      ['no meta box', () => bytes(fixture.subarray(0, 32), fixture.subarray(414))],
      ['a meta box with no item tables', () => syntheticAvif({ omitItemTables: true })],
      ['a location table that ends before its last entry', () => patched(105, ...u16(30))],
      ['a field width the format does not allow', () => patched(103, 0x33)],
      ['an item name with no end', () => patched(188, 'x')],
      ['something other than an item entry in the item table', () => patched(167, 'xxxx')],
      ['an item entry older than the format allows', () => patched(171, 0x01)],
      ['an item whose bytes are in another file', () => syntheticAvif({ externalData: true })],
      [
        'an item in an idat the file lacks',
        () => syntheticAvif({ ilocVersion: 1, metadataMethod: 1, omitIdat: true }),
      ],
      ['a location outside any box', () => syntheticAvif({ primaryOffset: 100_000 })],
      ['metadata that crosses a box boundary', () => syntheticAvif({ metadataLength: 1000 })],
      ['metadata stored inside the tables', () => syntheticAvif({ metadataOffset: 50 })],
      ['a property table that ends before its last entry', () => patched(408, 200)],
    ])('%s', async (_name, file) => {
      await expect(strip('image/avif', file())).rejects.toThrow(MalformedImage)
    })
  })
})

const PIXELS = bytes('AV1 payload standing in for the picture')

function ascii(file: Uint8Array, start: number, end: number): string {
  return new TextDecoder().decode(file.subarray(start, end))
}

function box(type: string, ...payload: readonly Uint8Array[]): Uint8Array {
  const body = bytes(...payload)
  return bytes(u32(8 + body.length), type, body)
}

function fullBox(
  type: string,
  version: number,
  flags: number,
  ...payload: readonly Uint8Array[]
): Uint8Array {
  return box(
    type,
    bytes(version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff),
    ...payload,
  )
}

/** A big-endian unsigned integer of `size` bytes, for the sizes `iloc` declares. */
function uint(size: 0 | 4 | 8, value: number): Uint8Array {
  if (size === 0) return new Uint8Array()
  return size === 4 ? u32(value) : u64(value)
}

interface Reference {
  readonly type: string
  readonly from: number
  readonly to: readonly number[]
}

interface SyntheticAvifOptions {
  readonly ilocVersion?: 0 | 1 | 2
  readonly offsetSize?: 0 | 4 | 8
  readonly lengthSize?: 0 | 4 | 8
  readonly baseOffsetSize?: 0 | 4 | 8
  readonly indexSize?: 0 | 4 | 8
  readonly infeVersion?: 2 | 3
  readonly iinfVersion?: 0 | 1
  readonly ipmaVersion?: 0 | 1
  readonly irefVersion?: 0 | 1
  readonly references?: readonly Reference[]
  /** Where the picture's bytes are: in `mdat` (0) or in `idat` (1). */
  readonly pixelsMethod?: 0 | 1
  /** Where the EXIF item's bytes are: in `mdat` (0), in `idat` (1), or nowhere of its own (2). */
  readonly metadataMethod?: 0 | 1 | 2
  /** A stated position for the EXIF bytes other than where they are. */
  readonly metadataOffset?: number
  /** A stated length for the EXIF bytes other than their length. */
  readonly metadataLength?: number
  /** A stated position for the picture other than where it is. */
  readonly primaryOffset?: number
  /** The EXIF item's bytes are said to be in another file. */
  readonly externalData?: boolean
  readonly omitIdat?: boolean
  readonly omitItemTables?: boolean
  readonly largeMdat?: boolean
  readonly mdatToEnd?: boolean
}

/**
 * An AVIF built by hand around a stand-in payload: one picture item and one
 * EXIF item, with the tables written in whichever of the format's shapes the
 * test asks for. Not decodable — the payload is not AV1 — but every table in
 * it is real, and those are what the rewrite reads and writes.
 */
function syntheticAvif({
  ilocVersion = 0,
  offsetSize = 4,
  lengthSize = 4,
  baseOffsetSize = 0,
  indexSize = 0,
  infeVersion = 2,
  iinfVersion = 0,
  ipmaVersion = 0,
  irefVersion = 0,
  references = [{ type: 'cdsc', from: 2, to: [1] }],
  pixelsMethod = 0,
  metadataMethod = 0,
  metadataOffset,
  metadataLength,
  primaryOffset,
  externalData = false,
  omitIdat = false,
  omitItemTables = false,
  largeMdat = false,
  mdatToEnd = false,
}: SyntheticAvifOptions): Uint8Array {
  const exif = bytes(u32(0), 'MM', 0x00, 0x2a, EXIF_MAKE)
  const itemId = (id: number) => (ilocVersion < 2 ? u16(id) : u32(id))
  const infeId = (id: number) => (infeVersion === 2 ? u16(id) : u32(id))
  const irefId = (id: number) => (irefVersion === 0 ? u16(id) : u32(id))

  const ftyp = box('ftyp', bytes('avif'), u32(0), bytes('avifmif1'))
  const hdlr = fullBox('hdlr', 0, 0, u32(0), bytes('pict'), u32(0), u32(0), u32(0), bytes(0x00))
  const pitm = fullBox('pitm', 0, 0, u16(1))
  const infe = (id: number, type: string, name: string) =>
    fullBox('infe', infeVersion, 0, infeId(id), u16(0), bytes(type), bytes(name, 0x00))
  const iinf = fullBox(
    'iinf',
    iinfVersion,
    0,
    iinfVersion === 0 ? u16(2) : u32(2),
    infe(1, 'av01', 'Color'),
    infe(2, 'Exif', 'Exif'),
  )
  const iref = fullBox(
    'iref',
    irefVersion,
    0,
    ...references.map((reference) =>
      box(
        reference.type,
        irefId(reference.from),
        u16(reference.to.length),
        ...reference.to.map(irefId),
      ),
    ),
  )
  const ipco = box('ipco', box('ispe', u32(0), u32(2), u32(2)))
  const association = ipmaVersion === 0 ? bytes(0x81) : bytes(0x80, 0x01)
  const ipma = fullBox(
    'ipma',
    ipmaVersion,
    ipmaVersion,
    u32(2),
    ipmaVersion === 0 ? u16(1) : u32(1),
    bytes(0x01),
    association,
    ipmaVersion === 0 ? u16(2) : u32(2),
    bytes(0x01),
    association,
  )
  const iprp = box('iprp', ipco, ipma)

  // What each container holds, in order: the picture, then the metadata.
  const idatBody = bytes(
    pixelsMethod === 1 ? PIXELS : new Uint8Array(),
    metadataMethod === 1 ? exif : new Uint8Array(),
  )
  const mdatBody = bytes(
    pixelsMethod === 0 ? PIXELS : new Uint8Array(),
    metadataMethod === 0 ? exif : new Uint8Array(),
  )
  const idat = omitIdat || idatBody.length === 0 ? new Uint8Array() : box('idat', idatBody)

  // Everything before `iloc` inside `meta` has a fixed size, so the location
  // of the payload can be computed before the table that states it is built.
  const ilocEntry = (
    id: number,
    method: number,
    dataReference: number,
    offset: number,
    length: number,
  ) =>
    bytes(
      itemId(id),
      ilocVersion === 0 ? new Uint8Array() : u16(method),
      u16(dataReference),
      uint(baseOffsetSize, baseOffsetSize === 0 ? 0 : offset),
      u16(1),
      uint(indexSize, 0),
      uint(offsetSize, baseOffsetSize === 0 ? offset : 0),
      uint(lengthSize, length),
    )
  const ilocSize =
    12 +
    2 +
    (ilocVersion < 2 ? 2 : 4) +
    2 *
      ((ilocVersion < 2 ? 2 : 4) +
        (ilocVersion === 0 ? 0 : 2) +
        2 +
        baseOffsetSize +
        2 +
        indexSize +
        offsetSize +
        lengthSize)
  const tables = omitItemTables ? 0 : ilocSize + iinf.length
  const metaLength =
    12 + hdlr.length + pitm.length + tables + iref.length + iprp.length + idat.length
  const mdatHeaderLength = largeMdat ? 16 : 8
  const mdatPayloadStart = ftyp.length + metaLength + mdatHeaderLength
  const pixelsOffset = primaryOffset ?? (pixelsMethod === 0 ? mdatPayloadStart : 0)
  const afterPixels = pixelsMethod === metadataMethod ? PIXELS.length : 0
  const exifOffset =
    metadataOffset ?? (metadataMethod === 0 ? mdatPayloadStart + afterPixels : afterPixels)
  const iloc = fullBox(
    'iloc',
    ilocVersion,
    0,
    bytes((offsetSize << 4) | lengthSize, (baseOffsetSize << 4) | indexSize),
    ilocVersion < 2 ? u16(2) : u32(2),
    ilocEntry(1, pixelsMethod, 0, pixelsOffset, lengthSize === 0 ? 0 : PIXELS.length),
    ilocEntry(
      2,
      metadataMethod,
      externalData ? 1 : 0,
      metadataMethod === 2 ? 0 : exifOffset,
      metadataLength ?? exif.length,
    ),
  )
  expect(iloc.length).toBe(ilocSize)
  const meta = omitItemTables
    ? fullBox('meta', 0, 0, hdlr, pitm, iref, iprp, idat)
    : fullBox('meta', 0, 0, hdlr, pitm, iloc, iinf, iref, iprp, idat)
  expect(meta.length).toBe(metaLength)
  const mdatSize = mdatToEnd ? 0 : mdatHeaderLength + mdatBody.length
  const mdat = largeMdat
    ? bytes(u32(1), 'mdat', u64(mdatSize), mdatBody)
    : bytes(u32(mdatSize), 'mdat', mdatBody)
  return bytes(ftyp, meta, mdat)
}

function avifBoxes(file: Uint8Array): string[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const types: string[] = []
  for (let offset = 0; offset < file.length;) {
    let size = view.getUint32(offset)
    types.push(ascii(file, offset + 4, offset + 8))
    if (size === 1) size = Number(view.getBigUint64(offset + 8))
    if (size === 0) size = file.length - offset
    offset += size
  }
  return types
}

interface AvifItem {
  readonly id: number
  readonly type: string
  /** The bytes the location table points at. */
  readonly data: Uint8Array
}

/**
 * The items of an AVIF with their bytes, read the way a decoder reads them:
 * types from `iinf`, positions from `iloc`, construction method honoured.
 * Independent of the implementation, so the tests do not trust the code they
 * are checking to read its own output.
 */
function avifItems(file: Uint8Array): AvifItem[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const read = (offset: number, size: number): number => {
    if (size === 8) return Number(view.getBigUint64(offset))
    if (size === 4) return view.getUint32(offset)
    if (size === 2) return view.getUint16(offset)
    return 0
  }
  const children = (start: number, end: number): { type: string; start: number; end: number }[] => {
    const found = []
    for (let offset = start; offset < end;) {
      let size = view.getUint32(offset)
      let header = 8
      if (size === 1) {
        size = Number(view.getBigUint64(offset + 8))
        header = 16
      }
      if (size === 0) size = end - offset
      found.push({
        type: ascii(file, offset + 4, offset + 8),
        start: offset + header,
        end: offset + size,
      })
      offset += size
    }
    return found
  }
  const metaBox = children(0, file.length).find((child) => child.type === 'meta')
  if (metaBox === undefined) throw new Error('no meta box')
  const meta = children(metaBox.start + 4, metaBox.end)
  const find = (type: string) => meta.find((child) => child.type === type)
  const iinf = find('iinf')
  const iloc = find('iloc')
  const idat = find('idat')
  if (iinf === undefined || iloc === undefined) throw new Error('no item tables')

  const types = new Map<number, string>()
  const iinfVersion = file[iinf.start] as number
  for (const infe of children(iinf.start + (iinfVersion === 0 ? 6 : 8), iinf.end)) {
    const version = file[infe.start] as number
    const id = version === 2 ? view.getUint16(infe.start + 4) : view.getUint32(infe.start + 4)
    const typeAt = infe.start + 4 + (version === 2 ? 2 : 4) + 2
    types.set(id, ascii(file, typeAt, typeAt + 4))
  }

  const version = file[iloc.start] as number
  const offsetSize = (file[iloc.start + 4] as number) >> 4
  const lengthSize = (file[iloc.start + 4] as number) & 15
  const baseOffsetSize = (file[iloc.start + 5] as number) >> 4
  const indexSize = version === 0 ? 0 : (file[iloc.start + 5] as number) & 15
  let offset = iloc.start + 6
  const count = version < 2 ? view.getUint16(offset) : view.getUint32(offset)
  offset += version < 2 ? 2 : 4
  const items: AvifItem[] = []
  for (let i = 0; i < count; i += 1) {
    const id = read(offset, version < 2 ? 2 : 4)
    offset += version < 2 ? 2 : 4
    let method = 0
    if (version > 0) {
      method = view.getUint16(offset) & 15
      offset += 2
    }
    offset += 2 // data reference index
    const base = read(offset, baseOffsetSize)
    offset += baseOffsetSize
    const extents = view.getUint16(offset)
    offset += 2
    const parts: Uint8Array[] = []
    for (let e = 0; e < extents; e += 1) {
      offset += indexSize
      const extentOffset = read(offset, offsetSize)
      offset += offsetSize
      const extentLength = read(offset, lengthSize)
      offset += lengthSize
      const origin = method === 1 ? (idat?.start ?? 0) : 0
      const start = origin + base + extentOffset
      const end =
        extentLength === 0 ? (method === 1 ? (idat?.end ?? 0) : file.length) : start + extentLength
      parts.push(file.subarray(start, end))
    }
    items.push({ id, type: types.get(id) ?? '?', data: concatChunks(parts) })
  }
  return items
}
