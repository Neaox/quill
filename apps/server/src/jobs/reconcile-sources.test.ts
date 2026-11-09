import { SOURCE_SYNC_REQUESTED } from '@quill/application'
import { createFakeClock, createInMemoryUnitOfWork } from '@quill/application/test-support'
import { userId, workspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { createReconcileSourcesJob } from './reconcile-sources.ts'

const NOW = new Date('2026-11-09T00:00:00.000Z')
const HANDBOOK = workspaceId('00000000-0000-4000-8000-000000000101')

describe('createReconcileSourcesJob', () => {
  it('asks every sourced workspace to sync, on the interval it is given', async () => {
    const uow = createInMemoryUnitOfWork()
    await uow.repos.workspaces.create({
      id: HANDBOOK,
      unitId: 'acme',
      name: 'Handbook',
      slug: 'handbook',
      now: NOW,
    })
    await uow.repos.workspaceSources.put({
      workspaceId: HANDBOOK,
      remote: 'https://github.com/acme/handbook.git',
      branch: 'main',
      collections: [],
      history: 'full',
      commitMessages: 'subject',
      credential: null,
      webhookSecretName: null,
      configuredBy: userId('00000000-0000-4000-8000-0000000000a1'),
      now: NOW,
    })
    const job = createReconcileSourcesJob({ uow, clock: createFakeClock(NOW) }, 3_600_000)
    expect(job).toMatchObject({ name: 'reconcile-sources', intervalMs: 3_600_000 })
    await job.run(NOW)
    expect(uow.events.map(({ type, payload }) => [type, payload])).toEqual([
      [SOURCE_SYNC_REQUESTED, { version: 1, workspaceId: HANDBOOK, trigger: 'schedule' }],
    ])
  })
})
