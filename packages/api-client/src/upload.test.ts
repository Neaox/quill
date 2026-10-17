import { describe, expect, it } from 'vitest'

import { createApiClient } from './index.ts'
import { reviseAttachment, uploadAttachment, uploadEmojiImage } from './upload.ts'

/** What the fake server saw: the request, with its multipart body read back. */
interface Seen {
  readonly method: string
  readonly url: string
  readonly file: File
}

/** A client whose `fetch` records the request and answers `201` with the given JSON. */
function recordingClient(answer: unknown) {
  const seen: Seen[] = []
  const client = createApiClient({
    baseUrl: 'http://quill.test',
    fetch: async (input) => {
      if (!(input instanceof Request)) throw new Error('openapi-fetch hands fetch a Request')
      const request = input
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) throw new Error('the body had no file field')
      seen.push({ method: request.method, url: request.url, file })
      return Response.json(answer, { status: 201 })
    },
  })
  return { client, seen }
}

describe('uploadAttachment', () => {
  it('sends the file as a multipart field called file, under its filename', async () => {
    const { client, seen } = recordingClient({ id: 'att-1' })

    const result = await uploadAttachment(client, {
      documentId: 'doc-1',
      file: new Blob(['hello'], { type: 'text/plain' }),
      filename: 'notes.txt',
    })

    expect(result.response.status).toBe(201)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.url).toBe('http://quill.test/api/documents/doc-1/attachments')
    expect(seen[0]?.file.name).toBe('notes.txt')
    expect(await seen[0]?.file.text()).toBe('hello')
  })
})

describe('reviseAttachment', () => {
  it('puts the new bytes at the attachment with the version they were made from', async () => {
    const { client, seen } = recordingClient({ id: 'att-1' })

    await reviseAttachment(client, {
      attachmentId: 'att-1',
      expectedVersion: 3,
      file: new Blob(['v4']),
      filename: 'notes.txt',
    })

    expect(seen[0]?.method).toBe('PUT')
    expect(seen[0]?.url).toBe('http://quill.test/api/attachments/att-1?expectedVersion=3')
    expect(await seen[0]?.file.text()).toBe('v4')
  })
})

describe('uploadEmojiImage', () => {
  it('posts the image to the organisation emoji images', async () => {
    const { client, seen } = recordingClient({ hash: 'abc' })

    const result = await uploadEmojiImage(client, new Blob(['png-bytes']))

    expect(result.response.status).toBe(201)
    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.url).toBe('http://quill.test/api/settings/organisation/emoji-images')
    expect(await seen[0]?.file.text()).toBe('png-bytes')
  })
})
