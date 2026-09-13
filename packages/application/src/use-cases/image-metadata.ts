import {
  ascii,
  ByteSource,
  ContainerFault,
  readUint16,
  readUint32,
  readUint32LittleEndian,
  writeUint32LittleEndian,
} from './image-container.ts'
import { rewriteAvif } from './image-metadata-avif.ts'
import type { ImageMediaType } from './media-types.ts'

/**
 * What an uploaded picture carries besides its pixels, taken out (ADR-011,
 * amendment of 2026-09-13).
 *
 * A photograph from a phone carries where it was taken, on what, and when; a
 * screenshot names the software that made it; an edited picture may carry a
 * thumbnail of what was cropped away. Every reader of the document would
 * receive all of it. So each format is walked at the level of its container —
 * chunks, segments, blocks, boxes — and only the parts a decoder needs to show
 * the picture are kept: the pixels, the palette, the colour profile, the
 * frames of an animation, the dimensions. EXIF, XMP, IPTC, comments, text and
 * time stamps are dropped, and so is whatever follows the end of the image,
 * which is where a second file hides when one is hidden.
 *
 * Nothing here decodes a pixel. Re-encoding through a decoder would remove the
 * same metadata, but at the cost of running that decoder on the server against
 * every upload, and the amendment records why that trade was refused. What the
 * platform stores is what these functions yield, so the size and hash of an
 * attachment are of the picture as kept, not as sent.
 *
 * PNG, JPEG and GIF are streamed: nothing is held beyond one frame header. A
 * WebP or an AVIF has to be whole before its first bytes can be right — a RIFF
 * states its own length at the front, and an AVIF's item table states where in
 * the file every item lies — so those two are rewritten from a buffer. The
 * buffer is bounded by the upload cap, which is applied upstream, before any
 * byte reaches here.
 */

/**
 * The bytes could not be walked as the format they were sniffed as: cut
 * short, framed wrongly, or pointing outside themselves. A picture that cannot
 * be walked cannot have its metadata removed, and so is not one the platform
 * will store; `reason` is what stopped the walker, in its own words.
 */
export class MalformedImage extends Error {
  readonly contentType: ImageMediaType
  readonly reason: string

  constructor(contentType: ImageMediaType, reason: string) {
    super(`not readable as ${contentType}: ${reason}`)
    this.name = 'MalformedImage'
    this.contentType = contentType
    this.reason = reason
  }
}

/** The picture with its metadata removed. The bytes must already have been sniffed as `type`. */
export function stripImageMetadata(
  type: ImageMediaType,
  chunks: AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  return attributed(type, walk(type, new ByteSource(chunks)))
}

/** A walker's refusal, with the format it was reading; any other failure as it was. */
async function* attributed(
  type: ImageMediaType,
  output: AsyncGenerator<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  try {
    yield* output
  } catch (error) {
    throw error instanceof ContainerFault ? new MalformedImage(type, error.message) : error
  }
}

function walk(type: ImageMediaType, source: ByteSource): AsyncGenerator<Uint8Array> {
  switch (type) {
    case 'image/png':
      return png(source)
    case 'image/jpeg':
      return jpeg(source)
    case 'image/gif':
      return gif(source)
    case 'image/webp':
      return rewritten(source, rewriteWebp)
    case 'image/avif':
      return rewritten(source, rewriteAvif)
  }
}

/** The whole file, rewritten in one piece: for the formats whose head states their length. */
async function* rewritten(
  source: ByteSource,
  rewrite: (file: Uint8Array) => Uint8Array,
): AsyncGenerator<Uint8Array> {
  yield rewrite(await source.rest())
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/**
 * The chunks a decoder needs. Critical chunks, the ones that change how the
 * pixels look (transparency, gamma, colour space, profile, background,
 * physical size, HDR mastering), and the ones that make an animation. Not
 * kept: text in any encoding, `eXIf`, `tIME`, offsets and calibration, and
 * every private or unknown chunk.
 */
const PNG_KEPT = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'tRNS',
  'cHRM',
  'gAMA',
  'iCCP',
  'sBIT',
  'sRGB',
  'cICP',
  'mDCV',
  'cLLI',
  'bKGD',
  'hIST',
  'pHYs',
  'sPLT',
  'acTL',
  'fcTL',
  'fdAT',
])

const PNG_SIGNATURE_LENGTH = 8

/** Length, type, data, CRC: the CRC travels with the data and is counted with it here. */
const PNG_CHUNK_HEADER = 8
const PNG_CRC = 4

async function* png(source: ByteSource): AsyncGenerator<Uint8Array> {
  yield await source.take(PNG_SIGNATURE_LENGTH)
  for (;;) {
    const header = await source.take(PNG_CHUNK_HEADER)
    const length = readUint32(header, 0) + PNG_CRC
    const type = ascii(header, 4, 8)
    if (type === 'IEND') {
      yield header
      yield await source.take(length)
      break
    }
    if (PNG_KEPT.has(type)) {
      yield header
      yield* source.pass(length)
    } else {
      await source.skip(length)
    }
  }
  await source.drain()
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const JPEG_MARKER_PREFIX = 0xff
const JPEG_EOI = 0xd9
const JPEG_SOS = 0xda

/**
 * The application segments kept, by the identifier at the head of their
 * payload, because the segment number alone says too little: `APP2` is a
 * colour profile or a multi-picture index, and `APP0` is the JFIF header or a
 * thumbnail. Everything not named here — EXIF and XMP in `APP1`, Photoshop and
 * IPTC in `APP13`, comments, and the rest — is dropped.
 */
const JPEG_KEPT_APPLICATION_SEGMENTS: ReadonlyMap<number, string> = new Map([
  [0xe0, 'JFIF\0'],
  [0xe2, 'ICC_PROFILE\0'],
  [0xee, 'Adobe'],
])

/** The longest identifier above: how much of a segment has to be seen to decide. */
const JPEG_IDENTIFIER_LENGTH = 12

/**
 * Whether a marker is followed by a length and a payload. Restart markers,
 * start-of-image, and the temporary marker stand alone; none of them belongs
 * between segments, so meeting one there is a malformed file.
 */
function hasSegment(marker: number): boolean {
  return marker !== 0x00 && marker !== 0x01 && (marker < 0xd0 || marker > 0xd8)
}

/**
 * Whether a segment other than an application one is part of the picture:
 * tables, frame and scan headers, restart interval, hierarchical and
 * arithmetic-coding definitions. Comments (`FE`) and the reserved extension
 * segments (`F0`–`FD`) are not.
 */
function isStructural(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xdf
}

async function* jpeg(source: ByteSource): AsyncGenerator<Uint8Array> {
  yield await source.take(2) // start of image
  for (;;) {
    const marker = await markerAfterFill(source)
    if (marker === JPEG_EOI) {
      yield Uint8Array.from([JPEG_MARKER_PREFIX, JPEG_EOI])
      break
    }
    if (!hasSegment(marker)) throw new ContainerFault('a marker where a segment should begin')
    const lengthBytes = await source.take(2)
    const length = readUint16(lengthBytes, 0) - 2
    if (length < 0) throw new ContainerFault('a segment shorter than its own length field')

    const head = await source.take(Math.min(length, JPEG_IDENTIFIER_LENGTH))
    if (keepsSegment(marker, head)) {
      yield Uint8Array.from([JPEG_MARKER_PREFIX, marker, ...lengthBytes, ...head])
      yield* source.pass(length - head.length)
      if (marker === JPEG_SOS) yield* scan(source)
    } else {
      await source.skip(length - head.length)
    }
  }
  await source.drain()
}

function keepsSegment(marker: number, head: Uint8Array): boolean {
  const identifier = JPEG_KEPT_APPLICATION_SEGMENTS.get(marker)
  if (identifier !== undefined) return ascii(head, 0, identifier.length) === identifier
  return isStructural(marker)
}

/** The marker byte after its `FF`, allowing the fill bytes a writer may put before it. */
async function markerAfterFill(source: ByteSource): Promise<number> {
  const prefix = await source.take(1)
  if (prefix[0] !== JPEG_MARKER_PREFIX) throw new ContainerFault('bytes between segments')
  let marker = JPEG_MARKER_PREFIX
  while (marker === JPEG_MARKER_PREFIX) marker = (await source.take(1))[0] as number
  return marker
}

/**
 * Whether the byte after an `FF` inside a scan ends the scan. A stuffed `00`
 * and the restart markers are part of the entropy-coded data; anything else
 * is the next segment's marker.
 */
function endsScan(byte: number): boolean {
  return byte !== 0x00 && (byte < 0xd0 || byte > 0xd7)
}

/**
 * The entropy-coded data after a scan header, passed through until the next
 * marker. The data has no length field, so it is scanned for `FF`; an `FF`
 * that is the last byte of a chunk is held until the next chunk says what it
 * was.
 */
async function* scan(source: ByteSource): AsyncGenerator<Uint8Array> {
  let heldPrefix = false
  for (;;) {
    const chunk = await source.pull()
    if (chunk === null) throw new ContainerFault('the file ends inside a scan')
    if (heldPrefix) {
      if (endsScan(chunk[0] as number)) {
        source.unread(chunk)
        source.unread(Uint8Array.from([JPEG_MARKER_PREFIX]))
        return
      }
      yield Uint8Array.from([JPEG_MARKER_PREFIX])
      heldPrefix = false
    }
    let index = 0
    while (index < chunk.length) {
      if (chunk[index] !== JPEG_MARKER_PREFIX) {
        index += 1
        continue
      }
      if (index + 1 === chunk.length) {
        heldPrefix = true
        break
      }
      if (endsScan(chunk[index + 1] as number)) {
        yield chunk.subarray(0, index)
        source.unread(chunk.subarray(index))
        return
      }
      index += 2
    }
    yield heldPrefix ? chunk.subarray(0, chunk.length - 1) : chunk
  }
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

const GIF_TRAILER = 0x3b
const GIF_IMAGE_DESCRIPTOR = 0x2c
const GIF_EXTENSION = 0x21
const GIF_GRAPHIC_CONTROL = 0xf9
const GIF_APPLICATION = 0xff

/**
 * The application extensions kept: the loop count of an animation, under
 * either name it has been written with. XMP, ICC, and everything else that
 * rides in an application extension is dropped, as are comments and plain
 * text.
 */
const GIF_KEPT_APPLICATIONS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0'])

/** The size of an application extension's identifier block, which the format fixes. */
const GIF_APPLICATION_IDENTIFIER = 11

/** The colour table a flags byte describes: three bytes per entry, `2^(n+1)` entries, or none. */
function colourTableLength(flags: number): number {
  return flags & 0x80 ? 3 << ((flags & 0x07) + 1) : 0
}

async function* gif(source: ByteSource): AsyncGenerator<Uint8Array> {
  yield await source.take(6) // header and version
  const screen = await source.take(7)
  yield screen
  yield* source.pass(colourTableLength(screen[4] as number))

  for (;;) {
    const introducer = await source.take(1)
    const kind = introducer[0]
    if (kind === GIF_TRAILER) {
      yield introducer
      break
    }
    if (kind === GIF_IMAGE_DESCRIPTOR) {
      const descriptor = await source.take(9)
      yield introducer
      yield descriptor
      yield* source.pass(colourTableLength(descriptor[8] as number))
      yield await source.take(1) // the LZW minimum code size
      yield* passSubBlocks(source)
      continue
    }
    if (kind !== GIF_EXTENSION) throw new ContainerFault('a block that is not a block')

    const label = await source.take(1)
    if (label[0] === GIF_GRAPHIC_CONTROL) {
      yield introducer
      yield label
      yield* passSubBlocks(source)
    } else if (label[0] === GIF_APPLICATION) {
      const size = await source.take(1)
      const identifier = await source.take(size[0] as number)
      if (
        size[0] === GIF_APPLICATION_IDENTIFIER &&
        GIF_KEPT_APPLICATIONS.has(ascii(identifier, 0, 11))
      ) {
        yield introducer
        yield label
        yield size
        yield identifier
        yield* passSubBlocks(source)
      } else {
        await skipSubBlocks(source)
      }
    } else {
      await skipSubBlocks(source)
    }
  }
  await source.drain()
}

/** Data sub-blocks: a size byte, that many bytes, until a size of zero. */
async function* passSubBlocks(source: ByteSource): AsyncGenerator<Uint8Array> {
  for (;;) {
    const size = await source.take(1)
    yield size
    if (size[0] === 0) return
    yield* source.pass(size[0] as number)
  }
}

async function skipSubBlocks(source: ByteSource): Promise<void> {
  for (;;) {
    const size = await source.take(1)
    if (size[0] === 0) return
    await source.skip(size[0] as number)
  }
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

/**
 * The chunks kept: the extended-format header, the colour profile, the alpha
 * plane, the animation parameters and frames, and the bitstream in either
 * coding. `EXIF` and `XMP ` are dropped, and so is any chunk the format does
 * not define.
 */
const WEBP_KEPT = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ICCP', 'ANIM', 'ANMF'])

const RIFF_HEADER = 12
const RIFF_CHUNK_HEADER = 8

/** In the `VP8X` flags byte: which chunks the file claims to carry. */
const WEBP_EXIF_FLAG = 0x08
const WEBP_XMP_FLAG = 0x04

/**
 * A WebP with its metadata chunks removed, the flags that announced them
 * cleared, and the RIFF length restated. Whatever lies past the RIFF's own
 * length is not part of the file.
 */
function rewriteWebp(file: Uint8Array): Uint8Array {
  if (file.length < RIFF_HEADER) throw new ContainerFault('shorter than a RIFF header')
  const end = RIFF_CHUNK_HEADER + readUint32LittleEndian(file, 4)
  if (end > file.length) throw new ContainerFault('the RIFF promises more than arrived')

  const kept: Uint8Array[] = []
  let total = 4 // the `WEBP` form type is counted in the RIFF length
  for (let offset = RIFF_HEADER; offset < end;) {
    if (offset + RIFF_CHUNK_HEADER > end) throw new ContainerFault('a chunk header past the end')
    const fourcc = ascii(file, offset, offset + 4)
    const size = readUint32LittleEndian(file, offset + 4)
    const padded = size + (size % 2)
    const next = offset + RIFF_CHUNK_HEADER + padded
    if (offset + RIFF_CHUNK_HEADER + size > end) throw new ContainerFault('a chunk past the end')
    if (WEBP_KEPT.has(fourcc)) {
      // The padding byte is part of the chunk, and a file may end without it.
      const chunk = new Uint8Array(RIFF_CHUNK_HEADER + padded)
      chunk.set(file.subarray(offset, Math.min(next, end)))
      if (fourcc === 'VP8X') {
        chunk[RIFF_CHUNK_HEADER] =
          (chunk[RIFF_CHUNK_HEADER] as number) & ~(WEBP_EXIF_FLAG | WEBP_XMP_FLAG)
      }
      kept.push(chunk)
      total += chunk.length
    }
    offset = next
  }

  const out = new Uint8Array(RIFF_CHUNK_HEADER + total)
  out.set(file.subarray(0, 4))
  out.set(writeUint32LittleEndian(total), 4)
  out.set(file.subarray(8, 12), 8)
  let offset = RIFF_HEADER
  for (const chunk of kept) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
