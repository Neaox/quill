import { beforeEach, describe, expect, it } from 'vitest'
import {
  createFakeClock,
  createFakeContentStore,
  createFakeDocumentFormat,
  createFakeIdGenerator,
  createInMemoryUnitOfWork,
} from '@quill/application/test-support'
import { createHasher } from '../hasher.ts'
import type { FakeContentStore, InMemoryUnitOfWork } from '@quill/application/test-support'
import type { RenderDocumentDependencies } from '@quill/application'
import { EVENT_PAYLOAD_VERSION, renderDocument } from '@quill/application'
import { documentId, userId, workspaceId } from '@quill/domain'

import { createRenderOnPublishConsumer } from './render-on-publish.ts'
import { aShortId } from '@quill/application/test-support'

/**
 * The consumer the reading view needs: it renders on publish so the first
 * reader never pays for it (ADR-031). Nothing invalidates beside it — a rename
 * gives the bodies that link to the renamed document a new key.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const DOC = documentId('00000000-0000-4000-8000-000000000201')
const SOURCE = documentId('00000000-0000-4000-8000-000000000202')
const AUTHOR = userId('00000000-0000-4000-8000-000000000001')

let uow: InMemoryUnitOfWork
let contentStore: FakeContentStore
let deps: RenderDocumentDependencies

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  contentStore = createFakeContentStore()
  deps = {
    uow,
    contentStore,
    format: createFakeDocumentFormat(),
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
    hasher: createHasher(),
  }
  for (const [index, [id, slug]] of (
    [
      [DOC, 'target'],
      [SOURCE, 'source'],
    ] as const
  ).entries()) {
    await uow.repos.documents.create({
      id,
      shortId: aShortId(index + 1),
      workspaceId: WORKSPACE,
      collectionId: 'architecture',
      parentId: null,
      slug,
      path: `architecture/${slug}.md`,
      title: slug,
      status: 'published',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
  }
})

async function publish(markdown: string) {
  const result = await contentStore.publish({
    workspaceId: WORKSPACE,
    base: await contentStore.head(WORKSPACE),
    author: { name: 'Ada', email: 'ada@example.com' },
    changes: [{ kind: 'write', documentId: DOC, path: 'architecture/target.md', markdown }],
  })
  if (result.kind !== 'published') throw new Error(result.kind)
  await uow.repos.documents.update(DOC, { headRevision: result.revision }, NOW)
  // The real publish writes this in the same transaction; a revision is only
  // readable through the index that records it (ADR-014).
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

describe('createRenderOnPublishConsumer', () => {
  it('renders the revision that was published, so the first reader finds it cached', async () => {
    const revision = await publish('# Target\n\nA body.')
    const consumer = createRenderOnPublishConsumer(deps)
    expect(consumer.eventType).toBe('DocumentPublished')

    await consumer.handle({
      version: EVENT_PAYLOAD_VERSION,
      documentId: DOC,
      workspaceId: WORKSPACE,
      revision,
      publishedBy: AUTHOR,
    })

    // The reader that follows finds the entry already there.
    const reader = await renderDocument(deps, { documentId: DOC })
    expect(reader.kind === 'rendered' && reader.cached).toBe(true)
  })

  it('leaves an event it cannot read for a release that understands it', async () => {
    const consumer = createRenderOnPublishConsumer(deps)
    await expect(consumer.handle({ version: 99 })).resolves.toBeUndefined()
  })
})
