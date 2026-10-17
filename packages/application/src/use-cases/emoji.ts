import type { BlobStore } from '../ports/blob-store.ts'
import { concatChunks, readBlob } from '../ports/blob-store.ts'
import type { Settings } from '../ports/settings.ts'
import type { EmojiMediaType } from '../settings/emoji.ts'
import {
  EMOJI_MEDIA_TYPES,
  emojiForFile,
  MAX_EMOJI_BYTES,
  MAX_EMOJI_FRAMES,
  MAX_EMOJI_MILLISECONDS,
} from '../settings/emoji.ts'
import { animationOf, boundLoops, type Animation } from './animation.ts'
import { ContainerFault } from './image-container.ts'
import { MalformedImage, stripImageMetadata } from './image-metadata.ts'
import { normaliseMediaType, sniffMediaType } from './media-types.ts'

/**
 * The organisation's emoji images (ADR-038): storing one, and serving one.
 *
 * An image is stored before it is named: the settings screen uploads the
 * file, gets its hash back, and saves the hash in the organisation's settings
 * with the name, through the same compare-and-swap every other setting goes
 * through (ADR-034). An image no saved setting names is never served, so an
 * upload on its own publishes nothing.
 */

export interface EmojiImageDependencies {
  readonly blobStore: BlobStore
}

export interface UploadEmojiImageCommand {
  readonly declaredContentType: string
  readonly body: AsyncIterable<Uint8Array>
}

export type UploadEmojiImageResult =
  | {
      readonly kind: 'uploaded'
      readonly hash: string
      readonly mediaType: EmojiMediaType
      /** An animation's first frame, stored as a picture of its own (`animation.ts`). */
      readonly still?: string
      /** An animation's frames and the length of one loop, read at upload (ADR-047). */
      readonly frames?: number
      readonly milliseconds?: number
      /**
       * How many times the stored file plays, written into it (ADR-047,
       * "Bounded in the file too"). `hash` is then that bounded copy.
       */
      readonly plays?: number
      /** The upload as it came, metadata stripped, when the stored copy had its play count changed. */
      readonly original?: string
    }
  | { readonly kind: 'empty' }
  | { readonly kind: 'too-large'; readonly maxBytes: number }
  | { readonly kind: 'type-not-allowed'; readonly sniffed: string | null }
  | { readonly kind: 'type-mismatch'; readonly declared: string; readonly sniffed: string }
  | { readonly kind: 'malformed'; readonly reason: string }
  | {
      readonly kind: 'animation-over-limits'
      readonly frames: number
      readonly milliseconds: number
      readonly maxFrames: number
      readonly maxMilliseconds: number
    }

function isEmojiMediaType(type: string | null): type is EmojiMediaType {
  return EMOJI_MEDIA_TYPES.some((allowed) => allowed === type)
}

/** Every byte, or undefined as soon as there are more than an emoji may have. */
async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array | undefined> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of body) {
    size += chunk.length
    if (size > MAX_EMOJI_BYTES) return undefined
    chunks.push(chunk)
  }
  return concatChunks(chunks)
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes
}

/**
 * Stores an emoji's image, decided by its bytes rather than by what the
 * browser said (ADR-011). A raster loses its metadata on the way in, as an
 * attachment does. An SVG is stored as it came: it is only ever shown as
 * `<img>`, where it runs nothing, and it is served behind a sandboxing policy
 * for anybody who opens its address directly.
 *
 * An animation is held to ADR-047's limits — frames and running time — and
 * stored with a still of its first frame beside it where one can be cut
 * without a codec (GIF, APNG), so a reader who has asked for less motion is
 * shown that instead. Its frames and loop length are answered, for the
 * reader's enhancer to time a brief play by, and a GIF or APNG is served as a
 * copy whose own play count stops it (`boundLoops`), with the upload kept
 * beside it untouched. An animated WebP or AVIF is stored as it is; its still
 * and its bound are ADR-047's image pipeline's to derive.
 */
export async function uploadEmojiImage(
  deps: EmojiImageDependencies,
  command: UploadEmojiImageCommand,
): Promise<UploadEmojiImageResult> {
  const bytes = await collect(command.body)
  if (bytes === undefined) return { kind: 'too-large', maxBytes: MAX_EMOJI_BYTES }
  if (bytes.length === 0) return { kind: 'empty' }

  const sniffed = sniffMediaType(bytes)
  if (!isEmojiMediaType(sniffed)) return { kind: 'type-not-allowed', sniffed }
  const declared = normaliseMediaType(command.declaredContentType)
  if (declared !== sniffed) return { kind: 'type-mismatch', declared, sniffed }

  if (sniffed === 'image/svg+xml') {
    const stored = await deps.blobStore.put(once(bytes), sniffed)
    return { kind: 'uploaded', hash: stored.hash, mediaType: sniffed }
  }

  let kept: Uint8Array
  let animation: Animation
  try {
    kept = await collectAll(stripImageMetadata(sniffed, once(bytes)))
    animation = animationOf(sniffed, kept)
  } catch (error) {
    if (error instanceof MalformedImage) return { kind: 'malformed', reason: error.reason }
    /* v8 ignore else -- the rethrow below says why. */
    if (error instanceof ContainerFault) return { kind: 'malformed', reason: error.message }
    /* v8 ignore next -- the walkers throw only the two faults above; anything else is a bug and must surface. */
    throw error
  }
  if (animation.kind === 'animated') {
    if (sniffed === 'image/avif' && kept.length !== bytes.length) {
      // An image sequence's frames are found by offsets the item-level
      // stripping does not restate, so one it changed would no longer play.
      return {
        kind: 'malformed',
        reason:
          'an image sequence carrying metadata, which cannot be removed without re-encoding it',
      }
    }
    if (animation.frames > MAX_EMOJI_FRAMES || animation.milliseconds > MAX_EMOJI_MILLISECONDS) {
      return {
        kind: 'animation-over-limits',
        frames: animation.frames,
        milliseconds: animation.milliseconds,
        maxFrames: MAX_EMOJI_FRAMES,
        maxMilliseconds: MAX_EMOJI_MILLISECONDS,
      }
    }
  }

  if (animation.kind === 'still') {
    const stored = await deps.blobStore.put(once(kept), sniffed)
    return { kind: 'uploaded', hash: stored.hash, mediaType: sniffed }
  }
  // The upload is kept as it came; what is served is the copy that stops.
  const bounded = boundLoops(sniffed, kept)
  const original = await deps.blobStore.put(once(kept), sniffed)
  const served =
    bounded === undefined || bounded.bytes === kept
      ? original
      : await deps.blobStore.put(once(bounded.bytes), sniffed)
  const still =
    animation.still === undefined
      ? undefined
      : await deps.blobStore.put(once(animation.still), sniffed)
  return {
    kind: 'uploaded',
    hash: served.hash,
    mediaType: sniffed,
    ...(still === undefined ? {} : { still: still.hash }),
    frames: animation.frames,
    milliseconds: animation.milliseconds,
    ...(bounded === undefined ? {} : { plays: bounded.plays }),
    ...(served === original ? {} : { original: original.hash }),
  }
}

/** Every byte a stream yields, which for an emoji is never more than the cap. */
async function collectAll(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const all: Uint8Array[] = []
  for await (const chunk of chunks) all.push(chunk)
  return concatChunks(all)
}

export interface ServedEmojiImage {
  readonly mediaType: EmojiMediaType
  readonly bytes: Uint8Array
}

/**
 * The image a served file name names, or null. Only an emoji the
 * organisation's settings list is served: the blob store is shared with
 * attachments, and a hash alone must never be a way to read one.
 */
export async function readEmojiImage(
  deps: EmojiImageDependencies & { readonly settings: Settings },
  file: string,
): Promise<ServedEmojiImage | null> {
  const read = await deps.settings.readOrganisation()
  const image = read.kind === 'settings' ? emojiForFile(read.document.emoji, file) : undefined
  if (image === undefined) return null
  const bytes = await readBlob(deps.blobStore, image.hash)
  return bytes === null ? null : { mediaType: image.mediaType, bytes }
}
