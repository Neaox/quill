import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, revisionId, userId, workspaceId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import type { PublishRequest } from '../ports/content-store.ts'
import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import type { FakeContentStore } from '../test-support/fake-content-store.ts'
import { createFakeDocumentFormat } from '../test-support/fake-document-format.ts'
import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createDocument } from './create-document.ts'
import { publishDocument, readDraftContent } from './publish-document.ts'
import type { PublishDependencies } from './publish-document.ts'
import { restoreRevision } from './restore-revision.ts'
import { readPublished } from './read-published.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const AUTHOR = userId('00000000-0000-4000-8000-000000000001')
const MISSING = documentId('00000000-0000-4000-8000-0000000009ff')
const NO_SUCH_REVISION = revisionId('f'.repeat(40))

const author = { userId: AUTHOR, name: 'Ada', email: 'ada@example.com' }
const SESSION = 'session-ada'

let uow: InMemoryUnitOfWork
let contentStore: FakeContentStore
let deps: PublishDependencies

async function publish(id: DocumentId, body: string, title?: string) {
  const draft = await uow.repos.drafts.find(id)
  const content = readDraftContent(draft?.ast)
  await uow.repos.drafts.init({
    documentId: id,
    baseRevision: draft?.baseRevision ?? null,
    ast: {
      version: 1,
      frontMatter: { ...content?.frontMatter, ...(title === undefined ? {} : { title }) },
      ast: { body },
    },
    now: NOW,
  })
  const result = await publishDocument(deps, {
    documentId: id,
    base: draft?.baseRevision ?? null,
    author,
    sessionId: SESSION,
  })
  if (result.kind !== 'published') throw new Error(result.kind)
  return result.revision
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  contentStore = createFakeContentStore()
  deps = {
    uow,
    contentStore,
    format: createFakeDocumentFormat(),
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
  }
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'architecture',
    workspaceId: WORKSPACE,
    name: 'Architecture',
    slug: 'architecture',
    now: NOW,
  })
})

async function newDocument(): Promise<DocumentId> {
  const created = await createDocument(deps, {
    workspaceId: WORKSPACE,
    collectionId: 'architecture',
    parentId: null,
    title: 'Overview',
    createdBy: AUTHOR,
  })
  if (created.kind !== 'created') throw new Error(created.kind)
  return created.document.id
}

describe('restoreRevision', () => {
  it('publishes the old content again rather than rewriting history', async () => {
    const id = await newDocument()
    const first = await publish(id, '# Overview\n\nThe original.')
    await publish(id, '# Overview\n\nA regrettable edit.')

    const restored = await restoreRevision(deps, {
      documentId: id,
      revision: first,
      author,
      sessionId: SESSION,
      changeNote: 'Restore the original',
    })
    expect(restored.kind).toBe('published')
    if (restored.kind !== 'published') return
    expect(restored.revision).not.toBe(first)

    const current = await readPublished(deps, { documentId: id })
    expect(current.kind === 'found' && current.markdown).toContain('The original.')

    const history = await uow.repos.revisions.listForDocument(id, { limit: 10 })
    expect(history).toHaveLength(3)
    expect(history[0]).toMatchObject({
      revision: restored.revision,
      summary: 'Restore Overview',
      changeNote: 'Restore the original',
    })
    expect(restored.document.headRevision).toBe(restored.revision)
  })

  it('restores the title the old revision carried', async () => {
    const id = await newDocument()
    const first = await publish(id, '# Overview', 'Overview')
    await publish(id, '# Renamed', 'Renamed')

    const restored = await restoreRevision(deps, {
      documentId: id,
      revision: first,
      author,
      sessionId: SESSION,
    })
    expect(restored.kind === 'published' && restored.document.title).toBe('Overview')
    expect(uow.events.filter((event) => event.type === 'DocumentRenamed')).toHaveLength(2)
  })

  it('keeps the document title when the restored revision names none', async () => {
    const id = await newDocument()
    await uow.repos.drafts.init({
      documentId: id,
      baseRevision: null,
      ast: { version: 1, frontMatter: {}, ast: { body: 'Just prose, with no heading.' } },
      now: NOW,
    })
    const untitled = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: SESSION,
    })
    if (untitled.kind !== 'published') throw new Error(untitled.kind)
    await publish(id, '# Renamed', 'Renamed')

    const restored = await restoreRevision(deps, {
      documentId: id,
      revision: untitled.revision,
      author,
      sessionId: SESSION,
    })
    expect(restored.kind === 'published' && restored.document.title).toBe('Renamed')
    const [latest] = await uow.repos.revisions.listForDocument(id, { limit: 1 })
    expect(latest?.summary).toBe('Restore Renamed')
  })

  it('moves the draft onto the restored content, so the next publish does not undo it', async () => {
    const id = await newDocument()
    const first = await publish(id, '# Overview\n\nThe original.')
    await publish(id, '# Overview\n\nA regrettable edit.')
    const before = await uow.repos.drafts.find(id)

    const restored = await restoreRevision(deps, {
      documentId: id,
      revision: first,
      author,
      sessionId: SESSION,
    })
    if (restored.kind !== 'published') throw new Error(restored.kind)

    const draft = await uow.repos.drafts.find(id)
    expect(draft?.ast).toMatchObject({ ast: { body: expect.stringContaining('The original.') } })
    expect(draft?.baseRevision).toBe(restored.revision)
    // The version moved, so an editor that was open when the restore landed is
    // told its next write is stale and re-reads rather than republishing the
    // content the restore undid (ADR-021).
    expect(draft?.draftVersion).toBe((before?.draftVersion ?? 0) + 1)
  })

  it('refuses to restore over a lock somebody else holds', async () => {
    const id = await newDocument()
    const first = await publish(id, '# Overview\n\nThe original.')
    await publish(id, '# Overview\n\nA regrettable edit.')
    await uow.repos.locks.acquire({
      documentId: id,
      userId: AUTHOR,
      sessionId: 'session-grace',
      now: NOW,
    })

    const restored = await restoreRevision(deps, {
      documentId: id,
      revision: first,
      author,
      sessionId: SESSION,
    })
    expect(restored.kind === 'lock-lost' && restored.holder.holderSessionId).toBe('session-grace')
    expect(await uow.repos.revisions.listForDocument(id, { limit: 10 })).toHaveLength(2)
  })

  it('asks for a merge when somebody publishes between the read and the write', async () => {
    const id = await newDocument()
    const first = await publish(id, '# Overview\n\nThe original.')
    const document = await uow.repos.documents.findById(id)

    let acted = false
    const interleaved = {
      ...contentStore,
      async publish(request: PublishRequest) {
        if (!acted) {
          acted = true
          await contentStore.publish({
            workspaceId: WORKSPACE,
            changes: [
              {
                kind: 'write',
                documentId: id,
                path: document?.path ?? '',
                markdown: '# Overview\n\nSomebody else was here.',
              },
            ],
            author: { name: 'Grace', email: 'grace@example.com' },
            base: first,
          })
        }
        return contentStore.publish(request)
      },
    }

    const restored = await restoreRevision(
      { ...deps, contentStore: interleaved },
      { documentId: id, revision: first, author, sessionId: SESSION },
    )
    expect(restored.kind).toBe('merge-required')
    if (restored.kind !== 'merge-required') return
    expect(restored.conflicts).toHaveLength(1)
    expect(restored.current).not.toBe(first)
  })

  it('refuses when the document is taken over while the restore is in flight', async () => {
    const id = await newDocument()
    const first = await publish(id, '# Overview\n\nThe original.')
    await publish(id, '# Overview\n\nA regrettable edit.')

    let acted = false
    const interleaved = {
      ...contentStore,
      async publish(request: PublishRequest) {
        if (!acted) {
          acted = true
          await uow.repos.locks.adminTakeover({
            documentId: id,
            userId: AUTHOR,
            sessionId: 'session-grace',
            now: NOW,
          })
        }
        return contentStore.publish(request)
      },
    }

    const restored = await restoreRevision(
      { ...deps, contentStore: interleaved },
      { documentId: id, revision: first, author, sessionId: SESSION },
    )

    // The content store has the bytes; Postgres recorded nothing, so the
    // document's head and its history still describe the revision before this
    // one (see the reconciliation note on `recordPublish`).
    expect(restored.kind === 'lock-lost' && restored.holder.holderSessionId).toBe('session-grace')
    expect(await uow.repos.revisions.listForDocument(id, { limit: 10 })).toHaveLength(2)
  })

  it('reports a revision the history knows but the content store does not', async () => {
    const id = await newDocument()
    await publish(id, '# Overview')
    await uow.repos.revisions.append({
      id: 'phantom',
      documentId: id,
      workspaceId: WORKSPACE,
      revision: NO_SUCH_REVISION,
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      timestamp: NOW,
      summary: 'A revision the store never had',
      changeNote: null,
      now: NOW,
    })

    expect(
      await restoreRevision(deps, {
        documentId: id,
        revision: NO_SUCH_REVISION,
        author,
        sessionId: SESSION,
      }),
    ).toEqual({ kind: 'revision-not-found', revision: NO_SUCH_REVISION })
  })

  it('reports a document or a revision it cannot find', async () => {
    expect(
      await restoreRevision(deps, {
        documentId: MISSING,
        revision: NO_SUCH_REVISION,
        author,
        sessionId: SESSION,
      }),
    ).toEqual({ kind: 'not-found', documentId: MISSING })

    const id = await newDocument()
    await publish(id, '# Overview')
    expect(
      await restoreRevision(deps, {
        documentId: id,
        revision: NO_SUCH_REVISION,
        author,
        sessionId: SESSION,
      }),
    ).toEqual({ kind: 'revision-not-found', revision: NO_SUCH_REVISION })
  })
})

describe('readPublished', () => {
  it('reports a revision this document never had as nothing to read', async () => {
    const id = await newDocument()
    await publish(id, '# Overview')
    expect(await readPublished(deps, { documentId: id, revision: NO_SUCH_REVISION })).toEqual({
      kind: 'unpublished',
      documentId: id,
    })
  })

  it('reports a document that has never been published and one that does not exist', async () => {
    const id = await newDocument()
    expect(await readPublished(deps, { documentId: id })).toEqual({
      kind: 'unpublished',
      documentId: id,
    })
    expect(await readPublished(deps, { documentId: MISSING })).toEqual({
      kind: 'not-found',
      documentId: MISSING,
    })
  })

  it('reads an older revision when one is asked for', async () => {
    const id = await newDocument()
    const first = await publish(id, '# Overview\n\nThe original.')
    await publish(id, '# Overview\n\nChanged.')

    const old = await readPublished(deps, { documentId: id, revision: first })
    expect(old.kind === 'found' && old.markdown).toContain('The original.')
    expect(old.kind === 'found' && old.path).toBe('architecture/overview.md')
    expect(old.kind === 'found' && old.title).toBe('Overview')
    expect(old.kind === 'found' && old.frontMatter['id']).toBe(id)
  })
})
