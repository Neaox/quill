import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, revisionId, userId, workspaceId } from '@quill/domain'
import type { DocumentId, RevisionId } from '@quill/domain'

import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import { createFakeDocumentFormat } from '../test-support/fake-document-format.ts'
import { createFakeSettings } from '../test-support/fake-settings.ts'
import {
  aShortId,
  createFakeClock,
  createFakeHasher,
  createFakeIdGenerator,
} from '../test-support/fakes.ts'
import { createInMemoryBlobStore } from '../test-support/in-memory-blob-store.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { CompareRevisionsDependencies } from './compare-revisions.ts'
import { compareRevisions, compareRevisionSources } from './compare-revisions.ts'
import { createDocument } from './create-document.ts'
import { publishDocument, readDraftContent } from './publish-document.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const AUTHOR = userId('00000000-0000-4000-8000-000000000001')
const MISSING = documentId('00000000-0000-4000-8000-0000000009ff')
const SESSION = 'session-ada'
const author = { userId: AUTHOR, name: 'Ada', email: 'ada@example.com' }

let uow: InMemoryUnitOfWork
let deps: CompareRevisionsDependencies & Parameters<typeof publishDocument>[0]

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

async function publish(id: DocumentId, body: string): Promise<RevisionId> {
  await writeDraft(id, body)
  const draft = await uow.repos.drafts.find(id)
  const published = await publishDocument(deps, {
    documentId: id,
    base: draft?.baseRevision ?? null,
    author,
    sessionId: SESSION,
  })
  if (published.kind !== 'published') throw new Error(published.kind)
  return published.revision
}

async function aDocument(): Promise<DocumentId> {
  const created = await createDocument(deps, {
    workspaceId: WORKSPACE,
    collectionId: 'architecture',
    parentId: null,
    title: 'Runbook',
    createdBy: AUTHOR,
  })
  if (created.kind !== 'created') throw new Error(created.kind)
  return created.document.id
}

describe('compareRevisions', () => {
  it('compares two published revisions of the document', async () => {
    const id = await aDocument()
    const first = await publish(id, '# Runbook\nRestart nightly.')
    const second = await publish(id, '# Runbook\nRestart weekly.')

    const result = await compareRevisions(deps, { documentId: id, from: first, to: second })

    expect(result.kind).toBe('compared')
    if (result.kind !== 'compared') return
    expect(result.content.changes).toMatchObject([
      { change: 'changed', excerpt: 'Restart weekly.' },
    ])
  })

  it('compares a first revision against nothing', async () => {
    const id = await aDocument()
    const first = await publish(id, '# Runbook\nRestart nightly.')
    const result = await compareRevisions(deps, { documentId: id, from: null, to: first })
    expect(result.kind === 'compared' && result.content.summary.added).toBeGreaterThan(0)
  })

  it('compares the published head with the draft being written', async () => {
    const id = await aDocument()
    const head = await publish(id, '# Runbook\nRestart nightly.')
    await writeDraft(id, '# Runbook\nRestart nightly.\nCheck the queue first.')

    const result = await compareRevisions(deps, { documentId: id, from: head, to: 'draft' })

    expect(result.kind === 'compared' && result.content.changes).toMatchObject([
      { change: 'added', excerpt: 'Check the queue first.' },
    ])
  })

  it('answers "not modified" when the caller already holds this comparison', async () => {
    const id = await aDocument()
    const first = await publish(id, 'one')
    const second = await publish(id, 'two')
    const answered = await compareRevisions(deps, { documentId: id, from: first, to: second })
    if (answered.kind !== 'compared') throw new Error(answered.kind)

    const again = await compareRevisions(deps, {
      documentId: id,
      from: first,
      to: second,
      known: answered.key,
    })
    expect(again).toEqual({ kind: 'not-modified', key: answered.key })
  })

  it('refuses a revision that is not in this document’s history', async () => {
    const id = await aDocument()
    const first = await publish(id, 'one')
    const stranger = revisionId('f'.repeat(40))
    expect(await compareRevisions(deps, { documentId: id, from: stranger, to: first })).toEqual({
      kind: 'revision-not-found',
      revision: stranger,
    })
  })

  it('says so when there is no draft to compare with', async () => {
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
    expect(await compareRevisions(deps, { documentId: bare, from: null, to: 'draft' })).toEqual({
      kind: 'no-draft',
      documentId: bare,
    })
  })

  it('refuses a document that does not exist', async () => {
    expect(await compareRevisions(deps, { documentId: MISSING, from: null, to: 'draft' })).toEqual({
      kind: 'not-found',
      documentId: MISSING,
    })
  })
})

describe('compareRevisionSources', () => {
  it('compares the two Markdown texts by line', async () => {
    const id = await aDocument()
    const first = await publish(id, '# Runbook\nRestart nightly.')
    const second = await publish(id, '# Runbook\nRestart weekly.')

    const result = await compareRevisionSources(deps, { documentId: id, from: first, to: second })

    expect(result.kind).toBe('compared')
    if (result.kind !== 'compared') return
    expect(result.source.lines.some((line) => line.change === 'added')).toBe(true)
  })
})

describe('compareRevisionSources: what it cannot compare', () => {
  it('refuses a document that does not exist', async () => {
    expect(
      await compareRevisionSources(deps, { documentId: MISSING, from: null, to: 'draft' }),
    ).toEqual({ kind: 'not-found', documentId: MISSING })
  })

  it('refuses a revision that is not in the document’s history', async () => {
    const id = await aDocument()
    const first = await publish(id, 'one')
    const stranger = revisionId('f'.repeat(40))

    expect(
      await compareRevisionSources(deps, { documentId: id, from: stranger, to: first }),
    ).toEqual({ kind: 'revision-not-found', revision: stranger })
  })
})
