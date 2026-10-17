import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import { createFakeDocumentFormat } from '../test-support/fake-document-format.ts'
import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createDocument } from './create-document.ts'
import { openDraft, type OpenDraftDependencies } from './open-draft.ts'
import { publishDocument, readDraftContent } from './publish-document.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const AUTHOR = userId('00000000-0000-4000-8000-000000000001')
const MISSING = documentId('00000000-0000-4000-8000-0000000009ff')

let uow: InMemoryUnitOfWork
let deps: OpenDraftDependencies & Parameters<typeof publishDocument>[0]

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  deps = {
    uow,
    contentStore: createFakeContentStore(),
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

async function newDocument(title = 'Overview'): Promise<DocumentId> {
  const created = await createDocument(deps, {
    workspaceId: WORKSPACE,
    collectionId: 'architecture',
    parentId: null,
    title,
    createdBy: AUTHOR,
  })
  if (created.kind !== 'created') throw new Error(created.kind)
  return created.document.id
}

/** A document whose draft row is gone — imported, seeded, or written by an older version. */
async function withoutDraft(id: DocumentId): Promise<void> {
  uow.forgetDraft(id)
}

describe('openDraft', () => {
  it('hands back the draft a document already has', async () => {
    const id = await newDocument()
    const existing = await uow.repos.drafts.find(id)

    const opened = await openDraft(deps, id)

    expect(opened).toEqual({ kind: 'draft', draft: existing })
  })

  it('starts a blank draft for a never-published document that has none, rather than failing', async () => {
    const id = await newDocument('Runbook')
    await withoutDraft(id)

    const opened = await openDraft(deps, id)

    expect(opened.kind).toBe('draft')
    if (opened.kind !== 'draft') return
    expect(opened.draft.baseRevision).toBeNull()
    expect(readDraftContent(opened.draft.ast)?.frontMatter['title']).toBe('Runbook')
    expect(await uow.repos.drafts.find(id)).toEqual(opened.draft)
  })

  it('starts the draft from the published revision when the document has one', async () => {
    const id = await newDocument()
    const published = await publishDocument(deps, {
      documentId: id,
      base: null,
      author: { userId: AUTHOR, name: 'Ada', email: 'ada@example.com' },
      sessionId: 'session-ada',
    })
    if (published.kind !== 'published') throw new Error(published.kind)
    await withoutDraft(id)

    const opened = await openDraft(deps, id)

    expect(opened.kind === 'draft' ? opened.draft.baseRevision : undefined).toBe(published.revision)
  })

  it('answers not found for a document that does not exist', async () => {
    expect(await openDraft(deps, MISSING)).toEqual({ kind: 'not-found' })
  })
})
