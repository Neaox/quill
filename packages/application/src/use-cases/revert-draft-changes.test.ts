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
import type { RevertDraftChangesDependencies } from './revert-draft-changes.ts'
import { revertDraftChanges } from './revert-draft-changes.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const AUTHOR = userId('00000000-0000-4000-8000-000000000001')
const MISSING = documentId('00000000-0000-4000-8000-0000000009ff')
const author = { userId: AUTHOR, name: 'Ada', email: 'ada@example.com' }

let uow: InMemoryUnitOfWork
let deps: RevertDraftChangesDependencies & Parameters<typeof publishDocument>[0]

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

/** Writes the draft; each write after the first is a new version of it, as a save is. */
async function writeDraft(id: DocumentId, body: string): Promise<number> {
  const draft = await uow.repos.drafts.find(id)
  const content = readDraftContent(draft?.ast)
  const ast = { version: 1, frontMatter: content?.frontMatter ?? {}, ast: { body } }
  if (draft === null) {
    await uow.repos.drafts.init({ documentId: id, baseRevision: null, ast, now: NOW })
  } else {
    await uow.repos.drafts.rebase({
      documentId: id,
      baseRevision: draft.baseRevision,
      ast,
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
    createdBy: AUTHOR,
  })
  if (created.kind !== 'created') throw new Error(created.kind)
  const id = created.document.id
  await writeDraft(id, body)
  const draft = await uow.repos.drafts.find(id)
  const published = await publishDocument(deps, {
    documentId: id,
    base: draft?.baseRevision ?? null,
    author,
    sessionId: 'session-ada',
  })
  if (published.kind !== 'published') throw new Error(published.kind)
  return { id, head: published.revision }
}

describe('revertDraftChanges', () => {
  it('gives the draft back with the named change put back, without saving it', async () => {
    const { id, head } = await aPublishedDocument('# Runbook\nRestart nightly.\nCheck the queue.')
    const version = await writeDraft(id, '# Runbook\nRestart weekly.\nCheck the queue.')

    const result = await revertDraftChanges(deps, {
      documentId: id,
      from: head,
      draftVersion: version,
      changes: ['c2'],
    })

    expect(result).toMatchObject({ kind: 'reverted', draftVersion: version })
    if (result.kind !== 'reverted') return
    expect(result.content.ast).toEqual({ body: '# Runbook\nRestart nightly.\nCheck the queue.' })
    const saved = await uow.repos.drafts.find(id)
    expect(readDraftContent(saved?.ast)?.ast).toEqual({
      body: '# Runbook\nRestart weekly.\nCheck the queue.',
    })
  })

  it('says the draft has moved on when the caller was looking at an older one', async () => {
    const { id, head } = await aPublishedDocument('# Runbook\nRestart nightly.')
    const version = await writeDraft(id, '# Runbook\nRestart weekly.')
    const newer = await writeDraft(id, '# Runbook\nRestart monthly.')

    const result = await revertDraftChanges(deps, {
      documentId: id,
      from: head,
      draftVersion: version,
      changes: ['c2'],
    })

    expect(result).toEqual({ kind: 'stale', currentVersion: newer })
  })

  it('refuses a change the comparison does not have', async () => {
    const { id, head } = await aPublishedDocument('# Runbook\nRestart nightly.')
    const version = await writeDraft(id, '# Runbook\nRestart weekly.')

    const result = await revertDraftChanges(deps, {
      documentId: id,
      from: head,
      draftVersion: version,
      changes: ['c2', 'c9'],
    })

    expect(result).toEqual({ kind: 'not-revertible', changes: ['c9'] })
  })

  it('refuses a document that does not exist', async () => {
    const result = await revertDraftChanges(deps, {
      documentId: MISSING,
      from: null,
      draftVersion: 1,
      changes: [],
    })

    expect(result).toEqual({ kind: 'not-found', documentId: MISSING })
  })
})
