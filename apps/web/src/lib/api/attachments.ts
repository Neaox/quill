import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { uploadAttachment } from '@quill/api-client/upload'
import type { Attachment } from '@quill/api-client/upload'

import { useApiClient } from './client-context.tsx'
import { toApiError } from './errors.ts'
import { queryKeys } from './query-keys.ts'
import { request } from './http.ts'

/**
 * Attachments: uploading one, listing what a document carries, taking one down.
 *
 * The upload goes through `@quill/api-client`'s own helper because it is the
 * one request with a `multipart/form-data` body; everything else here is an
 * ordinary call through the generated client.
 */

export type { Attachment } from '@quill/api-client/upload'

/**
 * The upload cap, so the dialog can refuse a file before sending it.
 *
 * A copy of the server's default (`ATTACHMENT_MAX_BYTES`), not the server's
 * own answer: the cap is process configuration and no endpoint publishes it.
 * That makes this a courtesy — it saves a person watching a 200 MB upload fail
 * — and never the rule. The server counts the bytes as they arrive and answers
 * `413`, which the dialog shows like any other refusal, so an instance that has
 * raised or lowered its cap is still correct here, only less helpful.
 */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

export interface UploadAttachmentInput {
  readonly documentId: string
  readonly file: File
}

/**
 * A file becomes an attachment, and the answer says where the document should
 * point at it.
 *
 * There is no progress percentage, by design: `fetch` reports none for a
 * request body, and `docs/design/feedback.md` asks for the spinner on the
 * control that was pressed rather than a bar. `isPending` is that spinner.
 */
export function useUploadAttachment() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ documentId, file }: UploadAttachmentInput): Promise<Attachment> => {
      const { data, error, response } = await uploadAttachment(client, {
        documentId,
        file,
        filename: file.name,
      })
      if (!response.ok || data === undefined) throw toApiError(response.status, error)
      return data
    },
    onSuccess: (_attachment, { documentId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.attachments(documentId) })
    },
  })
}

export function useAttachments(documentId: string) {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.attachments(documentId),
    queryFn: async (): Promise<readonly Attachment[]> => {
      const { attachments } = await request(
        client.GET('/api/documents/{id}/attachments', {
          params: { path: { id: documentId } },
        }),
      )
      return attachments
    },
  })
}

export interface DeleteAttachmentInput {
  readonly attachmentId: string
  /** Only so the list can be invalidated; the route takes the attachment alone. */
  readonly documentId: string
}

export function useDeleteAttachment() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ attachmentId }: DeleteAttachmentInput): Promise<void> => {
      const { error, response } = await client.DELETE('/api/attachments/{id}', {
        params: { path: { id: attachmentId } },
      })
      if (!response.ok) throw toApiError(response.status, error)
    },
    onSuccess: (_result, { documentId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.attachments(documentId) })
    },
  })
}
