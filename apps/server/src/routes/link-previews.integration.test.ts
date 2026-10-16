import { compileLinkPolicy, ok } from '@quill/domain'
import type { LinkPreview } from '@quill/domain'
import { PUBLIC_PREVIEW_SCOPE } from '@quill/application'
import type { LinkPreviewPorts } from '@quill/application'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createLinkPreviewRateLimits } from '../infrastructure/link-preview/rate-limits.ts'
import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Link previews over HTTP (ADR-042): reading never fetches, a miss queues a
 * fetch the outbox runs, and the next read finds it.
 */

const URL_A = 'https://blog.example/post'

function previewOf(url: string): LinkPreview {
  return {
    url,
    canonicalUrl: url,
    title: 'A title',
    description: 'A description',
    siteName: 'Blog',
    kind: 'article',
    thumbnail: null,
    favicon: null,
    layer: 'open-graph',
    fetchedAt: '2026-01-01T00:00:00.000Z',
  }
}

const policy = compileLinkPolicy({ mode: 'rich', allow: [], block: ['blocked.example'] })
if (!policy.ok) throw new Error('policy')

const resolve = vi.fn<LinkPreviewPorts['resolver']['resolve']>(async (url) => ok(previewOf(url)))
const allowRefresh = vi.fn<LinkPreviewPorts['limits']['allowRefresh']>(() => true)
const allowRead = vi.fn<LinkPreviewPorts['limits']['allowRead']>(() => true)

let harness: ServerHarness
let tenancy: TenancyFixture
let viewer: Record<string, string>

beforeAll(async () => {
  harness = await createServerHarness({
    linkPreviewPorts: {
      audiences: {
        forPerson: async () => ({ scope: PUBLIC_PREVIEW_SCOPE, policy: policy.value }),
        forPublic: () => ({ scope: PUBLIC_PREVIEW_SCOPE, policy: policy.value }),
      },
      resolver: { resolve },
      limits: {
        ...createLinkPreviewRateLimits(harnessClockPlaceholder()),
        allowRefresh,
        allowRead,
      },
    },
  })
  tenancy = await seedTenancy(harness)
  viewer = await harness.cookiesFor(tenancy.viewer)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

/** Limits that never run out here; the bucket maths is tested where it lives. */
function harnessClockPlaceholder() {
  return { now: () => new Date('2026-01-01T00:00:00.000Z') }
}

const post = (url: string, payload: unknown, cookies?: Record<string, string>) =>
  harness.app.inject({
    method: 'POST',
    url,
    payload: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
    ...(cookies === undefined ? {} : { cookies }),
  })

const resolveLinks = (urls: string[], cookies: Record<string, string> | undefined = viewer) =>
  post('/api/link-previews/resolve', { urls }, cookies)

describe('POST /api/link-previews/resolve', () => {
  it('needs a session', async () => {
    expect((await post('/api/link-previews/resolve', { urls: [URL_A] })).statusCode).toBe(401)
  })

  it('answers pending for a link nobody has asked about, without fetching', async () => {
    const response = await resolveLinks([URL_A])
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ previews: [{ url: URL_A, view: { state: 'pending' } }] })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('has the preview ready once the outbox has run, for every reader', async () => {
    await harness.drainOutbox()
    expect(resolve).toHaveBeenCalledOnce()
    const response = await resolveLinks([URL_A])
    expect(response.json()).toEqual({
      previews: [{ url: URL_A, view: { state: 'ready', preview: previewOf(URL_A), stale: false } }],
    })
  })

  it('shows a link the organisation blocks as blocked, and never fetches it', async () => {
    const before = resolve.mock.calls.length
    const response = await resolveLinks(['https://blocked.example/x'])
    await harness.drainOutbox()
    expect(response.json()).toEqual({
      previews: [{ url: 'https://blocked.example/x', view: { state: 'blocked' } }],
    })
    expect(resolve.mock.calls.length).toBe(before)
  })

  it('answers a link that is not a URL as unavailable, in order with the others', async () => {
    const response = await resolveLinks(['nope', URL_A])
    expect(response.json().previews).toEqual([
      { url: 'nope', view: { state: 'unavailable', reason: 'invalid_url' } },
      { url: URL_A, view: expect.objectContaining({ state: 'ready' }) },
    ])
  })

  it('tells a person who asks too often to wait, and looks nothing up', async () => {
    allowRead.mockReturnValueOnce(false)
    const before = resolve.mock.calls.length
    const response = await resolveLinks([URL_A])
    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ error: { code: 'rate_limited' } })
    expect(resolve.mock.calls.length).toBe(before)
  })

  it.each([
    ['no urls', { urls: [] }],
    ['too many urls', { urls: Array.from({ length: 51 }, (_, i) => `https://h${i}.example/`) }],
    ['a url that is far too long', { urls: [`https://x.example/${'a'.repeat(5000)}`] }],
    ['an unknown field', { urls: [URL_A], extra: true }],
    ['no body', {}],
  ])('refuses %s', async (_name, payload) => {
    expect((await post('/api/link-previews/resolve', payload, viewer)).statusCode).toBe(400)
  })
})

describe('POST /api/link-previews/refresh', () => {
  it('needs a session', async () => {
    expect((await post('/api/link-previews/refresh', { url: URL_A })).statusCode).toBe(401)
  })

  it('marks the stored preview stale while the refresh runs', async () => {
    const response = await post('/api/link-previews/refresh', { url: URL_A }, viewer)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ state: 'ready', preview: previewOf(URL_A), stale: true })
    await harness.drainOutbox()
  })

  it('refuses a URL that cannot be previewed', async () => {
    const response = await post('/api/link-previews/refresh', { url: 'nope' }, viewer)
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: { code: 'invalid_url' } })
  })

  it('refuses a link the organisation blocks', async () => {
    const response = await post(
      '/api/link-previews/refresh',
      { url: 'https://blocked.example/x' },
      viewer,
    )
    expect(response.statusCode).toBe(403)
  })

  it('tells a person who presses it too often to wait', async () => {
    allowRefresh.mockReturnValueOnce(false)
    const response = await post('/api/link-previews/refresh', { url: URL_A }, viewer)
    expect(response.statusCode).toBe(429)
  })
})
