import type { ApiClient } from '@quill/api-client'
import type { Attachment } from '@quill/api-client/upload'
import { describe, expect, it, vi } from 'vitest'

import { declared } from '../../../lib/api/attachments.ts'
import { createDiagramStore, isDiagramAttachment } from './diagram-store.ts'
import { createDrawioFiles } from './drawio-files.ts'
import { interfaceLanguage } from './use-drawio.tsx'

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'a1',
    documentId: 'd1',
    url: '/api/attachments/a1',
    filename: 'flow.drawio.svg',
    contentType: 'image/svg+xml',
    size: 10,
    sha256: 'a'.repeat(64),
    version: 2,
    uploadedBy: null,
    createdAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  }
}

describe('the document’s diagrams', () => {
  it('are its .drawio.svg attachments, and nothing is offered until there is an editor', () => {
    const store = createDiagramStore()
    const listener = vi.fn<() => void>()
    const unsubscribe = store.subscribe(listener)
    store.replace([
      attachment(),
      attachment({
        id: 'p',
        url: '/api/attachments/p',
        filename: 'photo.png',
        contentType: 'image/png',
      }),
    ])

    expect(store.isDiagram('/api/attachments/a1')).toBe(false)
    store.enable(true)
    store.enable(true)
    expect(store.enabled()).toBe(true)
    expect(store.isDiagram('/api/attachments/a1')).toBe(true)
    expect(store.isDiagram('/api/attachments/p')).toBe(false)
    expect(store.find('/api/attachments/a1')).toEqual({
      attachmentId: 'a1',
      url: '/api/attachments/a1',
      version: 2,
    })
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    store.enable(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('draws a diagram saved here fresh, and an older list does not take the save back', () => {
    const store = createDiagramStore()
    store.enable(true)
    expect(store.displaySrc('/api/attachments/a1')).toBe('/api/attachments/a1')

    store.saved({ attachmentId: 'a1', url: '/api/attachments/a1', version: 3 })
    expect(store.displaySrc('/api/attachments/a1')).toBe('/api/attachments/a1?v=3')

    store.replace([attachment({ version: 2 })])
    expect(store.find('/api/attachments/a1')?.version).toBe(3)
    store.replace([attachment({ version: 4 })])
    expect(store.find('/api/attachments/a1')?.version).toBe(4)
  })

  it('knows a diagram by its type and its name', () => {
    expect(isDiagramAttachment(attachment())).toBe(true)
    expect(isDiagramAttachment(attachment({ filename: 'flow.svg' }))).toBe(false)
    expect(
      isDiagramAttachment(
        attachment({ contentType: 'application/vnd.jgraph.mxfile', filename: 'flow.drawio' }),
      ),
    ).toBe(false)
  })
})

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function files(answer: Response, fetchFile = vi.fn<typeof fetch>()) {
  const send = vi.fn<() => Promise<unknown>>(async () => ({
    data: answer.ok ? await answer.clone().json() : undefined,
    error: answer.ok ? undefined : await answer.clone().json(),
    response: answer,
  }))
  const client = { POST: send, PUT: send } as unknown as ApiClient
  const onWritten = vi.fn<() => void>()
  return {
    send,
    onWritten,
    files: createDrawioFiles({
      client,
      documentId: 'd1',
      versionOf: async () => 7,
      onWritten,
      fetch: fetchFile,
    }),
  }
}

describe('createDrawioFiles', () => {
  const DIAGRAM = { attachmentId: 'a1', url: '/api/attachments/a1', version: 2 }

  it('reads the newest file, fresh, with the version the list gives', async () => {
    const fetchFile = vi.fn<typeof fetch>(async () => new Response('<svg/>'))
    const { files: drawio } = files(response(200, {}), fetchFile)
    expect(await drawio.read(DIAGRAM)).toEqual({ file: '<svg/>', version: 7 })
    expect(fetchFile).toHaveBeenCalledWith('/api/attachments/a1', {
      cache: 'no-cache',
      credentials: 'same-origin',
    })

    const missing = files(
      response(200, {}),
      vi.fn<typeof fetch>(async () => new Response('', { status: 404 })),
    )
    await expect(missing.files.read(DIAGRAM)).rejects.toThrow('could not be read (404)')
  })

  it('creates a new diagram as an SVG upload', async () => {
    const {
      files: drawio,
      send,
      onWritten,
    } = files(response(201, attachment({ id: 'n', url: '/api/attachments/n', version: 1 })))
    expect(await drawio.create('<svg/>', 'flow.drawio.svg')).toEqual({
      attachmentId: 'n',
      url: '/api/attachments/n',
      version: 1,
    })
    expect(send).toHaveBeenCalledWith('/api/documents/{id}/attachments', expect.anything())
    expect(onWritten).toHaveBeenCalled()
  })

  it('revises in place, naming the version opened', async () => {
    const { files: drawio, send } = files(response(200, attachment({ version: 3 })))
    expect(await drawio.revise(DIAGRAM, '<svg/>')).toEqual({
      kind: 'revised',
      diagram: { attachmentId: 'a1', url: '/api/attachments/a1', version: 3 },
    })
    expect(send).toHaveBeenCalledWith(
      '/api/attachments/{id}',
      expect.objectContaining({
        params: { path: { id: 'a1' }, query: { expectedVersion: 2 } },
      }),
    )
  })

  it('answers a newer revision as a conflict, naming it', async () => {
    const conflict = response(409, {
      error: {
        code: 'attachment_version_conflict',
        message: 'Newer',
        details: { current: attachment({ version: 5 }) },
      },
    })
    expect(await files(conflict).files.revise(DIAGRAM, '<svg/>')).toEqual({
      kind: 'conflict',
      currentVersion: 5,
    })
  })

  it('throws what it cannot read as a conflict, and every other failure', async () => {
    const odd = response(409, {
      error: { code: 'x', message: 'Odd', details: { current: 'nope' } },
    })
    await expect(files(odd).files.revise(DIAGRAM, '<svg/>')).rejects.toThrow('Odd')
    const none = response(409, { error: { code: 'x', message: 'None' } })
    await expect(files(none).files.revise(DIAGRAM, '<svg/>')).rejects.toThrow('None')
    const noVersion = response(409, {
      error: { code: 'x', message: 'Bare', details: { current: {} } },
    })
    await expect(files(noVersion).files.revise(DIAGRAM, '<svg/>')).rejects.toThrow('Bare')
    const refused = response(422, { error: { code: 'file_empty', message: 'Empty' } })
    await expect(files(refused).files.revise(DIAGRAM, '<svg/>')).rejects.toThrow('Empty')
    await expect(files(refused).files.create('<svg/>', 'x.drawio.svg')).rejects.toThrow('Empty')
  })
})

describe('declared', () => {
  it('types a raw .drawio the browser could not, and leaves every other file alone', () => {
    const raw = new File(['<mxfile/>'], 'flow.drawio')
    expect(declared(raw).type).toBe('application/vnd.jgraph.mxfile')
    const png = new File(['x'], 'photo.png', { type: 'image/png' })
    expect(declared(png)).toBe(png)
    const unknown = new File(['x'], 'notes.txt')
    expect(declared(unknown)).toBe(unknown)
  })
})

describe('the language draw.io is asked to speak', () => {
  it('is the page’s own, which is the language the application speaks', () => {
    const root = document.createElement('html')
    root.lang = 'de-DE'
    expect(interfaceLanguage(root)).toBe('de-DE')
  })

  it('is left to draw.io when the page does not say', () => {
    expect(interfaceLanguage(document.createElement('html'))).toBeUndefined()
  })
})
