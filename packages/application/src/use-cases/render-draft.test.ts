import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import { createInMemoryBlobStore } from '../test-support/in-memory-blob-store.ts'
import { createFakeDocumentFormat } from '../test-support/fake-document-format.ts'
import { createFakeSettings } from '../test-support/fake-settings.ts'
import {
  aShortId,
  createFakeClock,
  createFakeHasher,
  createFakeIdGenerator,
} from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createDocument } from './create-document.ts'
import { publishDocument, readDraftContent } from './publish-document.ts'
import { renderDraft } from './render-draft.ts'
import type { RenderDocumentDependencies } from './render-document.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const AUTHOR = userId('00000000-0000-4000-8000-000000000001')
const MISSING = documentId('00000000-0000-4000-8000-0000000009ff')

let uow: InMemoryUnitOfWork
let deps: RenderDocumentDependencies

/** A document with a draft saying `body`, never published unless `published` says so. */
async function documentWith(body: string, published = false): Promise<DocumentId> {
  const created = await createDocument(deps, {
    workspaceId: WORKSPACE,
    collectionId: 'architecture',
    parentId: null,
    title: 'Runbook',
    createdBy: AUTHOR,
  })
  if (created.kind !== 'created') throw new Error(created.kind)
  await writeDraft(created.document.id, body)
  if (published) {
    const result = await publishDocument(deps, {
      documentId: created.document.id,
      base: null,
      author: { userId: AUTHOR, name: 'Ada', email: 'ada@example.com' },
      sessionId: 'session-ada',
    })
    if (result.kind !== 'published') throw new Error(result.kind)
  }
  return created.document.id
}

async function writeDraft(id: DocumentId, body: string): Promise<void> {
  const draft = await uow.repos.drafts.find(id)
  const content = readDraftContent(draft?.ast)
  await uow.repos.drafts.init({
    documentId: id,
    baseRevision: draft?.baseRevision ?? null,
    ast: { version: 1, frontMatter: content?.frontMatter ?? {}, ast: { body } },
    now: NOW,
  })
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  deps = {
    uow,
    contentStore: createFakeContentStore(),
    format: createFakeDocumentFormat(),
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
    hasher: createFakeHasher(),
    blobStore: createInMemoryBlobStore(),
    settings: createFakeSettings(),
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

describe('rendering a document’s draft', () => {
  it('draws the draft as it is now, not the revision that was last published', async () => {
    const id = await documentWith('# Runbook\nRestart nightly.', true)
    await writeDraft(id, '# Runbook\nRestart nightly.\nCheck the queue first.')

    const result = await renderDraft(deps, { documentId: id })

    expect(result.kind).toBe('rendered')
    expect(result.kind === 'rendered' && result.content.html).toContain('Check the queue first.')
  })

  it('draws a document that has never been published', async () => {
    const id = await documentWith('# New page\nNot out yet.')

    const result = await renderDraft(deps, { documentId: id })

    expect(result.kind === 'rendered' && result.content.html).toContain('Not out yet.')
  })

  it('says when the draft was last saved, and what revision it is based on', async () => {
    const id = await documentWith('# Runbook\nBody.', true)
    const draft = await uow.repos.drafts.find(id)

    const result = await renderDraft(deps, { documentId: id })

    expect(result.kind === 'rendered' && result.savedAt).toEqual(draft?.updatedAt)
    expect(result.kind === 'rendered' && result.base).toBe(draft?.baseRevision)
  })

  it('leaves the published page, the render cache and the link index as they were', async () => {
    const id = await documentWith('# Runbook\nPublished words.', true)
    await writeDraft(id, '# Runbook\nDraft words.')
    const before = await uow.repos.documentLinks.listForDocument(id)

    await renderDraft(deps, { documentId: id })

    expect(await uow.repos.documentLinks.listForDocument(id)).toEqual(before)
  })

  it('titles a draft that names no title after the document', async () => {
    const id = await documentWith('placeholder')
    await uow.repos.drafts.init({
      documentId: id,
      baseRevision: null,
      ast: { version: 1, frontMatter: {}, ast: { body: 'No heading, no title.' } },
      now: NOW,
    })

    const result = await renderDraft(deps, { documentId: id })

    expect(result.kind === 'rendered' && result.title).toBe('Runbook')
  })

  it('says so when there is no draft', async () => {
    const bare = documentId('00000000-0000-4000-8000-000000000301')
    await uow.repos.documents.create({
      id: bare,
      shortId: aShortId(),
      workspaceId: WORKSPACE,
      collectionId: 'architecture',
      parentId: null,
      slug: 'bare',
      path: 'architecture/bare.md',
      title: 'Bare',
      status: 'draft',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })

    expect(await renderDraft(deps, { documentId: bare })).toEqual({
      kind: 'no-draft',
      documentId: bare,
    })
  })

  it('refuses a document that does not exist', async () => {
    expect(await renderDraft(deps, { documentId: MISSING })).toEqual({
      kind: 'not-found',
      documentId: MISSING,
    })
  })
})
