import { DOCUMENT_MOVED, DOCUMENT_RENAMED, EVENT_PAYLOAD_VERSION } from '@quill/application'
import type { PublicRedirectDependencies } from '@quill/application'
import { documentId as toDocumentId, workspaceId as toWorkspaceId } from '@quill/domain'
import { describe, expect, it, vi } from 'vitest'

import {
  createRecordMoveRedirectConsumer,
  createRecordRenameRedirectConsumer,
} from './record-public-redirect.ts'

/**
 * What the two consumers do with a payload. Deriving the address itself is
 * `recordRenameRedirect`'s and `recordMoveRedirect`'s, which have their own
 * tests in `@quill/application`; the whole path is exercised in
 * `routes/public-site.integration.test.ts`.
 */

const DOCUMENT = toDocumentId('11111111-1111-4111-8111-111111111111')
const WORKSPACE = toWorkspaceId('22222222-2222-4222-8222-222222222222')

/**
 * Every path through both use cases starts by reading the document, so
 * recording that read is recording whether the consumer acted at all.
 */
function dependencies(): {
  deps: PublicRedirectDependencies
  findById: ReturnType<typeof vi.fn>
} {
  const findById = vi.fn<() => Promise<null>>(async () => null)
  const deps = {
    uow: { repos: { documents: { findById } } },
    clock: { now: () => new Date(0) },
    ids: { uuid: () => 'id', shortId: () => 'k000000001' },
  } as unknown as PublicRedirectDependencies
  return { deps, findById }
}

describe('recording a redirect on rename', () => {
  it('is registered for DocumentRenamed', () => {
    expect(createRecordRenameRedirectConsumer(dependencies().deps).eventType).toBe(DOCUMENT_RENAMED)
  })

  it('acts on the document the event names', async () => {
    const { deps, findById } = dependencies()
    await createRecordRenameRedirectConsumer(deps).handle({
      version: EVENT_PAYLOAD_VERSION,
      documentId: DOCUMENT,
      workspaceId: WORKSPACE,
      from: 'Rate limits',
      to: 'Throttling',
    })
    expect(findById).toHaveBeenCalledWith(DOCUMENT)
  })

  it('leaves an event this release cannot read alone', async () => {
    const { deps, findById } = dependencies()
    await createRecordRenameRedirectConsumer(deps).handle({ version: 99 })
    expect(findById).not.toHaveBeenCalled()
  })
})

describe('recording a redirect on a move', () => {
  it('is registered for DocumentMoved', () => {
    expect(createRecordMoveRedirectConsumer(dependencies().deps).eventType).toBe(DOCUMENT_MOVED)
  })

  it('acts on the document the event names', async () => {
    const { deps, findById } = dependencies()
    await createRecordMoveRedirectConsumer(deps).handle({
      version: EVENT_PAYLOAD_VERSION,
      documentId: DOCUMENT,
      workspaceId: WORKSPACE,
      fromCollectionId: 'guides',
      toCollectionId: 'runbooks',
    })
    expect(findById).toHaveBeenCalledWith(DOCUMENT)
  })

  it('leaves an event this release cannot read alone', async () => {
    const { deps, findById } = dependencies()
    await createRecordMoveRedirectConsumer(deps).handle({ version: 99 })
    expect(findById).not.toHaveBeenCalled()
  })
})
