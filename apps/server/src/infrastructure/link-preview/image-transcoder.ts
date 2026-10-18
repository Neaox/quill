/**
 * Re-encoding an untrusted image (ADR-042 "Images are ours or nothing",
 * ADR-047 "Codecs, run safely").
 *
 * A thumbnail from someone else's page is never served as received. It is
 * decoded, resized and encoded again, which is what makes the bytes ours: no
 * metadata (EXIF location, embedded profiles), no polyglot payload, no
 * format surprises, and one predictable output type. The decoding itself is the
 * dangerous part, so it sits behind this port and runs in a child process
 * (`isolated-transcoder.ts`); a codec bug costs one job, not the server.
 *
 * Port: the boundary is a native codec in another process, and tests supply a
 * fake or the in-process adapter.
 */

export interface ImageSpec {
  /** The longest the output may be in each direction. Never upscaled; aspect ratio kept. */
  readonly maxWidth: number
  readonly maxHeight: number
}

/** A link card shows its image at most 320 CSS pixels wide; 640 covers a dense display. */
export const THUMBNAIL_SPEC: ImageSpec = { maxWidth: 640, maxHeight: 640 }

/** A favicon is drawn at 16 to 32 CSS pixels; 64 covers a dense display. */
export const FAVICON_SPEC: ImageSpec = { maxWidth: 64, maxHeight: 64 }

export interface TranscodedImage {
  readonly bytes: Uint8Array
  readonly mediaType: 'image/webp'
  readonly width: number
  readonly height: number
}

export interface ImageTranscoder {
  /** Rejects with `ImageTranscodeError` for an image it cannot or will not process. */
  transcode(bytes: Uint8Array, spec: ImageSpec): Promise<TranscodedImage>
}

export type ImageTranscodeFailure =
  /** Not decodable, or decodable but refused: too many pixels, too many frames. */
  | 'invalid_image'
  | 'timeout'
  /** The codec process died. */
  | 'crashed'

export class ImageTranscodeError extends Error {
  readonly reason: ImageTranscodeFailure

  constructor(reason: ImageTranscodeFailure, message: string) {
    super(message)
    this.name = 'ImageTranscodeError'
    this.reason = reason
  }
}
