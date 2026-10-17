import { describe, expect, it } from 'vitest'

import { createApiClient } from './index.ts'
import { reviseAttachment, uploadAttachment, uploadEmojiImage } from './upload.ts'

/** A client whose fetch records the request it was given and answers `201`. */
function recordingClient() {
  const requests: Request[] = []
  const client = createApiClient({
    baseUrl: 'http://quill.test',
    fetch: async (input) => {
      if (!(input instanceof Request)) throw new Error('openapi-fetch hands fetch a Request')
      requests.push(input)
      return Response.json({}, { status: 201 })
    },
  })
  const sent = (): Request => {
    const [request] = requests
    if (request === undefined) throw new Error('no request was sent')
    return request
  }
  return { client, sent }
}

async function sentFile(request: Request): Promise<File> {
  const file = (await request.formData()).get('file')
  if (!(file instanceof File)) throw new Error('the body carries no file field')
  return file
}

describe('uploadAttachment', () => {
  it('posts the file as multipart under the given name to the document', async () => {
    const { client, sent } = recordingClient()

    await uploadAttachment(client, {
      documentId: 'DOC-1',
      file: new Blob(['hello']),
      filename: 'greeting.txt',
    })

    const request = sent()
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api/documents/DOC-1/attachments')
    const file = await sentFile(request)
    expect(file.name).toBe('greeting.txt')
    expect(await file.text()).toBe('hello')
  })
})

describe('reviseAttachment', () => {
  it('puts the new bytes with the version they replace', async () => {
    const { client, sent } = recordingClient()

    await reviseAttachment(client, {
      attachmentId: 'ATT-1',
      expectedVersion: 3,
      file: new Blob(['v4']),
      filename: 'diagram.png',
    })

    const request = sent()
    expect(request.method).toBe('PUT')
    const url = new URL(request.url)
    expect(url.pathname).toBe('/api/attachments/ATT-1')
    expect(url.searchParams.get('expectedVersion')).toBe('3')
    const file = await sentFile(request)
    expect(file.name).toBe('diagram.png')
    expect(await file.text()).toBe('v4')
  })
})

describe('uploadEmojiImage', () => {
  it('posts the image to the organisation emoji endpoint', async () => {
    const { client, sent } = recordingClient()

    await uploadEmojiImage(client, new File(['png'], 'party.png'))

    const request = sent()
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api/settings/organisation/emoji-images')
    const file = await sentFile(request)
    expect(file.name).toBe('party.png')
    expect(await file.text()).toBe('png')
  })
})
