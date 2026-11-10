import { describe, expect, it } from 'vitest'
import { workspaceId } from '@quill/domain'

import { createFakeClock } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { SOURCE_SYNC_STATE_CHANGED, sourceSyncStateChanged } from './events.ts'
import { announceSourceSync } from './source-sync-announcement.ts'

const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000001')

function setUp() {
  const uow = createInMemoryUnitOfWork()
  const clock = createFakeClock(new Date('2026-11-11T09:00:00.000Z'))
  const announced = () =>
    uow.events
      .filter((event) => event.type === SOURCE_SYNC_STATE_CHANGED)
      .map(({ payload }) => sourceSyncStateChanged.parse(payload))
      .map((payload) => [payload?.state, payload?.changed])
  return { deps: { uow, clock }, announced }
}

describe('announcing a sync', () => {
  it('says it started, then that it finished with what it changed', async () => {
    const { deps, announced } = setUp()
    const result = await announceSourceSync(deps, WORKSPACE, async () => {
      expect(announced()).toEqual([['started', false]])
      return { kind: 'synced', published: 2 }
    })
    expect(result).toEqual({ kind: 'synced', published: 2 })
    expect(announced()).toEqual([
      ['started', false],
      ['finished', true],
    ])
  })

  it('says a sync that found nothing new changed nothing', async () => {
    const { deps, announced } = setUp()
    await announceSourceSync(deps, WORKSPACE, async () => ({ kind: 'up-to-date' }))
    expect(announced()).toEqual([
      ['started', false],
      ['finished', false],
    ])
  })

  it('says a sync failed, whether it recorded the failure or threw it', async () => {
    const recorded = setUp()
    await announceSourceSync(recorded.deps, WORKSPACE, async () => ({ kind: 'failed' }))
    expect(recorded.announced().at(-1)).toEqual(['failed', true])

    const thrown = setUp()
    const failure = new Error('the disk is full')
    await expect(
      announceSourceSync(thrown.deps, WORKSPACE, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    expect(thrown.announced()).toEqual([
      ['started', false],
      ['failed', true],
    ])
  })

  it('reads only a whole payload', () => {
    expect(sourceSyncStateChanged.parse({ version: 1, workspaceId: WORKSPACE })).toBeNull()
    expect(
      sourceSyncStateChanged.parse({
        version: 1,
        workspaceId: WORKSPACE,
        state: 'finished',
        changed: 'yes',
      }),
    ).toBeNull()
  })
})
