import { DOCUMENT_PUBLISHED, DOCUMENT_RENAMED, EVENT_PAYLOAD_VERSION } from '@quill/application'
import { documentId as toDocumentId, workspaceId as toWorkspaceId } from '@quill/domain'
import { describe, expect, it, vi } from 'vitest'

import type { IndexDocumentDependencies } from '../search/index-document.ts'
import { createIndexOnPublishConsumer, createIndexOnRenameConsumer } from './index-on-publish.ts'

/**
 * What the consumers do with a payload, without a database behind them: the
 * indexing itself is `index-document.ts`'s and is exercised end to end in
 * `routes/search.integration.test.ts`.
 */

const DOCUMENT = toDocumentId('11111111-1111-4111-8111-111111111111')
const WORKSPACE = toWorkspaceId('22222222-2222-4222-8222-222222222222')

/** Every call `indexDocument` makes goes through the repository, so recording that is recording the work. */
function dependencies(findById = vi.fn<() => Promise<null>>(async () => null)): {
  deps: IndexDocumentDependencies
  findById: ReturnType<typeof vi.fn>
} {
  const remove = vi.fn<() => Promise<void>>(async () => {})
  const deps = {
    uow: { repos: { documents: { findById } } },
    contentStore: { read: async () => null },
    format: {},
    searchIndex: { remove, index: vi.fn<() => Promise<void>>(async () => {}) },
  } as unknown as IndexDocumentDependencies
  return { deps, findById }
}

describe('indexing on publish', () => {
  it('indexes the document the event names', async () => {
    const { deps, findById } = dependencies()
    await createIndexOnPublishConsumer(deps).handle({
      version: EVENT_PAYLOAD_VERSION,
      documentId: DOCUMENT,
      workspaceId: WORKSPACE,
      revision: 'a'.repeat(40),
      publishedBy: '33333333-3333-4333-8333-333333333333',
    })
    expect(findById).toHaveBeenCalledWith(DOCUMENT)
  })

  it('is registered for DocumentPublished', () => {
    expect(createIndexOnPublishConsumer(dependencies().deps).eventType).toBe(DOCUMENT_PUBLISHED)
  })

  it('leaves an event this release cannot read alone', async () => {
    const { deps, findById } = dependencies()
    await createIndexOnPublishConsumer(deps).handle({ version: 99 })
    expect(findById).not.toHaveBeenCalled()
  })
})

describe('indexing on rename', () => {
  it('re-indexes, because a rename changes the most heavily weighted field there is', async () => {
    const { deps, findById } = dependencies()
    await createIndexOnRenameConsumer(deps).handle({
      version: EVENT_PAYLOAD_VERSION,
      documentId: DOCUMENT,
      workspaceId: WORKSPACE,
      from: 'Old title',
      to: 'New title',
    })
    expect(findById).toHaveBeenCalledWith(DOCUMENT)
  })

  it('is registered for DocumentRenamed', () => {
    expect(createIndexOnRenameConsumer(dependencies().deps).eventType).toBe(DOCUMENT_RENAMED)
  })

  it('leaves an event this release cannot read alone', async () => {
    const { deps, findById } = dependencies()
    await createIndexOnRenameConsumer(deps).handle({ version: 99 })
    expect(findById).not.toHaveBeenCalled()
  })
})
