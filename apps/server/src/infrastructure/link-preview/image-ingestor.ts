import type { BlobStore } from '@quill/application'
import type { PreviewImage } from '@quill/domain'

import { imageRequest } from '../http/open-web-client.ts'
import type { OpenWebReader, UrlPermit } from '../http/open-web-client.ts'
import { sniffImageType } from './image-sniff.ts'
import type { ImageSpec, ImageTranscoder } from './image-transcoder.ts'

/**
 * Takes a remote image and makes it ours (ADR-042, "Images are ours or
 * nothing"): fetch it once through the open-web client, confirm from its bytes
 * that it is a PNG, JPEG, WebP or GIF, re-encode and resize it, and store it
 * under its hash in the blob store.
 *
 * It answers `null` for every way this can go wrong, and says nothing more.
 * A preview whose image fails keeps its text (ADR-042), so there is exactly
 * one thing a caller can do with a failure and nothing to branch on.
 *
 * The same bytes always land on the same hash, so a thumbnail shared by a
 * hundred links is stored once, and a refresh that finds the same picture
 * stores nothing new.
 */

export interface ImageIngestor {
  /** `permit` is the organisation's policy, asked for this URL and any redirect it follows. */
  ingest(url: string, spec: ImageSpec, permit?: UrlPermit): Promise<PreviewImage | null>
}

export interface ImageIngestorDeps {
  readonly reader: OpenWebReader
  readonly transcoder: ImageTranscoder
  readonly blobs: BlobStore
}

async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes
}

export function createImageIngestor({
  reader,
  transcoder,
  blobs,
}: ImageIngestorDeps): ImageIngestor {
  return {
    async ingest(url, spec, permit) {
      try {
        const response = await reader.get({ ...imageRequest(url), permit })
        if (response.status < 200 || response.status > 299 || response.body.byteLength === 0)
          return null
        // The bytes decide what this is; the header and the extension only claimed.
        if (sniffImageType(response.body) === null) return null

        const image = await transcoder.transcode(response.body, spec)
        const stored = await blobs.put(once(image.bytes), image.mediaType)
        return {
          hash: stored.hash,
          width: image.width,
          height: image.height,
          mediaType: image.mediaType,
        }
      } catch {
        return null
      }
    },
  }
}
