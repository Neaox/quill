import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'
import type { DocumentId, RevisionId } from '@quill/domain'

import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import { createFakeDocumentFormat } from '../test-support/fake-document-format.ts'
import { createFakeSettings } from '../test-support/fake-settings.ts'
import { createFakeClock, createFakeHasher, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createInMemoryBlobStore } from '../test-support/in-memory-blob-store.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createDocument } from './create-document.ts'
import { publishDocument, readDraftContent } from './publish-document.ts'
import type { PutBackDraftChangesDependencies } from './put-back-draft-changes.ts'
import { putBackDraftChanges, replaceDraftContent } from './put-back-draft-changes.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const ADA = userId('00000000-0000-4000-8000-000000000001')
const GRACE = userId('00000000-0000-4000-8000-000000000002')
const MISSING = documentId('00000000-0000-4000-8000-0000000009ff')
const SESSION = 'session-ada'
const author = { userId: ADA, name: 'Ada', email: 'ada@example.com' }

let uow: InMemoryUnitOfWork
let deps: PutBackDraftChangesDependencies & Parameters<typeof publishDocument>[0]

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

const contentOf = (body: string) => ({ version: 1, frontMatter: {}, ast: { body } })

/** Writes the draft; each write after the first is a new version of it, as a save is. */
async function writeDraft(id: DocumentId, body: string): Promise<number> {
  const draft = await uow.repos.drafts.find(id)
  if (draft === null) {
    await uow.repos.drafts.init({
      documentId: id,
      baseRevision: null,
      ast: contentOf(body),
      now: NOW,
    })
  } else {
    await uow.repos.drafts.rebase({
      documentId: id,
      baseRevision: draft.baseRevision,
      ast: contentOf(body),
      now: NOW,
    })
  }
  return (await uow.repos.drafts.find(id))?.draftVersion ?? 0
}

async function aPublishedDocument(body: string): Promise<{ id: DocumentId; head: RevisionId }> {
  const created = await createDocument(deps, {
    workspaceId: WORKSPACE,
    collectionId: 'architecture',
    parentId: null,
    title: 'Runbook',
    createdBy: ADA,
  })
  if (created.kind !== 'created') throw new Error(created.kind)
  const id = created.document.id
  await writeDraft(id, body)
  const draft = await uow.repos.drafts.find(id)
  const published = await publishDocument(deps, {
    documentId: id,
    base: draft?.baseRevision ?? null,
    author,
    sessionId: SESSION,
  })
  if (published.kind !== 'published') throw new Error(published.kind)
  return { id, head: published.revision }
}

async function bodyOf(id: DocumentId): Promise<unknown> {
  return readDraftContent((await uow.repos.drafts.find(id))?.ast)?.ast
}

describe('putBackDraftChanges', () => {
  it('saves the draft with the change put back, as one new version, and hands back what it was', async () => {
    const { id, head } = await aPublishedDocument('# Runbook\nRestart nightly.\nCheck the queue.')
    const version = await writeDraft(id, '# Runbook\nRestart weekly.\nCheck the queue.')

    const result = await putBackDraftChanges(deps, {
      documentId: id,
      sessionId: SESSION,
      userId: GRACE,
      from: head,
      draftVersion: version,
      changes: ['c2'],
    })

    expect(result).toMatchObject({ kind: 'replaced', draft: { draftVersion: version + 1 } })
    expect(await bodyOf(id)).toEqual({ body: '# Runbook\nRestart nightly.\nCheck the queue.' })
    if (result.kind !== 'replaced') return
    expect(readDraftContent(result.previous)?.ast).toEqual({
      body: '# Runbook\nRestart weekly.\nCheck the queue.',
    })
    // The write is stamped like a save, with whoever made it.
    expect((await uow.repos.drafts.find(id))?.authorship).toMatchObject({ by: GRACE })
  })

  it('is refused while another session is editing the document', async () => {
    const { id, head } = await aPublishedDocument('# Runbook\nRestart nightly.')
    const version = await writeDraft(id, '# Runbook\nRestart weekly.')
    await uow.repos.locks.acquire({ documentId: id, userId: GRACE, sessionId: 'grace', now: NOW })

    const result = await putBackDraftChanges(deps, {
      documentId: id,
      sessionId: SESSION,
      userId: ADA,
      from: head,
      draftVersion: version,
      changes: ['c2'],
    })

    expect(result).toMatchObject({ kind: 'lock-lost', holder: { holderSessionId: 'grace' } })
    expect(await bodyOf(id)).toEqual({ body: '# Runbook\nRestart weekly.' })
  })

  it('goes ahead while this session holds the lock, in an editor open elsewhere', async () => {
    const { id, head } = await aPublishedDocument('# Runbook\nRestart nightly.')
    const version = await writeDraft(id, '# Runbook\nRestart weekly.')
    await uow.repos.locks.acquire({ documentId: id, userId: ADA, sessionId: SESSION, now: NOW })

    const result = await putBackDraftChanges(deps, {
      documentId: id,
      sessionId: SESSION,
      userId: ADA,
      from: head,
      draftVersion: version,
      changes: ['c2'],
    })

    expect(result.kind).toBe('replaced')
  })

  it('says the draft has moved on when it is not the version that was compared', async () => {
    const { id, head } = await aPublishedDocument('# Runbook\nRestart nightly.')
    const version = await writeDraft(id, '# Runbook\nRestart weekly.')
    const newer = await writeDraft(id, '# Runbook\nRestart monthly.')

    const result = await putBackDraftChanges(deps, {
      documentId: id,
      sessionId: SESSION,
      userId: ADA,
      from: head,
      draftVersion: version,
      changes: ['c2'],
    })

    expect(result).toEqual({ kind: 'stale', currentVersion: newer })
  })
})

describe('replaceDraftContent', () => {
  it('undoes a put back, by putting the draft it handed back where it was', async () => {
    const { id, head } = await aPublishedDocument('# Runbook\nRestart nightly.')
    const version = await writeDraft(id, '# Runbook\nRestart weekly.')
    const put = await putBackDraftChanges(deps, {
      documentId: id,
      sessionId: SESSION,
      userId: ADA,
      from: head,
      draftVersion: version,
      changes: ['c2'],
    })
    if (put.kind !== 'replaced') throw new Error(put.kind)

    const undone = await replaceDraftContent(deps, {
      documentId: id,
      sessionId: SESSION,
      userId: ADA,
      draftVersion: put.draft.draftVersion,
      ast: put.previous,
    })

    expect(undone).toMatchObject({ kind: 'replaced', draft: { draftVersion: version + 2 } })
    expect(await bodyOf(id)).toEqual({ body: '# Runbook\nRestart weekly.' })
  })

  it('says the draft has moved on when undoing over a version that is not the latest', async () => {
    const { id } = await aPublishedDocument('# Runbook\nRestart nightly.')
    const version = await writeDraft(id, '# Runbook\nRestart weekly.')

    const result = await replaceDraftContent(deps, {
      documentId: id,
      sessionId: SESSION,
      userId: ADA,
      draftVersion: version - 1,
      ast: contentOf('x'),
    })

    expect(result).toEqual({ kind: 'stale', currentVersion: version })
  })

  it('is refused, undoing too, while another session is editing', async () => {
    const { id } = await aPublishedDocument('# Runbook\nRestart nightly.')
    const version = await writeDraft(id, '# Runbook\nRestart weekly.')
    await uow.repos.locks.acquire({ documentId: id, userId: GRACE, sessionId: 'grace', now: NOW })

    const result = await replaceDraftContent(deps, {
      documentId: id,
      sessionId: SESSION,
      userId: ADA,
      draftVersion: version,
      ast: contentOf('x'),
    })

    expect(result.kind).toBe('lock-lost')
  })

  it('writes over a draft this release cannot read, leaving who wrote what as it was', async () => {
    const { id } = await aPublishedDocument('# Runbook\nRestart nightly.')
    const draft = await uow.repos.drafts.find(id)
    await uow.repos.drafts.rebase({
      documentId: id,
      baseRevision: draft?.baseRevision ?? null,
      ast: { version: 99 },
      now: NOW,
    })
    const unreadable = (await uow.repos.drafts.find(id))?.draftVersion ?? 0

    const result = await replaceDraftContent(deps, {
      documentId: id,
      sessionId: SESSION,
      userId: ADA,
      draftVersion: unreadable,
      ast: contentOf('Back to something readable.'),
    })

    expect(result.kind).toBe('replaced')
    expect((await uow.repos.drafts.find(id))?.authorship).toBeNull()
  })

  it('refuses content that is not a draft', async () => {
    const { id } = await aPublishedDocument('# Runbook\nRestart nightly.')

    const result = await replaceDraftContent(deps, {
      documentId: id,
      sessionId: SESSION,
      userId: ADA,
      draftVersion: 0,
      ast: { version: 99 },
    })

    expect(result).toEqual({ kind: 'unreadable' })
  })

  it('refuses a document with no draft', async () => {
    const result = await replaceDraftContent(deps, {
      documentId: MISSING,
      sessionId: SESSION,
      userId: ADA,
      draftVersion: 0,
      ast: contentOf('x'),
    })

    expect(result).toEqual({ kind: 'no-draft', documentId: MISSING })
  })
})
