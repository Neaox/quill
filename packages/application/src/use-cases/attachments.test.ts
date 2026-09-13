import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, shortId, userId, workspaceId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import { readBlob } from '../ports/blob-store.ts'
import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { chunked, imageFixture, pngFile } from '../test-support/image-fixtures.ts'
import { createInMemoryBlobStore } from '../test-support/in-memory-blob-store.ts'
import type { InMemoryBlobStore } from '../test-support/in-memory-blob-store.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import {
  ATTACHMENT_AUDIT_EVENTS,
  attachmentUrl,
  deleteAttachment,
  getAttachment,
  listAttachments,
  safeFilename,
  uploadAttachment,
} from './attachments.ts'
import type { AttachmentDependencies } from './attachments.ts'
import { SNIFF_BYTES } from './media-types.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER_WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000102')
const DOCUMENT = documentId('00000000-0000-4000-8000-000000000201')
const OTHER_DOCUMENT = documentId('00000000-0000-4000-8000-000000000202')
const ACTOR = userId('00000000-0000-4000-8000-000000000001')
const MAX_BYTES = 1024 * 1024

/** A real, decodable PNG, as large as a test needs it to be. */
function png(width = 2, height = 2): Uint8Array {
  return pngFile({ width, height })
}

function pdf(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n')
}

function svg(): Uint8Array {
  return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
}

const streamed = chunked

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

let uow: InMemoryUnitOfWork
let blobStore: InMemoryBlobStore
let deps: AttachmentDependencies

async function seedDocument(id: DocumentId, key: string, workspace = WORKSPACE): Promise<void> {
  const created = await uow.repos.documents.createIfAvailable({
    id,
    shortId: shortId(key),
    workspaceId: workspace,
    collectionId: 'runbooks',
    parentId: null,
    slug: id,
    path: `engineering/runbooks/${id}`,
    title: 'A document',
    status: 'draft',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
  if (created.kind !== 'created') throw new Error(`could not seed ${id}: ${created.kind}`)
}

async function upload(
  overrides: Partial<Parameters<typeof uploadAttachment>[1]> = {},
): Promise<Awaited<ReturnType<typeof uploadAttachment>>> {
  return uploadAttachment(deps, {
    documentId: DOCUMENT,
    uploadedBy: ACTOR,
    filename: 'diagram.png',
    declaredContentType: 'image/png',
    body: streamed(png()),
    maxBytes: MAX_BYTES,
    ...overrides,
  })
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  blobStore = createInMemoryBlobStore()
  deps = { uow, blobStore, clock: createFakeClock(NOW), ids: createFakeIdGenerator() }
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await uow.repos.workspaces.create({
    id: OTHER_WORKSPACE,
    unitId: 'acme',
    name: 'Design',
    slug: 'design',
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'runbooks',
    workspaceId: WORKSPACE,
    name: 'Runbooks',
    slug: 'runbooks',
    now: NOW,
  })
  await seedDocument(DOCUMENT, 'aaaaaaaaab')
  await seedDocument(OTHER_DOCUMENT, 'aaaaaaaaac')
})

describe('uploadAttachment', () => {
  it('stores the bytes under their own hash and records the row', async () => {
    const file = png()
    const result = await upload({ body: streamed(file) })

    expect(result.kind).toBe('uploaded')
    if (result.kind !== 'uploaded') return
    expect(result.attachment).toMatchObject({
      documentId: DOCUMENT,
      workspaceId: WORKSPACE,
      uploadedBy: ACTOR,
      filename: 'diagram.png',
      contentType: 'image/png',
      size: file.length,
      sha256: sha256(file),
      deletedAt: null,
    })
    expect(result.url).toBe(attachmentUrl(result.attachment.id))
    expect(await readBlob(blobStore, result.attachment.sha256)).toStrictEqual(file)
  })

  it('tells the store what the bytes are, never what the request claimed', async () => {
    const seen: string[] = []
    const recording = {
      ...blobStore,
      put: async (chunks: AsyncIterable<Uint8Array>, contentType: string) => {
        seen.push(contentType)
        return blobStore.put(chunks, contentType)
      },
    }

    // A JPEG announced with a parameter and in the wrong case. What reaches
    // the store is the normalised type the sniffer decided on, because the
    // decision is made before a byte is handed over.
    await uploadAttachment(
      { ...deps, blobStore: recording },
      {
        documentId: DOCUMENT,
        uploadedBy: ACTOR,
        filename: 'photo.jpeg',
        declaredContentType: 'IMAGE/JPEG; charset=binary',
        body: streamed(imageFixture('exif.jpg')),
        maxBytes: MAX_BYTES,
      },
    )

    expect(seen).toStrictEqual(['image/jpeg'])
  })

  it('gives the same photograph with and without its metadata one object', async () => {
    // The hash is taken after the walk, so a person who strips their own EXIF
    // before uploading and a person who does not are storing one picture.
    const carrying = await upload({
      filename: 'a.jpg',
      declaredContentType: 'image/jpeg',
      body: streamed(imageFixture('exif.jpg')),
    })
    const bare = await upload({
      documentId: OTHER_DOCUMENT,
      filename: 'b.jpg',
      declaredContentType: 'image/jpeg',
      body: streamed(imageFixture('plain.jpg')),
    })
    if (carrying.kind !== 'uploaded' || bare.kind !== 'uploaded') throw new Error('not uploaded')

    expect(carrying.attachment.sha256).toBe(bare.attachment.sha256)
    expect(blobStore.objects.size).toBe(1)
  })

  it('audits the upload without recording anything secret', async () => {
    const result = await upload()
    if (result.kind !== 'uploaded') throw new Error(result.kind)

    expect(uow.auditEvents).toContainEqual(
      expect.objectContaining({
        type: ATTACHMENT_AUDIT_EVENTS.uploaded,
        actorUserId: ACTOR,
        targetType: 'attachment',
        targetId: result.attachment.id,
      }),
    )
  })

  it('gives the same bytes uploaded twice one object and two rows', async () => {
    const first = await upload()
    const second = await upload({ documentId: OTHER_DOCUMENT })
    if (first.kind !== 'uploaded' || second.kind !== 'uploaded') throw new Error('not uploaded')

    expect(second.attachment.sha256).toBe(first.attachment.sha256)
    expect(second.attachment.id).not.toBe(first.attachment.id)
    expect(blobStore.objects.size).toBe(1)
  })

  it('refuses a document that does not exist', async () => {
    const missing = documentId('00000000-0000-4000-8000-0000000009ff')
    expect(await upload({ documentId: missing })).toStrictEqual({
      kind: 'document-not-found',
      documentId: missing,
    })
  })

  it('accepts a PDF, and stores it exactly as it was', async () => {
    const acceptable = await uploadAttachment(deps, {
      documentId: DOCUMENT,
      uploadedBy: ACTOR,
      filename: 'runbook.pdf',
      declaredContentType: 'application/pdf',
      body: streamed(pdf()),
      maxBytes: MAX_BYTES,
    })
    expect(acceptable.kind).toBe('uploaded')
    if (acceptable.kind !== 'uploaded') return
    expect(acceptable.attachment.contentType).toBe('application/pdf')
    expect(await readBlob(blobStore, acceptable.attachment.sha256)).toStrictEqual(pdf())
  })

  it('stores a picture without what it carried besides its pixels, and records what it stored', async () => {
    const photograph = imageFixture('exif.jpg')
    const picture = imageFixture('plain.jpg')
    const result = await upload({
      filename: 'holiday.jpg',
      declaredContentType: 'image/jpeg',
      body: streamed(photograph),
    })
    if (result.kind !== 'uploaded') throw new Error(result.kind)

    // The EXIF, XMP and comment are gone, and what the row says about the
    // file — its size, its hash — is about the file as stored.
    expect(await readBlob(blobStore, result.attachment.sha256)).toStrictEqual(picture)
    expect(result.attachment.size).toBe(picture.length)
    expect(result.attachment.sha256).toBe(sha256(picture))
    expect(uow.auditEvents.at(-1)?.metadata).toMatchObject({
      size: picture.length,
      sha256: sha256(picture),
    })
  })

  it.each([
    ['meta.png', 'image/png'],
    ['comment.gif', 'image/gif'],
    ['exif.webp', 'image/webp'],
    ['exif.avif', 'image/avif'],
  ] as const)('stores a %s stripped, as %s', async (name, type) => {
    const result = await upload({
      filename: name,
      declaredContentType: type,
      body: streamed(imageFixture(name)),
    })
    if (result.kind !== 'uploaded') throw new Error(result.kind)
    const stored = await readBlob(blobStore, result.attachment.sha256)
    expect(result.attachment.contentType).toBe(type)
    expect(stored?.length).toBeLessThan(imageFixture(name).length)
    expect(result.attachment.size).toBe(stored?.length)
  })

  it('refuses a picture whose container it cannot walk, and stores nothing', async () => {
    const cut = png(8, 8).subarray(0, 40)
    const result = await upload({ body: streamed(cut) })
    expect(result).toStrictEqual({
      kind: 'malformed',
      contentType: 'image/png',
      reason: 'the file ends before it should',
    })
    expect(blobStore.objects.size).toBe(0)
  })

  it('refuses a file past the cap even when the excess follows the end of the picture', async () => {
    const padded = new Uint8Array(4096)
    padded.set(png())
    const result = await upload({ body: streamed(padded, 64), maxBytes: 512 })
    expect(result).toStrictEqual({ kind: 'too-large', maxBytes: 512 })
    expect(blobStore.objects.size).toBe(0)
  })

  it('refuses an SVG, and says that is what it was', async () => {
    const result = await upload({
      filename: 'logo.svg',
      declaredContentType: 'image/svg+xml',
      body: streamed(svg()),
    })
    expect(result).toStrictEqual({ kind: 'type-not-allowed', sniffed: 'image/svg+xml' })
    expect(blobStore.objects.size).toBe(0)
  })

  it('refuses a type it does not recognise at all', async () => {
    const result = await upload({
      filename: 'tool.exe',
      declaredContentType: 'image/png',
      body: streamed(new TextEncoder().encode('MZ this is not a picture')),
    })
    expect(result).toStrictEqual({ kind: 'type-not-allowed', sniffed: null })
  })

  it('refuses bytes that are not what the request said they were', async () => {
    const result = await upload({ declaredContentType: 'application/pdf' })
    expect(result).toStrictEqual({
      kind: 'type-mismatch',
      declared: 'application/pdf',
      sniffed: 'image/png',
    })
    expect(blobStore.objects.size).toBe(0)
  })

  it('accepts a declared type carrying parameters and a different case', async () => {
    const result = await upload({ declaredContentType: 'IMAGE/PNG; charset=binary' })
    expect(result.kind).toBe('uploaded')
  })

  it('refuses an empty file', async () => {
    const result = await upload({ body: streamed(new Uint8Array()) })
    expect(result).toStrictEqual({ kind: 'empty' })
    expect(blobStore.objects.size).toBe(0)
  })

  it('refuses a file past the cap without storing what it had received', async () => {
    const result = await upload({ body: streamed(png(64, 32)), maxBytes: 512 })
    expect(result).toStrictEqual({ kind: 'too-large', maxBytes: 512 })
    expect(blobStore.objects.size).toBe(0)
  })

  it('sniffs from the head of a file far longer than the sniff window', async () => {
    const large = png(64, 32)
    expect(large.length).toBeGreaterThan(SNIFF_BYTES * 4)
    const result = await upload({ body: streamed(large, 64) })
    expect(result.kind).toBe('uploaded')
    if (result.kind !== 'uploaded') return
    expect(result.attachment.size).toBe(large.length)
    expect(await readBlob(blobStore, result.attachment.sha256)).toStrictEqual(large)
  })

  it('stops at the byte that crosses the cap rather than reading the rest', async () => {
    let delivered = 0
    async function* counted(): AsyncGenerator<Uint8Array> {
      for await (const chunk of streamed(png(64, 32), 64)) {
        delivered += chunk.length
        yield chunk
      }
    }
    const result = await upload({ body: counted(), maxBytes: 256 })
    expect(result.kind).toBe('too-large')
    expect(delivered).toBeLessThan(512)
  })

  it('does not let a failing body be mistaken for a refusal', async () => {
    async function* broken(): AsyncGenerator<Uint8Array> {
      yield png().subarray(0, 4)
      throw new Error('the connection went away')
    }
    await expect(upload({ body: broken() })).rejects.toThrow('the connection went away')
  })

  it('reduces a filename to a label, never a path', async () => {
    const result = await upload({ filename: '../../etc/passwd.png' })
    if (result.kind !== 'uploaded') throw new Error(result.kind)
    expect(result.attachment.filename).toBe('etc-passwd.png')
  })
})

describe('safeFilename', () => {
  it('keeps an ordinary name', () => {
    expect(safeFilename('Architecture diagram (v2).png')).toBe('Architecture diagram (v2).png')
  })

  it('removes separators, control characters, and leading dots', () => {
    expect(safeFilename('a/b\\c.png')).toBe('a-b-c.png')
    expect(safeFilename('head\r\ninjected.png')).toBe('headinjected.png')
    expect(safeFilename('   ...hidden.png')).toBe('hidden.png')
  })

  it('names a file the platform can show when nothing survives', () => {
    expect(safeFilename('   ')).toBe('attachment')
    expect(safeFilename('...')).toBe('attachment')
  })

  it('never cuts a character in half', () => {
    // `slice` counts UTF-16 units, so a cut at a fixed index can land between
    // the halves of a surrogate pair and leave a character that is not one —
    // which `encodeURIComponent` refuses and a header would carry as a blot.
    const name = '\u{1F3D6}'.repeat(300)
    const bounded = safeFilename(name)
    expect([...bounded]).toHaveLength(200)
    expect(bounded).not.toMatch(/[\uD800-\uDFFF]/u)
    expect(bounded.length).toBe(400)
  })

  it('bounds the length', () => {
    expect(safeFilename('a'.repeat(500))).toHaveLength(200)
  })
})

describe('getAttachment', () => {
  it('serves an image inline and a PDF as a download', async () => {
    const image = await upload()
    const document = await uploadAttachment(deps, {
      documentId: DOCUMENT,
      uploadedBy: ACTOR,
      filename: 'runbook.pdf',
      declaredContentType: 'application/pdf',
      body: streamed(pdf()),
      maxBytes: MAX_BYTES,
    })
    if (image.kind !== 'uploaded' || document.kind !== 'uploaded') throw new Error('not uploaded')

    const served = await getAttachment(deps, { attachmentId: image.attachment.id })
    expect(served.kind).toBe('found')
    if (served.kind !== 'found') return
    expect(served.disposition).toBe('inline')

    const downloaded = await getAttachment(deps, { attachmentId: document.attachment.id })
    if (downloaded.kind !== 'found') throw new Error(downloaded.kind)
    expect(downloaded.disposition).toBe('attachment')
  })

  it('hands back the bytes that were uploaded', async () => {
    const file = png(6, 4)
    const result = await upload({ body: streamed(file) })
    if (result.kind !== 'uploaded') throw new Error(result.kind)

    const served = await getAttachment(deps, { attachmentId: result.attachment.id })
    if (served.kind !== 'found') throw new Error(served.kind)
    const chunks: Uint8Array[] = []
    for await (const chunk of served.body) chunks.push(chunk)
    expect(Buffer.concat(chunks)).toStrictEqual(Buffer.from(file))
  })

  it('is a miss for an id that names nothing', async () => {
    expect(await getAttachment(deps, { attachmentId: 'nothing' })).toStrictEqual({
      kind: 'not-found',
      attachmentId: 'nothing',
    })
  })

  it('is a miss once the attachment has been taken down', async () => {
    const result = await upload()
    if (result.kind !== 'uploaded') throw new Error(result.kind)
    await deleteAttachment(deps, { attachmentId: result.attachment.id, deletedBy: ACTOR })

    expect(await getAttachment(deps, { attachmentId: result.attachment.id })).toMatchObject({
      kind: 'not-found',
    })
  })

  it('reports a row whose object has gone, rather than pretending it is there', async () => {
    const result = await upload()
    if (result.kind !== 'uploaded') throw new Error(result.kind)
    blobStore.clear()

    expect(await getAttachment(deps, { attachmentId: result.attachment.id })).toStrictEqual({
      kind: 'blob-missing',
      attachmentId: result.attachment.id,
    })
  })
})

describe('listAttachments', () => {
  it('lists what a document carries, and nothing taken down', async () => {
    const kept = await upload()
    const removed = await upload({ body: streamed(png(64)) })
    if (kept.kind !== 'uploaded' || removed.kind !== 'uploaded') throw new Error('not uploaded')
    await deleteAttachment(deps, { attachmentId: removed.attachment.id, deletedBy: ACTOR })

    const listed = await listAttachments(deps, DOCUMENT)
    expect(listed.map((row) => row.id)).toStrictEqual([kept.attachment.id])
  })
})

describe('deleteAttachment', () => {
  it('marks the row removed and leaves the bytes where they are', async () => {
    const result = await upload()
    if (result.kind !== 'uploaded') throw new Error(result.kind)

    const deleted = await deleteAttachment(deps, {
      attachmentId: result.attachment.id,
      deletedBy: ACTOR,
    })
    expect(deleted.kind).toBe('deleted')
    if (deleted.kind !== 'deleted') return
    expect(deleted.attachment.deletedAt).toStrictEqual(NOW)
    // ADR-034: the blob store is a system of record, and the bytes may be
    // another attachment's too.
    expect(await blobStore.has(result.attachment.sha256)).toBe(true)
    expect(uow.auditEvents).toContainEqual(
      expect.objectContaining({
        type: ATTACHMENT_AUDIT_EVENTS.deleted,
        targetId: result.attachment.id,
      }),
    )
  })

  it('refuses while a published body still points at it, and names the documents', async () => {
    const result = await upload()
    if (result.kind !== 'uploaded') throw new Error(result.kind)
    await uow.repos.documentLinks.replaceForDocument({
      documentId: OTHER_DOCUMENT,
      links: [
        {
          targetDocumentId: null,
          url: attachmentUrl(result.attachment.id),
          text: 'A diagram',
          kind: 'internal',
        },
      ],
      idFor: (index) => `link-${index}`,
    })

    const refused = await deleteAttachment(deps, {
      attachmentId: result.attachment.id,
      deletedBy: ACTOR,
    })
    expect(refused).toStrictEqual({ kind: 'in-use', documents: [OTHER_DOCUMENT] })

    const still = await getAttachment(deps, { attachmentId: result.attachment.id })
    expect(still.kind).toBe('found')
  })

  it('is not blocked, or named, by a reference from another workspace', async () => {
    const result = await upload()
    if (result.kind !== 'uploaded') throw new Error(result.kind)

    // A document somewhere else entirely, pointing at the same URL. It cannot
    // be the reason somebody may not delete their own file, and naming it in
    // the refusal would say that a workspace they cannot see exists.
    const elsewhere = documentId('00000000-0000-4000-8000-000000000301')
    await seedDocument(elsewhere, 'aaaaaaaaad', OTHER_WORKSPACE)
    await uow.repos.documentLinks.replaceForDocument({
      documentId: elsewhere,
      links: [
        {
          targetDocumentId: null,
          url: attachmentUrl(result.attachment.id),
          text: 'The same diagram',
          kind: 'internal',
        },
      ],
      idFor: (index) => `link-${index}`,
    })

    expect(
      await deleteAttachment(deps, { attachmentId: result.attachment.id, deletedBy: ACTOR }),
    ).toMatchObject({ kind: 'deleted' })
  })

  it('allows it once the reference has gone from the index', async () => {
    const result = await upload()
    if (result.kind !== 'uploaded') throw new Error(result.kind)
    await uow.repos.documentLinks.replaceForDocument({
      documentId: OTHER_DOCUMENT,
      links: [],
      idFor: (index) => `link-${index}`,
    })

    expect(
      await deleteAttachment(deps, { attachmentId: result.attachment.id, deletedBy: ACTOR }),
    ).toMatchObject({ kind: 'deleted' })
  })

  it('is a miss for an id that names nothing, and for one already taken down', async () => {
    expect(
      await deleteAttachment(deps, { attachmentId: 'nothing', deletedBy: ACTOR }),
    ).toStrictEqual({ kind: 'not-found', attachmentId: 'nothing' })

    const result = await upload()
    if (result.kind !== 'uploaded') throw new Error(result.kind)
    await deleteAttachment(deps, { attachmentId: result.attachment.id, deletedBy: ACTOR })
    expect(
      await deleteAttachment(deps, { attachmentId: result.attachment.id, deletedBy: ACTOR }),
    ).toMatchObject({ kind: 'not-found' })
  })
})
