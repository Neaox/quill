import {
  createFakeClock,
  createFakeContentStore,
  createFakeDocumentFormat,
  createFakeIdGenerator,
  createInMemoryUnitOfWork,
} from '@quill/application/test-support'
import type { ExternalSource, SourceSyncLock } from '@quill/application'
import { workspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import type { AppDependencies } from '../../dependencies.ts'
import { DeferEvent } from './consumer.ts'
import { SOURCE_BUSY_RETRY_MS, createSyncSourceConsumer } from './sync-source.ts'

const HANDBOOK = workspaceId('00000000-0000-4000-8000-000000000101')
const PAYLOAD = { version: 1, workspaceId: HANDBOOK, trigger: 'manual' }

/** A source already at the revision the workspace last synced, so a sync that runs stops at once. */
const UNMOVED: ExternalSource = {
  head: async () => 'r1',
  fetch: async () => 'r1',
  narrow: async () => {},
  files: async function* () {},
  file: async () => null,
  readFiles: async function* () {},
  history: async function* () {},
  changes: async function* () {},
}

function consumer(lock: SourceSyncLock) {
  const uow = createInMemoryUnitOfWork()
  const deps: Pick<AppDependencies, 'uow' | 'format' | 'clock' | 'ids' | 'sourceSync'> = {
    uow,
    format: createFakeDocumentFormat(),
    clock: createFakeClock(new Date('2026-01-01T00:00:00.000Z')),
    ids: createFakeIdGenerator(),
    sourceSync: {
      contentStore: createFakeContentStore(),
      sources: {
        forWorkspace: async () => ({
          source: UNMOVED,
          settings: { collections: [], history: 'full', commitMessages: 'subject' },
        }),
      },
      lock,
      allowFileRemotesForTesting: false,
    },
  }
  return { uow, consumer: createSyncSourceConsumer(deps) }
}

describe('the SourceSyncRequested consumer', () => {
  it('runs the sync job of the workspace the event names', async () => {
    const workspaces: string[] = []
    const { uow, consumer: handler } = consumer({
      async withLock(workspace, work) {
        workspaces.push(workspace)
        return { kind: 'ran', value: await work() }
      },
    })
    await uow.repos.sourceSyncState.recordSynced({
      workspaceId: HANDBOOK,
      revision: 'r1',
      refused: [],
      layout: { origin: 'manifest', fingerprint: 'f', collectionIds: [], unknownKeys: [] },
      now: new Date(0),
    })
    await handler.handle(PAYLOAD)
    expect(workspaces).toEqual([HANDBOOK])
  })

  it('defers, without counting an attempt, while another sync of the source runs', async () => {
    const { consumer: handler } = consumer({ withLock: async () => ({ kind: 'busy' }) })
    const deferred = handler.handle(PAYLOAD)
    await expect(deferred).rejects.toBeInstanceOf(DeferEvent)
    await expect(deferred).rejects.toMatchObject({ retryAfterMs: SOURCE_BUSY_RETRY_MS })
  })

  it('leaves a payload this release cannot read alone', async () => {
    const { consumer: handler } = consumer({
      withLock: async () => {
        throw new Error('not asked')
      },
    })
    await expect(handler.handle({ version: 99 })).resolves.toBeUndefined()
  })
})
