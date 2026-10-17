import { concatChunks } from '../ports/blob-store.ts'
import { ascii, ContainerFault, crc32, readUint16, readUint32 } from './image-container.ts'
import type { ImageMediaType } from './media-types.ts'

/**
 * Whether a picture moves: how many frames, for how long, and — where the
 * container allows it — a still of its first frame, so a reader who has asked
 * for less motion is shown that instead (`prefers-reduced-motion`; WCAG 2.2.2).
 *
 * Read at upload, and without decoding a pixel, for the reason
 * `image-metadata.ts` gives: the platform walks containers and does not run a
 * codec against what strangers send it. The frame count and the running time
 * are what ADR-047's animation limits are held to.
 *
 * - **GIF**: frames are image descriptors and time is the sum of their
 *   graphic controls' delays. The still is the header, the screen and its
 *   palette, the first frame with its graphic control, and the trailer — a
 *   complete GIF of one frame.
 * - **APNG**: frames and time from `acTL` and each `fcTL`. The still is the
 *   same PNG without the animation chunks: its default image, which is the
 *   first frame unless the encoder chose a separate poster.
 * - **Animated WebP**: frames are `ANMF` chunks, each stating its duration.
 * - **AVIF sequence**: frames are the track's samples (`stsz`), and time is
 *   the movie's duration (`mvhd`).
 *
 * A WebP frame is a sub-image to be composited and an AVIF sequence's frames
 * are coded video, so neither yields a still without a codec. They are shown
 * as they are until ADR-047's image pipeline derives their stills; nothing
 * here pretends otherwise.
 *
 * Expects bytes already sniffed as `type` and walked by `stripImageMetadata`.
 */
export type Animation =
  | { readonly kind: 'still' }
  | {
      readonly kind: 'animated'
      readonly frames: number
      readonly milliseconds: number
      /** The first frame, in the animation's own type, where one can be cut without a codec. */
      readonly still?: Uint8Array
    }

const STILL: Animation = { kind: 'still' }

export function animationOf(type: ImageMediaType, bytes: Uint8Array): Animation {
  switch (type) {
    case 'image/gif':
      return gifAnimation(bytes)
    case 'image/png':
      return pngAnimation(bytes)
    case 'image/webp':
      return webpAnimation(bytes)
    case 'image/avif':
      return avifAnimation(bytes)
    case 'image/jpeg':
      return STILL
  }
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

const GIF_TRAILER = 0x3b
const GIF_IMAGE_DESCRIPTOR = 0x2c
const GIF_EXTENSION = 0x21
const GIF_GRAPHIC_CONTROL = 0xf9
/** Header and logical screen descriptor. */
const GIF_HEAD = 13
/**
 * Browsers draw a frame whose delay is under two hundredths as a tenth of a
 * second, so that is what it counts as against the limit.
 */
const GIF_SHORTEST_DELAY = 2
const GIF_DEFAULT_DELAY = 10

function colourTableLength(flags: number): number {
  return flags & 0x80 ? 3 << ((flags & 0x07) + 1) : 0
}

/** The offset just past a run of data sub-blocks that starts at `offset`. */
function pastSubBlocks(bytes: Uint8Array, offset: number): number {
  let at = offset
  for (;;) {
    const size = bytes[at]
    if (size === undefined) throw new ContainerFault('a GIF that ends inside a block')
    at += 1 + size
    if (size === 0) return at
  }
}

/** A graphic control's delay, in hundredths of a second, as a browser draws it. */
function gifDelay(control: Uint8Array | undefined): number {
  const delay = control === undefined ? 0 : (control[4] ?? 0) | ((control[5] ?? 0) << 8)
  return delay < GIF_SHORTEST_DELAY ? GIF_DEFAULT_DELAY : delay
}

/** One block of a GIF after its screen and palette: where it starts and ends, and what it is. */
interface GifBlock {
  readonly start: number
  readonly end: number
  /** The block's introducer, and for an extension its label. */
  readonly introducer: number
  readonly label: number | undefined
}

/** Where a GIF's blocks begin: past its header, its screen and its global palette. */
function gifHead(bytes: Uint8Array): number {
  return GIF_HEAD + colourTableLength(bytes[10] ?? 0)
}

/** The blocks of a GIF, up to its trailer. */
function* gifBlocks(bytes: Uint8Array): Generator<GifBlock> {
  for (let offset = gifHead(bytes); offset < bytes.length && bytes[offset] !== GIF_TRAILER;) {
    const introducer = bytes[offset]
    if (introducer === GIF_IMAGE_DESCRIPTOR) {
      const descriptorEnd = offset + 10 + colourTableLength(bytes[offset + 9] ?? 0)
      const end = pastSubBlocks(bytes, descriptorEnd + 1)
      yield { start: offset, end, introducer, label: undefined }
      offset = end
      continue
    }
    if (introducer !== GIF_EXTENSION) throw new ContainerFault('a block that is not a block')
    const end = pastSubBlocks(bytes, offset + 2)
    yield { start: offset, end, introducer, label: bytes[offset + 1] }
    offset = end
  }
}

function gifAnimation(bytes: Uint8Array): Animation {
  const head = gifHead(bytes)
  // The graphic control that applies to the next image, held until that image is met.
  let control: Uint8Array | undefined
  let first: Uint8Array | undefined
  let frames = 0
  let hundredths = 0

  for (const block of gifBlocks(bytes)) {
    if (block.introducer === GIF_IMAGE_DESCRIPTOR) {
      frames += 1
      hundredths += gifDelay(control)
      if (first === undefined) {
        const image = bytes.subarray(block.start, block.end)
        first = control === undefined ? image : concatChunks([control, image])
      }
      control = undefined
    } else if (block.label === GIF_GRAPHIC_CONTROL) {
      control = bytes.subarray(block.start, block.end)
    }
  }

  if (frames < 2 || first === undefined) return STILL
  return {
    kind: 'animated',
    frames,
    milliseconds: hundredths * 10,
    still: concatChunks([bytes.subarray(0, head), first, Uint8Array.of(GIF_TRAILER)]),
  }
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = 8
const PNG_CHUNK_OVERHEAD = 12
/** The chunks that make a PNG an animation; without them it is its default image. */
const APNG_CHUNKS = new Set(['acTL', 'fcTL', 'fdAT'])
/** In `fcTL`'s data: the delay's numerator and denominator. */
const FCTL_DELAY = 20
/** A denominator of nought means hundredths (APNG specification, `fcTL`). */
const FCTL_DEFAULT_DENOMINATOR = 100

function pngAnimation(bytes: Uint8Array): Animation {
  const kept: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE)]
  let frames: number | undefined
  let milliseconds = 0
  for (let offset = PNG_SIGNATURE; offset + 8 <= bytes.length;) {
    const data = offset + 8
    const end = offset + PNG_CHUNK_OVERHEAD + readUint32(bytes, offset)
    if (end > bytes.length) throw new ContainerFault('a PNG chunk past the end')
    const type = ascii(bytes, offset + 4, offset + 8)
    if (type === 'acTL') frames = readUint32(bytes, data)
    if (type === 'fcTL') {
      const numerator = readUint16(bytes, data + FCTL_DELAY)
      const denominator = readUint16(bytes, data + FCTL_DELAY + 2) || FCTL_DEFAULT_DENOMINATOR
      milliseconds += (numerator * 1000) / denominator
    }
    if (!APNG_CHUNKS.has(type)) kept.push(bytes.subarray(offset, end))
    offset = end
  }
  if (frames === undefined) return STILL
  return {
    kind: 'animated',
    frames,
    milliseconds: Math.round(milliseconds),
    still: concatChunks(kept),
  }
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

const RIFF_HEADER = 12
const RIFF_CHUNK_HEADER = 8
/** In an `ANMF` chunk's data: its duration, 24 bits little-endian, in milliseconds. */
const ANMF_DURATION = 12

function webpAnimation(bytes: Uint8Array): Animation {
  let frames = 0
  let milliseconds = 0
  for (let offset = RIFF_HEADER; offset + RIFF_CHUNK_HEADER <= bytes.length;) {
    const size =
      (bytes[offset + 4] ?? 0) |
      ((bytes[offset + 5] ?? 0) << 8) |
      ((bytes[offset + 6] ?? 0) << 16) |
      ((bytes[offset + 7] ?? 0) << 24)
    if (ascii(bytes, offset, offset + 4) === 'ANMF') {
      const at = offset + RIFF_CHUNK_HEADER + ANMF_DURATION
      frames += 1
      milliseconds += (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16)
    }
    offset += RIFF_CHUNK_HEADER + size + (size % 2)
  }
  return frames === 0 ? STILL : { kind: 'animated', frames, milliseconds }
}

// ---------------------------------------------------------------------------
// AVIF
// ---------------------------------------------------------------------------

/** The image-sequence brand; a file without it is a still, whatever else it holds. */
const SEQUENCE_BRAND = 'avis'
const BOX_HEADER = 8
/** Version and flags, at the head of a full box. */
const FULL_BOX = 4
/** The boxes that lead from a movie to a track's sample sizes. */
const SAMPLE_TABLE_PATH = ['trak', 'mdia', 'minf', 'stbl'] as const
/** Where a movie or its tracks may carry metadata the item-level stripping does not reach. */
const TRACK_METADATA = new Set(['udta', 'meta'])

interface IsoBox {
  readonly type: string
  readonly payload: number
  readonly end: number
}

/** The boxes directly inside a range: a handful at each level, so an array. */
function boxes(bytes: Uint8Array, start: number, end: number): readonly IsoBox[] {
  const found: IsoBox[] = []
  for (let offset = start; offset + BOX_HEADER <= end;) {
    const size = readUint32(bytes, offset)
    if (size < BOX_HEADER || offset + size > end) {
      throw new ContainerFault('a box overruns its parent')
    }
    found.push({
      type: ascii(bytes, offset + 4, offset + 8),
      payload: offset + BOX_HEADER,
      end: offset + size,
    })
    offset += size
  }
  return found
}

function child(bytes: Uint8Array, parent: IsoBox, type: string): IsoBox | undefined {
  return boxes(bytes, parent.payload, parent.end).find((box) => box.type === type)
}

function isSequence(bytes: Uint8Array): boolean {
  const [ftyp] = boxes(bytes, 0, bytes.length)
  if (ftyp?.type !== 'ftyp') return false
  if (ascii(bytes, ftyp.payload, ftyp.payload + 4) === SEQUENCE_BRAND) return true
  for (let offset = ftyp.payload + 8; offset + 4 <= ftyp.end; offset += 4) {
    if (ascii(bytes, offset, offset + 4) === SEQUENCE_BRAND) return true
  }
  return false
}

/** Whether a box, or anything inside a container of it, is one of `types`. */
function holds(bytes: Uint8Array, parent: IsoBox, types: ReadonlySet<string>): boolean {
  return boxes(bytes, parent.payload, parent.end).some(
    (box) =>
      types.has(box.type) ||
      (SAMPLE_TABLE_PATH.some((step) => step === box.type) && holds(bytes, box, types)),
  )
}

function avifAnimation(bytes: Uint8Array): Animation {
  if (!isSequence(bytes)) return STILL
  const moov = boxes(bytes, 0, bytes.length).find((box) => box.type === 'moov')
  if (moov === undefined) throw new ContainerFault('an image sequence with no movie')
  if (holds(bytes, moov, TRACK_METADATA)) {
    throw new ContainerFault(
      'an image sequence carrying metadata in its tracks, which cannot be removed without re-encoding it',
    )
  }

  const mvhd = child(bytes, moov, 'mvhd')
  if (mvhd === undefined) throw new ContainerFault('a movie with no header')
  const version = bytes[mvhd.payload] ?? 0
  // Version 1 widens both times and the duration to 64 bits.
  const timescaleAt = mvhd.payload + FULL_BOX + (version === 1 ? 16 : 8)
  const timescale = readUint32(bytes, timescaleAt)
  const duration =
    version === 1
      ? readUint32(bytes, timescaleAt + 4) * 2 ** 32 + readUint32(bytes, timescaleAt + 8)
      : readUint32(bytes, timescaleAt + 4)
  if (timescale === 0) throw new ContainerFault('a movie with no timescale')

  const frames = Math.max(
    0,
    ...boxes(bytes, moov.payload, moov.end)
      .filter((box) => box.type === 'trak')
      .map((trak) => sampleCount(bytes, trak)),
  )
  return { kind: 'animated', frames, milliseconds: Math.round((duration * 1000) / timescale) }
}

/** A track's sample count, from `stsz`, or nought when the track does not state one. */
function sampleCount(bytes: Uint8Array, trak: IsoBox): number {
  let box: IsoBox | undefined = trak
  for (const step of SAMPLE_TABLE_PATH.slice(1))
    box = box === undefined ? undefined : child(bytes, box, step)
  const stsz = box === undefined ? undefined : child(bytes, box, 'stsz')
  return stsz === undefined ? 0 : readUint32(bytes, stsz.payload + FULL_BOX + 4)
}

// ---------------------------------------------------------------------------
// Bounded in the file
// ---------------------------------------------------------------------------

/**
 * How many times a stored animation plays when nothing else stops it
 * (ADR-047, "Bounded in the file too"): the reader's enhancer cuts it shorter
 * and rests it on its poster still, but a page with scripts off, or the image
 * opened on its own, has only the file's own count to go by.
 */
export const MAX_PLAYS = 3

/** An animation with a finite play count written into it, and that count. */
export interface BoundedLoops {
  /** The same bytes when the file already stopped soon enough; otherwise a copy. */
  readonly bytes: Uint8Array
  readonly plays: number
}

/**
 * The animation with its play count at most `MAX_PLAYS`, written in the
 * format's own field, or undefined for a picture that does not move or a
 * format whose count waits for the image pipeline (WebP's `ANIM`, an AVIF
 * sequence's repetitions). A byte-level edit: no frame is decoded or
 * re-encoded, so what is stored stays the file that was uploaded, metadata
 * still stripped, with one number changed.
 */
export function boundLoops(type: ImageMediaType, bytes: Uint8Array): BoundedLoops | undefined {
  if (type === 'image/png') return boundPngLoops(bytes)
  if (type !== 'image/gif' || gifAnimation(bytes).kind === 'still') return undefined
  return boundGifLoops(bytes)
}

const GIF_APPLICATION = 0xff
/** The loop extension's identifiers: Netscape's, and the alias some encoders wrote. */
const GIF_LOOP_IDENTIFIERS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0'])
/** In a loop extension: past the introducer, the label and the identifier's block, its data block. */
const GIF_LOOP_DATA = 14
/** The loop data block's size and its sub-block id, which says "this is a loop count". */
const GIF_LOOP_BLOCK = [3, 1] as const

/**
 * A GIF's loop count is of repeats after the first play — Chromium, Gecko
 * and WebKit all read it so — and nought means forever. A GIF with no loop
 * extension plays once in some browsers and forever in others, so it is
 * given one, and the meaning is stated rather than left to the browser.
 */
function gifLoopExtension(repeats: number): Uint8Array {
  return Uint8Array.of(
    GIF_EXTENSION,
    GIF_APPLICATION,
    11,
    ...new TextEncoder().encode('NETSCAPE2.0'),
    ...GIF_LOOP_BLOCK,
    repeats & 0xff,
    repeats >> 8,
    0,
  )
}

/** Where a GIF's loop extension keeps its count, if it has one. */
function gifLoopCountAt(bytes: Uint8Array): number | undefined {
  for (const block of gifBlocks(bytes)) {
    if (block.label !== GIF_APPLICATION) continue
    const data = block.start + GIF_LOOP_DATA
    if (
      bytes[block.start + 2] === 11 &&
      GIF_LOOP_IDENTIFIERS.has(ascii(bytes, block.start + 3, data)) &&
      bytes[data] === GIF_LOOP_BLOCK[0] &&
      bytes[data + 1] === GIF_LOOP_BLOCK[1]
    ) {
      return data + 2
    }
  }
  return undefined
}

function boundGifLoops(bytes: Uint8Array): BoundedLoops {
  const repeats = MAX_PLAYS - 1
  const at = gifLoopCountAt(bytes)
  if (at === undefined) {
    const head = gifHead(bytes)
    return {
      bytes: concatChunks([
        bytes.subarray(0, head),
        gifLoopExtension(repeats),
        bytes.subarray(head),
      ]),
      plays: MAX_PLAYS,
    }
  }
  const stated = readUint16LittleEndian(bytes, at)
  if (stated !== 0 && stated < MAX_PLAYS) return { bytes, plays: stated + 1 }
  const bounded = Uint8Array.from(bytes)
  bounded.set([repeats & 0xff, repeats >> 8], at)
  return { bytes: bounded, plays: MAX_PLAYS }
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
}

/** In `acTL`'s data: the frame count, then the play count, where nought means forever. */
const ACTL_PLAYS = 4

/** Where a PNG's chunk of a type starts, if it has one. */
function pngChunkAt(bytes: Uint8Array, wanted: string): number | undefined {
  for (let offset = PNG_SIGNATURE; offset + 8 <= bytes.length;) {
    if (ascii(bytes, offset + 4, offset + 8) === wanted) return offset
    offset += PNG_CHUNK_OVERHEAD + readUint32(bytes, offset)
  }
  return undefined
}

function boundPngLoops(bytes: Uint8Array): BoundedLoops | undefined {
  const at = pngChunkAt(bytes, 'acTL')
  if (at === undefined) return undefined
  const plays = readUint32(bytes, at + 8 + ACTL_PLAYS)
  if (plays !== 0 && plays <= MAX_PLAYS) return { bytes, plays }
  const bounded = Uint8Array.from(bytes)
  const view = new DataView(bounded.buffer)
  view.setUint32(at + 8 + ACTL_PLAYS, MAX_PLAYS)
  // The CRC covers the chunk's type and data: twelve bytes for `acTL`.
  view.setUint32(at + 16, crc32(bounded.subarray(at + 4, at + 16)))
  return { bytes: bounded, plays: MAX_PLAYS }
}
