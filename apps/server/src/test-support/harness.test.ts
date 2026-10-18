import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { grantCreated } from '@quill/application'

import { createServerHarness, HARNESS_NOW } from './harness.ts'
import type { ServerHarness } from './harness.ts'

let harness: ServerHarness

beforeAll(async () => {
  harness = await createServerHarness()
}, 30_000)

afterAll(async () => {
  await harness.close()
})

describe('the server harness', () => {
  it('records a failing event listener rather than letting it vanish', async () => {
    const failure = new Error('the listener broke')
    const unsubscribe = harness.eventBus.subscribe(grantCreated, () => {
      throw failure
    })

    await harness.deps.uow.run(async (repos) => {
      await repos.events.record(
        grantCreated,
        {
          grantId: 'grant-1',
          principalKind: 'public',
          principalId: null,
          scopeKind: 'collection',
          scopeId: 'collection-1',
          role: 'viewer',
          effect: 'allow',
        },
        HARNESS_NOW,
      )
    })
    unsubscribe()

    expect(harness.listenerFailures).toEqual([failure])
  })
})
