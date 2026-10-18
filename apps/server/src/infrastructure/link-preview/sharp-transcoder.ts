import sharp from 'sharp'

import { ImageTranscodeError } from './image-transcoder.ts'
import type { ImageSpec, ImageTranscoder, TranscodedImage } from './image-transcoder.ts'

/**
 * The in-process codec: sharp (libvips), as ADR-047 chose.
 *
 * Use it through `isolated-transcoder.ts` for anything untrusted. It is its own
 * module so that the worker process, and tests, can run exactly what the
 * server runs, minus the process boundary.
 *
 * What it guards against, beyond what libvips already does:
 * - **Pixel bombs.** A small file can declare a gigantic canvas, which is a
 *   memory attack. `limitInputPixels` is checked from the header before any
 *   pixel is decoded.
 * - **Animation.** Only the first frame is read (sharp's default), so an
 *   animated GIF becomes a still and cannot cost a frame-by-frame decode.
 * - **Metadata.** Nothing is copied through: sharp drops EXIF, ICC and XMP
 *   unless asked to keep them, and that default is the point.
 *
 * The output is always WebP: smaller than PNG or JPEG for the same picture,
 * supported by every browser Quill targets, and with alpha for logos.
 */

/** About 24 megapixels, past any real thumbnail and well under what a bomb needs. */
export const DEFAULT_MAX_INPUT_PIXELS = 24_000_000

const WEBP_QUALITY = 80

// One image at a time, nothing retained between jobs: the process is
// short-lived, and libvips' operation cache would only hold memory.
sharp.cache(false)
sharp.concurrency(1)

export interface SharpTranscoderOptions {
  readonly maxInputPixels?: number
}

export function createSharpTranscoder(options: SharpTranscoderOptions = {}): ImageTranscoder {
  const limitInputPixels = options.maxInputPixels ?? DEFAULT_MAX_INPUT_PIXELS

  return {
    async transcode(bytes: Uint8Array, spec: ImageSpec): Promise<TranscodedImage> {
      try {
        const { data, info } = await sharp(bytes, { limitInputPixels, failOn: 'error' })
          // Apply the EXIF orientation to the pixels before the metadata that carried it is dropped.
          .rotate()
          .resize({
            width: spec.maxWidth,
            height: spec.maxHeight,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer({ resolveWithObject: true })
        return {
          bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
          mediaType: 'image/webp',
          width: info.width,
          height: info.height,
        }
      } catch (error) {
        throw new ImageTranscodeError(
          'invalid_image',
          `The image could not be processed: ${String(error)}`,
        )
      }
    },
  }
}
