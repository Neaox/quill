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
    bodySerializer: () => {
      const form = new FormData()
      form.append('file', options.file, options.filename)
      return form
    },
  })
}
