import { createFakeClock, createInMemoryUnitOfWork } from '@quill/application/test-support'
import { describe, expect, it } from 'vitest'

import {
  LINK_PREVIEW_RETENTION_MS,
  SWEEP_LINK_PREVIEWS_INTERVAL_MS,
  createSweepLinkPreviewsJob,
  sweepLinkPreviews,
} from './sweep-link-previews.ts'

const NOW = new Date('2026-10-13T09:00:00.000Z')
const ago = (milliseconds: number) => new Date(NOW.getTime() - milliseconds)

function setUp() {
  const uow = createInMemoryUnitOfWork()
  return { uow, clock: createFakeClock(NOW) }
}

describe('sweepLinkPreviews', () => {
  it('forgets previews last fetched before the retention, whatever their scope, and keeps the rest', async () => {
    const deps = setUp()
    const { linkPreviews } = deps.uow.repos
    await linkPreviews.putReady({
      scope: 'public',
      key: 'https://old.example/',
      document: {},
      now: ago(LINK_PREVIEW_RETENTION_MS + 1),
    })
    await linkPreviews.putFailure({
      scope: 'policy:x',
      key: 'https://old.example/',
      failure: 'unreachable',
      now: ago(LINK_PREVIEW_RETENTION_MS + 1),
    })
    await linkPreviews.putReady({
      scope: 'public',
      key: 'https://new.example/',
      document: {},
      now: ago(1000),
    })

    expect(await sweepLinkPreviews(deps, NOW)).toBe(2)
    expect(
      await linkPreviews.findMany(
        ['public', 'policy:x'],
        ['https://old.example/', 'https://new.example/'],
      ),
    ).toEqual([expect.objectContaining({ key: 'https://new.example/' })])
  })

  it('keeps a preview fetched exactly at the retention boundary', async () => {
    const deps = setUp()
    await deps.uow.repos.linkPreviews.putReady({
      scope: 'public',
      key: 'https://edge.example/',
      document: {},
      now: ago(LINK_PREVIEW_RETENTION_MS),
    })
    expect(await sweepLinkPreviews(deps, NOW)).toBe(0)
  })

  it('runs daily as a scheduled job', async () => {
    const deps = setUp()
    await deps.uow.repos.linkPreviews.putReady({
      scope: 'public',
      key: 'https://old.example/',
      document: {},
      now: ago(LINK_PREVIEW_RETENTION_MS + 1),
    })
    const job = createSweepLinkPreviewsJob(deps)
    expect(job).toMatchObject({
      name: 'sweep-link-previews',
      intervalMs: SWEEP_LINK_PREVIEWS_INTERVAL_MS,
    })
    await job.run(NOW)
    expect(
      await deps.uow.repos.linkPreviews.findMany(['public'], ['https://old.example/']),
    ).toEqual([])
  })
})
