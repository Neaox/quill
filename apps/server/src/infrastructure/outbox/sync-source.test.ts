import {
  createFakeClock,
  createFakeContentStore,
  createFakeDocumentFormat,
  createFakeHasher,
  createFakeSettings,
  createInMemoryBlobStore,
  createFakeIdGenerator,
  createFakeTokenService,
  createInMemoryUnitOfWork,
} from '@quill/application/test-support'
import { ExternalSourceError, inlineDocumentWork } from '@quill/application'
import type { ExternalSource, SourceSyncLock } from '@quill/application'
import { userId, workspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

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
  present: async () => new Set(),
}

const ADMIN = userId('00000000-0000-4000-8000-0000000000a1')
const NOW = new Date('2026-01-01T00:00:00.000Z')

function consumer(lock: Pick<SourceSyncLock, 'withLock'>, source: ExternalSource = UNMOVED) {
  const uow = createInMemoryUnitOfWork()
  const deps: Parameters<typeof createSyncSourceConsumer>[0] = {
    uow,
    format: createFakeDocumentFormat(),
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
    tokens: createFakeTokenService(),
    shareLinkPolicy: { allowed: () => true },
    blobStore: createInMemoryBlobStore(),
    drawingText: { read: async () => null },
    config: { attachments: { maxBytes: 1024 } },
    sourceSync: {
      contentStore: createFakeContentStore(),
      sources: {
        forWorkspace: async () => ({
          source,
          settings: {
            collections: [],
            history: 'full',
            commitMessages: 'subject',
            manifestEntry: null,
          },
          configuredAt: NOW,
        }),
        withDraft: async () => {
          throw new Error('The outbox never opens a draft.')
        },
      },
      lock: { ...lock, isHeld: async () => false },
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
      brokenLinks: [],
      now: new Date(0),
    })
    await handler.handle(PAYLOAD)
    expect(workspaces).toEqual([HANDBOOK])
  })

  it('hands the sync the process’s document pool when it has one', async () => {
    const { uow } = consumer({ withLock: async () => ({ kind: 'busy' }) })
    const asked: string[] = []
    const format = createFakeDocumentFormat()
    const handler = createSyncSourceConsumer({
      uow,
      format,
      clock: createFakeClock(NOW),
      ids: createFakeIdGenerator(),
      tokens: createFakeTokenService(),
      shareLinkPolicy: { allowed: () => true },
      blobStore: createInMemoryBlobStore(),
      drawingText: { read: async () => null },
      config: { attachments: { maxBytes: 1024 } },
      documentWork: inlineDocumentWork(format),
      hasher: createFakeHasher(),
      settings: createFakeSettings(),
      sourceSync: {
        contentStore: createFakeContentStore(),
        sources: {
          forWorkspace: async () => {
            asked.push('source')
            return null
          },
          withDraft: async () => {
            throw new Error('Not asked for in a sync.')
          },
        },
        lock: {
          withLock: async (_, work) => ({ kind: 'ran', value: await work() }),
          isHeld: async () => false,
        },
        allowFileRemotesForTesting: false,
      },
    })
    await handler.handle(PAYLOAD)
    expect(asked).toEqual(['source'])
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
  describe('telling the administrators', () => {
    const running: Pick<SourceSyncLock, 'withLock'> = {
      withLock: async (_, work) => ({ kind: 'ran', value: await work() }),
    }

    async function sourced(uow: ReturnType<typeof createInMemoryUnitOfWork>) {
      await uow.repos.units.create({
        id: 'acme',
        parentId: null,
        name: 'Acme',
        slug: 'acme',
        label: 'company',
        now: NOW,
      })
      await uow.repos.workspaces.create({
        id: HANDBOOK,
        unitId: 'acme',
        name: 'Handbook',
        slug: 'handbook',
        now: NOW,
      })
      await uow.repos.users.create({
        id: ADMIN,
        email: 'admin@example.com',
        displayName: 'Admin',
        now: NOW,
      })
      await uow.repos.users.setInstanceAdmin(ADMIN, true)
      await uow.repos.workspaceSources.put({
        workspaceId: HANDBOOK,
        remote: 'https://github.com/acme/handbook.git',
        branch: 'main',
        collections: [],
        history: 'full',
        commitMessages: 'subject',
        manifestEntry: null,
        credential: null,
        webhookSecretName: null,
        outsideLinks: 'forge',
        viewTemplate: null,
        configuredBy: ADMIN,
        now: NOW,
      })
    }

    const told = (uow: ReturnType<typeof createInMemoryUnitOfWork>) =>
      uow.repos.notifications.listForUser({ userId: ADMIN, after: null, limit: 10 })

    it('tells them about a failure once, however many attempts it stops', async () => {
      const failing: ExternalSource = {
        ...UNMOVED,
        head: async () => {
          throw new ExternalSourceError('branch-not-found', 'no branch main')
        },
      }
      const { uow, consumer: handler } = consumer(running, failing)
      await sourced(uow)
      await handler.handle(PAYLOAD)
      await handler.handle(PAYLOAD)
      expect(await told(uow)).toEqual([
        expect.objectContaining({
          kind: 'source-sync-failed',
          failure: { reason: 'branch-not-found', revision: null },
        }),
      ])
    })

    it('tells them about a failure the job did not foresee, and hands it to the outbox', async () => {
      const broken: ExternalSource = {
        ...UNMOVED,
        head: async () => {
          throw new Error('connection reset')
        },
      }
      const { uow, consumer: handler } = consumer(running, broken)
      await sourced(uow)
      await expect(handler.handle(PAYLOAD)).rejects.toThrow('connection reset')
      expect(await told(uow)).toHaveLength(1)
    })
  })
})
