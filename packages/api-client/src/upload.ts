import type { ApiClient } from './index.ts'
import type { components } from './schema.gen.d.ts'

/**
 * Uploading a file: the one request that is not a JSON body.
 *
 * It lives in its own module, reached as `@quill/api-client/upload`, rather
 * than in this package's main one. Everything the main module exports is in the
 * chunk every route of the web application loads, and only the editor uploads
 * anything; the reading route has a byte budget (quill-plan.md section 31) and
 * no use for this. The split is what keeps it out.
 */

/** The one multipart body every upload shares: a single field called `file`. */
function multipartFile(file: Blob, filename?: string): FormData {
  const form = new FormData()
  if (filename === undefined) {
    form.append('file', file)
  } else {
    form.append('file', file, filename)
  }
  return form
}

export type Attachment = components['schemas']['Attachment']

export interface UploadAttachmentOptions {
  /** The document the file belongs to; its id, its short key, or a readable reference (ADR-035). */
  readonly documentId: string
  readonly file: Blob
  /** What to call it on the server. A `File` brings its own name; a `Blob` does not. */
  readonly filename: string
}

/**
 * The bytes travel as `multipart/form-data` in a field called `file`, which is
 * what the route reads.
 *
 * OpenAPI spells a binary field `type: string`, so the generated body type is a
 * string; the real bytes go into the `FormData` the serialiser below builds,
 * and the placeholder exists only because `openapi-fetch` calls a serialiser
 * for a body it has been given. Nothing casts, and nothing but this function
 * has to know.
 */
export async function uploadAttachment(
  client: ApiClient,
  options: UploadAttachmentOptions,
): Promise<{ data?: Attachment; error?: unknown; response: Response }> {
  return client.POST('/api/documents/{id}/attachments', {
    params: { path: { id: options.documentId } },
    body: { file: '' },
    bodySerializer: () => multipartFile(options.file, options.filename),
  })
}

export interface ReviseAttachmentOptions {
  readonly attachmentId: string
  /** The version the new bytes were made from; a newer one answers `409` (ADR-043). */
  readonly expectedVersion: number
  readonly file: Blob
  readonly filename: string
}

/**
 * A new revision of an attachment, under the same id and address (ADR-043):
 * the same multipart field as an upload, with the version it replaces.
 */
export async function reviseAttachment(
  client: ApiClient,
  options: ReviseAttachmentOptions,
): Promise<{ data?: Attachment; error?: unknown; response: Response }> {
  return client.PUT('/api/attachments/{id}', {
    params: {
      path: { id: options.attachmentId },
      query: { expectedVersion: options.expectedVersion },
    },
    body: { file: '' },
    bodySerializer: () => multipartFile(options.file, options.filename),
  })
}

export type EmojiImage = components['schemas']['EmojiImage']

/**
 * An organisation's emoji image (ADR-038), the same way: one file in a
 * multipart field called `file`. The answer is the image's hash, which the
 * settings screen saves under a name; the upload alone publishes nothing.
 */
export async function uploadEmojiImage(
  client: ApiClient,
  file: Blob,
): Promise<{ data?: EmojiImage; error?: unknown; response: Response }> {
  return client.POST('/api/settings/organisation/emoji-images', {
    body: { file: '' },
    bodySerializer: () => multipartFile(file),
  })
}
