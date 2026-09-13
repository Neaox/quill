import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useAttachments, useDeleteAttachment, useUploadAttachment } from './attachments.ts'
import { ApiError } from './errors.ts'
import { createHookWrapper } from './hook-wrapper.tsx'
import { errorResponse, jsonResponse } from './testing.ts'

/**
 * The one request in the application that is not a JSON body. What is worth
 * holding here is that the file really travels as `multipart/form-data` in a
 * field called `file` — which is what the route reads — and that a refusal
 * arrives as an `ApiError` carrying the server's own code, because the dialog
 * shows that message rather than one of its own.
 */

const ATTACHMENT = {
  id: 'attachment-1',
  documentId: 'doc-1',
  url: '/api/attachments/attachment-1',
  filename: 'diagram.png',
  contentType: 'image/png',
  size: 12,
  sha256: 'a'.repeat(64),
  uploadedBy: 'user-1',
  createdAt: '2026-02-03T00:00:00.000Z',
}

function pngFile(name = 'diagram.png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' })
}

describe('useUploadAttachment', () => {
  it('sends the file as multipart, in a field called file', async () => {
    let contentType: string | null = null
    let body = ''
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/attachments': async (request) => {
        contentType = request.headers.get('content-type')
        // The raw body rather than `formData()`: what is worth asserting is
        // the wire format the route's parser will meet, and jsdom's `Request`
        // does not implement multipart parsing anyway.
        body = await request.text()
        return jsonResponse(201, ATTACHMENT)
      },
    })
    const { result } = renderHook(() => useUploadAttachment(), { wrapper })

    result.current.mutate({ documentId: 'doc-1', file: pngFile() })

    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })
    expect(result.current.data).toEqual(ATTACHMENT)
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/u)
    expect(body).toContain('name="file"')
    expect(body).toContain('Content-Type: image/png')
    // The filename is not asserted here: jsdom's `File` is not the one the
    // fetch implementation under it builds multipart bodies from, so the name
    // does not survive the crossing in this environment. That it does reach
    // the server, and becomes the attachment's filename, is held by
    // `apps/server/src/routes/attachments.integration.test.ts`.
  })

  it('raises the refusal from the server with its own code and message', async () => {
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/attachments': () =>
        errorResponse(422, 'file_type_not_allowed', 'SVG files are not accepted', {
          sniffed: 'image/svg+xml',
        }),
    })
    const { result } = renderHook(() => useUploadAttachment(), { wrapper })

    result.current.mutate({ documentId: 'doc-1', file: pngFile('logo.png') })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    const error = result.current.error
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(422)
    expect((error as ApiError).code).toBe('file_type_not_allowed')
    expect((error as ApiError).details).toEqual({ sniffed: 'image/svg+xml' })
  })

  it('raises a file past the cap as a 413 the dialog can explain', async () => {
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/attachments': () =>
        errorResponse(413, 'payload_too_large', 'That file is larger than the 25 MB limit', {
          maxBytes: 26_214_400,
        }),
    })
    const { result } = renderHook(() => useUploadAttachment(), { wrapper })

    result.current.mutate({ documentId: 'doc-1', file: pngFile() })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect((result.current.error as ApiError).status).toBe(413)
  })
})

describe('useAttachments', () => {
  it('lists what a document carries', async () => {
    const wrapper = createHookWrapper({
      'GET /api/documents/{id}/attachments': () => jsonResponse(200, { attachments: [ATTACHMENT] }),
    })
    const { result } = renderHook(() => useAttachments('doc-1'), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toEqual([ATTACHMENT])
  })
})

describe('useDeleteAttachment', () => {
  it('takes one down', async () => {
    const wrapper = createHookWrapper({
      'DELETE /api/attachments/{id}': () => new Response(null, { status: 204 }),
    })
    const { result } = renderHook(() => useDeleteAttachment(), { wrapper })

    result.current.mutate({ attachmentId: 'attachment-1', documentId: 'doc-1' })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
  })

  it('raises the refusal when a published document still shows it', async () => {
    const wrapper = createHookWrapper({
      'DELETE /api/attachments/{id}': () =>
        errorResponse(409, 'attachment_in_use', 'A published document still shows this file.', {
          documents: ['doc-2'],
        }),
    })
    const { result } = renderHook(() => useDeleteAttachment(), { wrapper })

    result.current.mutate({ attachmentId: 'attachment-1', documentId: 'doc-1' })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    const error = result.current.error
    expect((error as ApiError).code).toBe('attachment_in_use')
    expect((error as ApiError).details).toEqual({ documents: ['doc-2'] })
  })
})
