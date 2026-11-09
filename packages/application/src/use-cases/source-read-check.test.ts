import { beforeEach, describe, expect, it } from 'vitest'
import { workspaceId } from '@quill/domain'

import { ExternalSourceError } from '../ports/external-source.ts'
import type { ExternalSource } from '../ports/external-source.ts'
import type { ExternalSourceProvider } from '../ports/source-sync.ts'
import { createFakeClock } from '../test-support/fakes.ts'
import type { FakeClock } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { SOURCE_SYNC_REQUESTED } from './events.ts'
import {
  SOURCE_READ_CHECK_INTERVAL_MS,
  SOURCE_READ_SYNC_WAIT_MS,
  createSourceReadCheck,
  readSourceFreshness,
} from './source-read-check.ts'

const NOW = new Date('2026-11-09T12:00:00.000Z')
const HANDBOOK = workspaceId('00000000-0000-4000-8000-000000000101')
const LAYOUT = {
  origin: 'settings',
  fingerprint: '[]',
  collectionIds: [],
  unknownKeys: [],
} as const

let uow: InMemoryUnitOfWork
let clock: FakeClock
let head: () => Promise<string>
let asked: number
let sources: ExternalSourceProvider

const source = (): ExternalSource =>
  ({
    head: async () => {
      asked += 1
      return await head()
    },
  }) as unknown as ExternalSource

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  clock = createFakeClock(NOW)
  asked = 0
  head = async () => 'r1'
  sources = {
    forWorkspace: async (id) =>
      id === HANDBOOK
        ? {
            source: source(),
            settings: { collections: [], history: 'full', commitMessages: 'subject' },
          }
        : null,
  }
  await uow.repos.sourceSyncState.recordSynced({
    workspaceId: HANDBOOK,
    revision: 'r1',
    refused: [],
    layout: LAYOUT,
    brokenLinks: null,
    now: NOW,
  })
})

const requested = () => uow.events.filter((event) => event.type === SOURCE_SYNC_REQUESTED)

describe('createSourceReadCheck', () => {
  it('asks the remote at most once a minute, and nothing when it has not moved', async () => {
    const check = createSourceReadCheck({ uow, clock, sources })
    expect(await check.check(HANDBOOK)).toEqual({ kind: 'current' })
    expect(await check.check(HANDBOOK)).toEqual({ kind: 'recent' })
    clock.advance(SOURCE_READ_CHECK_INTERVAL_MS - 1)
    expect(await check.check(HANDBOOK)).toEqual({ kind: 'recent' })
    clock.advance(1)
    expect(await check.check(HANDBOOK)).toEqual({ kind: 'current' })
    expect(asked).toBe(2)
    expect(requested()).toEqual([])
  })

  it('asks for a sync when the remote is ahead, and counts it under way until it is attempted', async () => {
    head = async () => 'r2'
    const check = createSourceReadCheck({ uow, clock, sources })
    expect(check.awaitingSync(HANDBOOK, null)).toBe(false)
    expect(await check.check(HANDBOOK)).toEqual({ kind: 'requested' })
    expect(requested().map(({ payload }) => payload)).toEqual([
      { version: 1, workspaceId: HANDBOOK, trigger: 'read' },
    ])
    expect(check.awaitingSync(HANDBOOK, NOW)).toBe(true)
    clock.advance(1_000)
    expect(check.awaitingSync(HANDBOOK, clock.now())).toBe(false)
    // Once attempted, it is forgotten.
    expect(check.awaitingSync(HANDBOOK, null)).toBe(false)
  })

  it('stops counting a sync under way when no attempt arrives in time', async () => {
    head = async () => 'r2'
    const check = createSourceReadCheck({ uow, clock, sources })
    await check.check(HANDBOOK)
    clock.advance(SOURCE_READ_SYNC_WAIT_MS)
    expect(check.awaitingSync(HANDBOOK, null)).toBe(false)
  })

  it('does not ask again for a head the last attempt failed on', async () => {
    head = async () => 'r2'
    await uow.repos.sourceSyncState.recordFailure({
      workspaceId: HANDBOOK,
      failure: { reason: 'invalid-manifest', message: 'line 3', revision: 'r2' },
      now: NOW,
    })
    expect(await createSourceReadCheck({ uow, clock, sources }).check(HANDBOOK)).toEqual({
      kind: 'current',
    })
  })

  it('asks for the first sync of a source that never synced', async () => {
    const fresh = createInMemoryUnitOfWork()
    const check = createSourceReadCheck({ uow: fresh, clock, sources })
    expect(await check.check(HANDBOOK)).toEqual({ kind: 'requested' })
  })

  it('answers for a native workspace and a remote that does not answer', async () => {
    const check = createSourceReadCheck({ uow, clock, sources })
    expect(await check.check(workspaceId('00000000-0000-4000-8000-000000000999'))).toEqual({
      kind: 'not-sourced',
    })
    head = async () => {
      throw new ExternalSourceError('timeout', 'slow')
    }
    expect(await check.check(HANDBOOK)).toEqual({ kind: 'unreachable', reason: 'timeout' })
  })

  it('hands on a failure it did not foresee', async () => {
    head = async () => {
      throw new Error('broken')
    }
    await expect(createSourceReadCheck({ uow, clock, sources }).check(HANDBOOK)).rejects.toThrow(
      'broken',
    )
  })
})

describe('readSourceFreshness', () => {
  it('starts the check without waiting, and says a sync is under way', async () => {
    head = async () => 'r2'
    const readCheck = createSourceReadCheck({ uow, clock, sources })
    const failures: unknown[] = []
    const deps = {
      uow,
      lock: { isHeld: async () => false },
      readCheck,
      onCheckFailed: (error: unknown) => failures.push(error),
    }
    expect(await readSourceFreshness(deps, HANDBOOK)).toEqual({ syncing: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requested()).toHaveLength(1)
    expect(await readSourceFreshness(deps, HANDBOOK)).toEqual({ syncing: true })
    expect(
      await readSourceFreshness({ ...deps, lock: { isHeld: async () => true } }, HANDBOOK),
    ).toEqual({ syncing: true })
    expect(failures).toEqual([])
  })

  it('reports a failure of the check rather than throwing it into the request', async () => {
    head = async () => {
      throw new Error('broken')
    }
    const failures: unknown[] = []
    const result = await readSourceFreshness(
      {
        uow: createInMemoryUnitOfWork(),
        lock: { isHeld: async () => false },
        readCheck: createSourceReadCheck({ uow, clock, sources }),
        onCheckFailed: (error: unknown) => failures.push(error),
      },
      HANDBOOK,
    )
    expect(result).toEqual({ syncing: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(failures).toHaveLength(1)
  })
})
