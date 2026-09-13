import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, revisionId, workspaceId } from '@quill/domain'

import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import type { FakeContentStore } from '../test-support/fake-content-store.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { getDiff } from './get-diff.ts'
import { aShortId } from '../test-support/fakes.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
const MISSING = documentId('00000000-0000-4000-8000-0000000009ff')

let uow: InMemoryUnitOfWork
let contentStore: FakeContentStore

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  contentStore = createFakeContentStore()
  await uow.repos.documents.create({
    id: DOC,
    shortId: aShortId(),
    workspaceId: WORKSPACE,
    collectionId: 'architecture',
    parentId: null,
    slug: 'overview',
    path: 'architecture/overview.md',
    title: 'Overview',
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
})

async function publish(markdown: string, base: string | null) {
  const result = await contentStore.publish({
    workspaceId: WORKSPACE,
    base: base as never,
    author: { name: 'Ada', email: 'ada@example.com' },
    changes: [{ kind: 'write', documentId: DOC, path: 'architecture/overview.md', markdown }],
  })
  if (result.kind !== 'published') throw new Error(result.kind)
  // The real publish writes this; history and compare read a revision from
  // the index before the content store is asked for it (ADR-014).
  await uow.repos.revisions.append({
    id: result.revision,
    documentId: DOC,
    workspaceId: WORKSPACE,
    revision: result.revision,
    authorName: 'Ada',
    authorEmail: 'ada@example.com',
    timestamp: NOW,
    summary: 'Publish',
    changeNote: null,
    now: NOW,
  })
  return result.revision
}

describe('getDiff', () => {
  it('compares two revisions of the document', async () => {
    const first = await publish('one', null)
    const second = await publish('two', first)

    const result = await getDiff(
      { uow, contentStore },
      { documentId: DOC, from: first, to: second },
    )
    expect(result.kind).toBe('diff')
    if (result.kind !== 'diff') return
    expect(result.diff.unified).toContain('-one')
    expect(result.diff.unified).toContain('+two')
    expect(result.diff).toMatchObject({ from: first, to: second, added: 1, removed: 1 })
  })

  it('compares a first revision against nothing', async () => {
    const first = await publish('one', null)
    const result = await getDiff({ uow, contentStore }, { documentId: DOC, from: null, to: first })
    expect(result.kind === 'diff' && result.diff.removed).toBe(0)
  })

  it('refuses a revision this document never had', async () => {
    const first = await publish('one', null)
    const stranger = revisionId('f'.repeat(40))
    expect(
      await getDiff({ uow, contentStore }, { documentId: DOC, from: stranger, to: first }),
    ).toEqual({ kind: 'revision-not-found', revision: stranger })
    expect(
      await getDiff({ uow, contentStore }, { documentId: DOC, from: null, to: stranger }),
    ).toEqual({ kind: 'revision-not-found', revision: stranger })
  })

  it('reports a document it cannot find', async () => {
    expect(
      await getDiff({ uow, contentStore }, { documentId: MISSING, from: null, to: 'x' as never }),
    ).toEqual({ kind: 'not-found', documentId: MISSING })
  })
})
