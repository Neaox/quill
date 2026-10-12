import { useMutation } from '@tanstack/react-query'
import { uploadEmojiImage } from '@quill/api-client/upload'
import type { EmojiImage } from '@quill/api-client/upload'

import { useApiClient } from './client-context.tsx'
import { toApiError } from './errors.ts'

/**
 * Uploading an emoji image (ADR-038). Like `attachments.ts`, not re-exported
 * from the barrel: only the settings screen uploads one, and the upload client
 * stays out of the chunk every route loads.
 */

export type { EmojiImage } from '@quill/api-client/upload'

/** A copy of the server's cap, so the form can refuse a file before sending it. */
export const EMOJI_MAX_BYTES = 256 * 1024

/**
 * The image types an emoji may be, by the name a person knows each by, in the
 * order they are offered: the server's `EMOJI_MEDIA_TYPES`, which the
 * generated `EmojiImage` type holds this to.
 */
export const EMOJI_TYPE_NAMES = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'image/avif': 'AVIF',
  'image/svg+xml': 'SVG',
} as const satisfies Record<EmojiImage['mediaType'], string>

/** The same types, as a file picker's `accept`. */
export const EMOJI_ACCEPT = Object.keys(EMOJI_TYPE_NAMES).join(',')

/** ADR-047's animation limits, copied from the server's so the form can state them. */
export const EMOJI_MAX_FRAMES = 300
export const EMOJI_MAX_SECONDS = 10

/**
 * The image's bytes stored, answered with its hash. Nothing is published
 * until the settings that name it are saved.
 */
export function useUploadEmojiImage() {
  const client = useApiClient()
  return useMutation({
    mutationFn: async (file: File): Promise<EmojiImage> => {
      const { data, error, response } = await uploadEmojiImage(client, file)
      if (!response.ok || data === undefined) throw toApiError(response.status, error)
      return data
    },
  })
}
