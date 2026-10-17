import { getLinkPreviews, refreshLinkPreview } from '@quill/application'
import {
  createFakeClock,
  createFakeIdGenerator,
  createInMemoryUnitOfWork,
} from '@quill/application/test-support'
import { userId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { INERT_LINK_PREVIEW_PORTS } from './inert.ts'

const ADA = userId('00000000-0000-4000-8000-00000000000a')

function setUp() {
  const uow = createInMemoryUnitOfWork()
  return {
    uow,
    deps: {
      uow,
      clock: createFakeClock(new Date()),
      ids: createFakeIdGenerator(),
      ...INERT_LINK_PREVIEW_PORTS,
    },
  }
}

describe('INERT_LINK_PREVIEW_PORTS', () => {
  it('reads every link as blocked and queues nothing', async () => {
    const { uow, deps } = setUp()
    const readings = await getLinkPreviews(deps, {
      userId: ADA,
      urls: ['https://a.example/', 'https://b.example/'],
    })
    expect(readings.map((reading) => reading.view)).toEqual([
      { state: 'blocked' },
      { state: 'blocked' },
    ])
    expect(uow.events).toEqual([])
  })

  it('refuses a refresh as blocked', async () => {
    const { deps } = setUp()
    expect(await refreshLinkPreview(deps, { userId: ADA, url: 'https://a.example/' })).toEqual({
      ok: false,
      error: 'blocked',
    })
  })

  it('has a resolver and limits that do nothing and allow nothing', async () => {
    expect(await INERT_LINK_PREVIEW_PORTS.resolver.resolve('https://a.example/')).toEqual({
      ok: false,
      error: 'blocked',
    })
    expect(
      INERT_LINK_PREVIEW_PORTS.limits.allowFetch({ host: 'a.example', scope: 'inert' }).allowed,
    ).toBe(false)
    expect(INERT_LINK_PREVIEW_PORTS.limits.allowRefresh(ADA)).toBe(false)
  })

  it('answers who is reading with the policy that is off, in a scope of its own', async () => {
    const audience = await INERT_LINK_PREVIEW_PORTS.audiences.forPerson(ADA)
    expect(audience.scope).toBe('inert')
    expect(audience.policy.mode).toBe('off')
    expect(audience.policy.permits(new URL('https://a.example/'))).toBe(false)
  })

  it('reads for the public with the same policy that is off', async () => {
    expect((await INERT_LINK_PREVIEW_PORTS.audiences.forPublic()).policy.mode).toBe('off')
  })

  it('allows no lookups and no new fetches', () => {
    expect(INERT_LINK_PREVIEW_PORTS.limits.allowRead(ADA)).toBe(false)
    expect(INERT_LINK_PREVIEW_PORTS.limits.allowQueued(ADA, 5)).toBe(0)
  })
})
