import {
  FAILURE_REMEMBERED_FOR_MS,
  PREVIEW_FRESH_FOR_MS,
  REQUEST_IN_FLIGHT_FOR_MS,
  compileLinkPolicy,
  err,
  ok,
  userId,
} from '@quill/domain'
import type {
  CompiledLinkPolicy,
  LinkPreview,
  LinkPreviewFailure,
  LinkPreviewPolicy,
} from '@quill/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  LinkPreviewAudience,
  LinkPreviewRateLimits,
  LinkPreviewResolver,
} from '../ports/link-previews.ts'
import { PUBLIC_PREVIEW_SCOPE } from '../ports/link-previews.ts'
import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { LINK_PREVIEW_REQUESTED } from './events.ts'
import {
  LinkPreviewRetryLater,
  MAX_LINKS_PER_READ,
  fetchLinkPreview,
  getLinkPreviews,
  parseLinkPreviewRequested,
  peekLinkPreviews,
  refreshLinkPreview,
  storedPreviewReader,
} from './link-previews.ts'

const ADA = userId('00000000-0000-4000-8000-00000000000a')
const BOB = userId('00000000-0000-4000-8000-00000000000b')
const START = new Date('2026-10-13T09:00:00.000Z')
const URL_A = 'https://blog.example/post'

function compile(overrides: Partial<LinkPreviewPolicy> = {}): CompiledLinkPolicy {
  const compiled = compileLinkPolicy({ mode: 'rich', allow: [], block: [], ...overrides })
  if (!compiled.ok) throw new Error('policy did not compile')
  return compiled.value
}

function previewOf(url: string, overrides: Partial<LinkPreview> = {}): LinkPreview {
  return {
    url,
    canonicalUrl: url,
    title: 'A title',
    description: 'A description',
    siteName: 'Blog',
    kind: 'article',
    thumbnail: { hash: 'a'.repeat(64), width: 640, height: 336, mediaType: 'image/webp' },
    favicon: { hash: 'b'.repeat(64), width: 64, height: 64, mediaType: 'image/webp' },
    layer: 'open-graph',
    fetchedAt: START.toISOString(),
    ...overrides,
  }
}

function setUp() {
  const clock = createFakeClock(START)
  const uow = createInMemoryUnitOfWork()
  const people = new Map<string, LinkPreviewAudience>()
  const everyone: LinkPreviewAudience = { scope: PUBLIC_PREVIEW_SCOPE, policy: compile() }
  const resolve = vi.fn<LinkPreviewResolver['resolve']>(async (url) => ok(previewOf(url)))
  const limits: LinkPreviewRateLimits = {
    allowFetch: vi.fn<LinkPreviewRateLimits['allowFetch']>(() => ({ allowed: true })),
    allowRefresh: vi.fn<LinkPreviewRateLimits['allowRefresh']>(() => true),
    allowRead: vi.fn<LinkPreviewRateLimits['allowRead']>(() => true),
    allowQueued: vi.fn<LinkPreviewRateLimits['allowQueued']>((_userId, count) => count),
  }
  const deps = {
    uow,
    clock,
    ids: createFakeIdGenerator(),
    audiences: {
      forPerson: async (person: string) => people.get(person) ?? everyone,
      forPublic: async () => everyone,
    },
    resolver: { resolve },
    limits,
  }
  /** Events the consumer has already been given, so a fetch is not run twice. */
  const handled = new Set<string>()
  const pending = () =>
    uow.events.filter((event) => event.type === LINK_PREVIEW_REQUESTED && !handled.has(event.id))
  /** Runs every queued fetch, as the outbox consumer would. */
  async function drain() {
    const waiting = pending()
    for (const event of waiting) {
      handled.add(event.id)
      await fetchLinkPreview(deps, event.payload)
    }
    return waiting.length
  }
  return { ...deps, people, resolve, limits, drain, everyone, pending }
}

type Setup = ReturnType<typeof setUp>
let t: Setup
beforeEach(() => {
  t = setUp()
})

const read = (urls: readonly string[], who = ADA) => getLinkPreviews(t, { userId: who, urls })
const views = async (urls: readonly string[], who = ADA) =>
  (await read(urls, who)).map((r) => r.view)
const queued = () => t.pending()

describe('getLinkPreviews: a link nobody has asked for', () => {
  it('shows a plain link and queues one fetch', async () => {
    expect(await views([URL_A])).toEqual([{ state: 'pending' }])
    expect(queued()).toHaveLength(1)
    expect(parseLinkPreviewRequested(queued()[0]?.payload)).toMatchObject({
      url: URL_A,
      scope: PUBLIC_PREVIEW_SCOPE,
      requestedBy: ADA,
    })
  })

  it('never fetches while reading', async () => {
    await read([URL_A])
    expect(t.resolve).not.toHaveBeenCalled()
  })

  it('does not queue a second fetch while the first is in flight, however many readers ask', async () => {
    await read([URL_A])
    await read([URL_A], BOB)
    await read([URL_A])
    expect(queued()).toHaveLength(1)
  })

  it('asks again once a lost request has had time to be lost', async () => {
    await read([URL_A])
    t.clock.advance(REQUEST_IN_FLIGHT_FOR_MS + 1)
    await read([URL_A])
    expect(queued()).toHaveLength(2)
  })

  it('treats two spellings of one link as one, and keeps the order and the wording asked', async () => {
    const asked = [
      'https://Blog.example/post?utm_source=x#top',
      URL_A,
      'https://blog.example/other',
    ]
    const readings = await read(asked)
    expect(readings.map((reading) => reading.url)).toEqual(asked)
    expect(readings.map((reading) => reading.key)).toEqual([
      URL_A,
      URL_A,
      'https://blog.example/other',
    ])
    expect(queued()).toHaveLength(2)
  })

  it('reads at most the limit, in one lookup for the page', async () => {
    const many = Array.from({ length: MAX_LINKS_PER_READ + 20 }, (_, i) => `https://h${i}.example/`)
    const find = vi.spyOn(t.uow.repos.linkPreviews, 'findMany')
    expect(await read(many)).toHaveLength(MAX_LINKS_PER_READ)
    expect(find).toHaveBeenCalledOnce()
  })

  it('answers invalid for what is not a previewable URL, without queueing anything', async () => {
    expect(await views(['not a url', 'ftp://x.example/', 'https://u:p@x.example/'])).toEqual([
      { state: 'unavailable', reason: 'invalid_url' },
      { state: 'unavailable', reason: 'invalid_url' },
      { state: 'unavailable', reason: 'invalid_url' },
    ])
    expect(queued()).toHaveLength(0)
  })
})

describe('fetching and then reading', () => {
  it('stores what the resolver found, and the next read shows it, fresh', async () => {
    await read([URL_A])
    expect(await t.drain()).toBe(1)
    expect(t.resolve).toHaveBeenCalledWith(URL_A, { policy: t.everyone.policy })
    expect(await views([URL_A])).toEqual([
      { state: 'ready', preview: previewOf(URL_A), stale: false },
    ])
    expect(queued()).toHaveLength(0)
  })

  it('shows a stored preview to every reader, from one fetch', async () => {
    await read([URL_A])
    await t.drain()
    expect(await views([URL_A], BOB)).toMatchObject([{ state: 'ready' }])
    expect(t.resolve).toHaveBeenCalledOnce()
  })

  it('serves a stale preview while it queues a refresh, and replaces it when the refresh lands', async () => {
    await read([URL_A])
    await t.drain()
    t.clock.advance(PREVIEW_FRESH_FOR_MS)
    t.resolve.mockResolvedValueOnce(ok(previewOf(URL_A, { title: 'Newer' })))
    expect(await views([URL_A])).toMatchObject([
      { state: 'ready', stale: true, preview: { title: 'A title' } },
    ])
    expect(queued()).toHaveLength(1)
    await t.drain()
    expect(await views([URL_A])).toMatchObject([
      { state: 'ready', stale: false, preview: { title: 'Newer' } },
    ])
  })

  it('keeps showing the last good preview when a refresh fails, and stops asking for an hour', async () => {
    await read([URL_A])
    await t.drain()
    t.clock.advance(PREVIEW_FRESH_FOR_MS)
    await read([URL_A])
    t.resolve.mockResolvedValueOnce(err('unreachable'))
    await t.drain()
    expect(await views([URL_A])).toMatchObject([
      { state: 'ready', stale: true, preview: { title: 'A title' } },
    ])
    expect(queued()).toHaveLength(0)

    t.clock.advance(FAILURE_REMEMBERED_FOR_MS)
    await read([URL_A])
    expect(queued()).toHaveLength(1)
  })

  it.each<LinkPreviewFailure>(['unreachable', 'not_a_page', 'no_metadata', 'blocked'])(
    'remembers a %s failure for an hour, then tries again',
    async (failure) => {
      t.resolve.mockResolvedValue(err(failure))
      await read([URL_A])
      await t.drain()
      expect(await views([URL_A])).toEqual([{ state: 'unavailable', reason: failure }])
      expect(queued()).toHaveLength(0)

      t.clock.advance(FAILURE_REMEMBERED_FOR_MS - 1)
      expect(await views([URL_A])).toEqual([{ state: 'unavailable', reason: failure }])
      expect(queued()).toHaveLength(0)

      t.clock.advance(1)
      expect(await views([URL_A])).toEqual([{ state: 'pending' }])
      expect(queued()).toHaveLength(1)
    },
  )

  it('does not store, and does retry, when the fetcher was busy or a limit was hit', async () => {
    await read([URL_A])
    t.resolve.mockResolvedValueOnce(err('busy'))
    await expect(fetchLinkPreview(t, queued()[0]?.payload)).rejects.toBeInstanceOf(
      LinkPreviewRetryLater,
    )
    expect(await views([URL_A])).toEqual([{ state: 'pending' }])

    vi.mocked(t.limits.allowFetch).mockReturnValueOnce({ allowed: false, retryAfterMs: 1500 })
    await expect(fetchLinkPreview(t, queued()[0]?.payload)).rejects.toMatchObject({
      message: expect.stringContaining('rate limit'),
      retryAfterMs: 1500,
    })
    expect(t.resolve).toHaveBeenCalledOnce()
  })

  it('rate-limits by the host and the scope of the link', async () => {
    await read([URL_A])
    await t.drain()
    expect(t.limits.allowFetch).toHaveBeenCalledWith({
      host: 'blog.example',
      scope: PUBLIC_PREVIEW_SCOPE,
    })
  })

  it('leaves an event it cannot read, or a URL it cannot use, alone', async () => {
    await fetchLinkPreview(t, { version: 99, url: URL_A })
    await fetchLinkPreview(t, 'nonsense')
    await fetchLinkPreview(t, { version: 1, url: 'not a url', scope: 'public', requestedBy: ADA })
    expect(t.resolve).not.toHaveBeenCalled()
  })

  it('fetches again, rather than failing, when a stored row is in a format this release cannot read', async () => {
    await t.uow.repos.linkPreviews.putReady({
      scope: PUBLIC_PREVIEW_SCOPE,
      key: URL_A,
      document: { version: 2, somethingNew: true },
      now: START,
    })
    expect(await views([URL_A])).toEqual([{ state: 'pending' }])
    expect(queued()).toHaveLength(1)
  })
})

describe('organisation policy at read time', () => {
  async function stored(url = URL_A) {
    await read([url])
    await t.drain()
  }

  it('shows plain links and queues nothing when previews are off', async () => {
    t.people.set(ADA, { scope: 'org:a', policy: compile({ mode: 'off' }) })
    expect(await views([URL_A])).toEqual([{ state: 'blocked' }])
    expect(queued()).toHaveLength(0)
  })

  it('hides a stored preview of a host the viewing organisation has blocked', async () => {
    await stored()
    t.people.set(BOB, { scope: 'org:b', policy: compile({ block: ['blog.example'] }) })
    expect(await views([URL_A], BOB)).toEqual([{ state: 'blocked' }])
  })

  it('applies a policy change at once, without waiting for a refresh', async () => {
    await stored()
    expect(await views([URL_A], BOB)).toMatchObject([{ state: 'ready' }])
    t.people.set(BOB, { scope: 'org:b', policy: compile({ block: ['blog.example/post'] }) })
    expect(await views([URL_A], BOB)).toEqual([{ state: 'blocked' }])
  })

  it('shows only the words in text mode, though the stored preview has pictures', async () => {
    t.people.set(BOB, { scope: 'org:b', policy: compile({ mode: 'text' }) })
    await read([URL_A], BOB)
    await t.drain()
    expect(await views([URL_A], BOB)).toMatchObject([
      { state: 'ready', preview: { title: 'A title', thumbnail: null, favicon: null } },
    ])
  })

  it('refuses an allow-list organisation anything off its list', async () => {
    t.people.set(ADA, { scope: 'org:a', policy: compile({ allow: ['docs.example'] }) })
    expect(await views([URL_A, 'https://docs.example/x'])).toEqual([
      { state: 'blocked' },
      { state: 'pending' },
    ])
  })
})

describe('scopes: a restrictive organisation keeps its own previews', () => {
  const restricted: LinkPreviewAudience = {
    scope: 'org:a',
    policy: compile({ allow: ['blog.example'] }),
  }

  it("fetches under the asker's policy and stores in the asker's scope", async () => {
    t.people.set(ADA, restricted)
    await read([URL_A])
    expect(parseLinkPreviewRequested(queued()[0]?.payload)?.scope).toBe('org:a')
    await t.drain()
    expect(t.resolve).toHaveBeenCalledWith(URL_A, { policy: restricted.policy })
    expect(await t.uow.repos.linkPreviews.findMany(['org:a'], [URL_A])).toHaveLength(1)
    expect(await t.uow.repos.linkPreviews.findMany([PUBLIC_PREVIEW_SCOPE], [URL_A])).toHaveLength(0)
  })

  it('does not hand a private preview to anyone else', async () => {
    t.people.set(ADA, restricted)
    await read([URL_A])
    await t.drain()
    expect(await views([URL_A], BOB)).toEqual([{ state: 'pending' }])
  })

  it('never shows a preview fetched under a looser policy, and fetches its own', async () => {
    // Bob is under the default policy; his fetch is stored in the shared scope.
    t.resolve.mockResolvedValueOnce(ok(previewOf(URL_A, { title: 'Found under the loose policy' })))
    await read([URL_A], BOB)
    await t.drain()
    expect(await views([URL_A], BOB)).toMatchObject([{ state: 'ready' }])

    // Ada's policy is stricter, so what the loose fetch found is not hers to be shown.
    t.people.set(ADA, restricted)
    expect(await views([URL_A], ADA)).toEqual([{ state: 'pending' }])
    expect(queued()).toHaveLength(1)

    t.resolve.mockResolvedValueOnce(ok(previewOf(URL_A, { title: 'Under my policy' })))
    await t.drain()
    expect(await views([URL_A], ADA)).toMatchObject([{ preview: { title: 'Under my policy' } }])
    expect(await views([URL_A], BOB)).toMatchObject([
      { preview: { title: 'Found under the loose policy' } },
    ])
  })

  it('does not show a preview fetched under a looser policy when the policy is tightened later', async () => {
    await read([URL_A])
    await t.drain()
    expect(await views([URL_A])).toMatchObject([{ state: 'ready' }])
    t.people.set(ADA, { scope: 'org:tight', policy: compile({ mode: 'text' }) })
    expect(await views([URL_A])).toEqual([{ state: 'pending' }])
  })

  it('stores a late fetch under the policy in force when it ran, not the one it was queued under', async () => {
    await read([URL_A])
    t.people.set(ADA, restricted)
    await t.drain()
    expect(t.resolve).toHaveBeenCalledWith(URL_A, { policy: restricted.policy })
    expect(await t.uow.repos.linkPreviews.findMany([PUBLIC_PREVIEW_SCOPE], [URL_A])).toHaveLength(
      1,
    )
    expect(
      (await t.uow.repos.linkPreviews.findMany(['org:a'], [URL_A])).filter(
        (row) => row.state === 'ready',
      ),
    ).toHaveLength(1)
    // The shared scope still only holds the pending mark the original request left.
    expect(
      (await t.uow.repos.linkPreviews.findMany([PUBLIC_PREVIEW_SCOPE], [URL_A]))[0]?.state,
    ).not.toBe('ready')
  })
})

describe('refreshLinkPreview', () => {
  it('queues a fetch even for a link that failed a moment ago', async () => {
    t.resolve.mockResolvedValueOnce(err('unreachable'))
    await read([URL_A])
    await t.drain()
    expect(await views([URL_A])).toEqual([{ state: 'unavailable', reason: 'unreachable' }])

    expect(await refreshLinkPreview(t, { userId: ADA, url: URL_A })).toEqual(
      ok({ state: 'pending' }),
    )
    expect(queued()).toHaveLength(1)
  })

  it('answers with the preview it already has, marked stale, while the refresh runs', async () => {
    await read([URL_A])
    await t.drain()
    const result = await refreshLinkPreview(t, { userId: ADA, url: URL_A })
    expect(result).toEqual(ok({ state: 'ready', preview: previewOf(URL_A), stale: true }))
    expect(queued()).toHaveLength(1)
  })

  it('queues one fetch however often it is pressed', async () => {
    await refreshLinkPreview(t, { userId: ADA, url: URL_A })
    await refreshLinkPreview(t, { userId: ADA, url: URL_A })
    expect(queued()).toHaveLength(1)
  })

  it('is limited per person, and says so', async () => {
    vi.mocked(t.limits.allowRefresh).mockReturnValueOnce(false)
    expect(await refreshLinkPreview(t, { userId: ADA, url: URL_A })).toEqual(err('rate_limited'))
    expect(queued()).toHaveLength(0)
    expect(t.limits.allowRefresh).toHaveBeenCalledWith(ADA)
  })

  it('refuses a URL that cannot be previewed, and one the policy blocks, before counting against the limit', async () => {
    expect(await refreshLinkPreview(t, { userId: ADA, url: 'nope' })).toEqual(err('invalid_url'))
    t.people.set(ADA, { scope: 'org:a', policy: compile({ block: ['blog.example'] }) })
    expect(await refreshLinkPreview(t, { userId: ADA, url: URL_A })).toEqual(err('blocked'))
    expect(t.limits.allowRefresh).not.toHaveBeenCalled()
  })

  it("does not show a blocked preview's pictures to a text-only organisation", async () => {
    t.people.set(BOB, { scope: 'org:b', policy: compile({ mode: 'text' }) })
    await read([URL_A], BOB)
    await t.drain()
    const result = await refreshLinkPreview(t, { userId: BOB, url: URL_A })
    expect(result).toMatchObject({
      ok: true,
      value: { preview: { thumbnail: null, favicon: null } },
    })
  })
})

describe('the queue event', () => {
  const full = { version: 1, url: URL_A, scope: 'public', requestedBy: ADA }

  it('reads a complete payload', () => {
    expect(parseLinkPreviewRequested(full)).toEqual(full)
  })

  it.each([
    ['a missing url', { ...full, url: undefined }],
    ['a missing scope', { ...full, scope: undefined }],
    ['a missing requester', { ...full, requestedBy: undefined }],
    ['a later version', { ...full, version: 2 }],
    ['nothing', null],
  ])('reads %s as nothing, so the consumer leaves it alone', (_name, payload) => {
    expect(parseLinkPreviewRequested(payload)).toBeNull()
  })
})

describe('the stored format', () => {
  it('round-trips a preview through its versioned document', async () => {
    await read([URL_A])
    await t.drain()
    const [row] = await t.uow.repos.linkPreviews.findMany([PUBLIC_PREVIEW_SCOPE], [URL_A])
    expect(row?.document).toMatchObject({ version: 1, title: 'A title' })
    expect(storedPreviewReader.read(row?.document)).toEqual(previewOf(URL_A))
  })

  it.each([
    ['a newer version', { version: 2 }],
    ['no version', { title: 'x' }],
    ['not an object', 'text'],
    ['an array', []],
    [
      'a missing title',
      {
        version: 1,
        url: 'u',
        canonicalUrl: 'u',
        kind: 'article',
        layer: 'page',
        fetchedAt: 'x',
        thumbnail: null,
        favicon: null,
      },
    ],
    ['an unknown kind', { ...previewOf(URL_A), version: 1, kind: 'podcast' }],
    ['an unknown layer', { ...previewOf(URL_A), version: 1, layer: 'psychic' }],
    ['a malformed image', { ...previewOf(URL_A), version: 1, thumbnail: { hash: 1 } }],
    ['an image that is not an object', { ...previewOf(URL_A), version: 1, favicon: 'x' }],
  ])('reads %s as nothing, so the link is fetched again', (_name, document) => {
    expect(storedPreviewReader.read(document)).toBeNull()
  })

  it('reads the optional extensions of a preview, and a preview without them as it always was', () => {
    const extended = {
      ...previewOf(URL_A),
      version: 1,
      status: { label: 'Merged', tone: 'success' },
      embed: { provider: 'example', src: 'https://player.example/v/1', aspectRatio: 1.78 },
      file: { mediaType: 'application/pdf', bytes: 1024, name: 'spec.pdf' },
    }
    expect(storedPreviewReader.read(extended)).toMatchObject({
      status: { label: 'Merged', tone: 'success' },
      embed: { provider: 'example', src: 'https://player.example/v/1', aspectRatio: 1.78 },
      file: { mediaType: 'application/pdf', bytes: 1024, name: 'spec.pdf' },
    })
    expect(storedPreviewReader.read({ ...previewOf(URL_A), version: 1 })).toEqual(previewOf(URL_A))
  })

  it('leaves out an extension that is malformed, without losing the preview', () => {
    const read = storedPreviewReader.read({
      ...previewOf(URL_A),
      version: 1,
      status: { label: 'Merged', tone: 'purple' },
      embed: { provider: 'x', src: 'https://x.example', aspectRatio: 0 },
      file: 'pdf',
    })
    expect(read).toEqual(previewOf(URL_A))
  })

  it('accepts a preview with no description, site name or images', () => {
    const bare = {
      ...previewOf(URL_A),
      version: 1,
      description: null,
      siteName: null,
      thumbnail: null,
      favicon: null,
    }
    expect(storedPreviewReader.read(bare)).toMatchObject({
      description: null,
      siteName: null,
      thumbnail: null,
    })
  })

  it('works out when to retry a failure from when it happened, if the row says nothing', async () => {
    const legacy = {
      scope: PUBLIC_PREVIEW_SCOPE,
      key: URL_A,
      state: 'failed' as const,
      document: null,
      failure: 'not_a_page',
      fetchedAt: START,
      requestedAt: null,
      retryAfter: null,
    }
    vi.spyOn(t.uow.repos.linkPreviews, 'findMany').mockResolvedValue([legacy])
    expect(await views([URL_A])).toEqual([{ state: 'unavailable', reason: 'not_a_page' }])
    t.clock.advance(FAILURE_REMEMBERED_FOR_MS)
    expect(await views([URL_A])).toEqual([{ state: 'pending' }])
  })

  it('reads an unknown failure as unreachable', async () => {
    await t.uow.repos.linkPreviews.putFailure({
      scope: PUBLIC_PREVIEW_SCOPE,
      key: URL_A,
      failure: 'from-the-future',
      now: START,
    })
    expect(await views([URL_A])).toEqual([{ state: 'unavailable', reason: 'unreachable' }])
  })

  it('lets a pending request in the shared scope say nothing to a private one', async () => {
    await read([URL_A], BOB)
    t.people.set(ADA, { scope: 'org:a', policy: compile({ allow: ['blog.example'] }) })
    expect(await views([URL_A])).toEqual([{ state: 'pending' }])
    expect(queued()).toHaveLength(2)
  })

  it('does not carry a shared failure over to a private audience, whose policy may fetch differently', async () => {
    t.resolve.mockResolvedValueOnce(err('not_a_page'))
    await read([URL_A], BOB)
    await t.drain()
    t.people.set(ADA, { scope: 'org:a', policy: compile({ allow: ['blog.example'] }) })
    expect(await views([URL_A])).toEqual([{ state: 'pending' }])
  })
})

describe('rationing what a person can cause', () => {
  it('queues only as many new fetches as the person’s allowance holds, and shows the rest as pending', async () => {
    vi.mocked(t.limits.allowQueued).mockReturnValueOnce(3)
    const shown = (await read(manyLinks(10))).map((reading) => reading.view)
    expect(shown).toEqual(Array.from({ length: 10 }, () => ({ state: 'pending' })))
    expect(queued()).toHaveLength(3)
    expect(t.limits.allowQueued).toHaveBeenCalledWith(ADA, 10)
  })

  it('queues the rest on a later read, once the allowance has come back', async () => {
    vi.mocked(t.limits.allowQueued).mockReturnValueOnce(2)
    await read(manyLinks(5))
    expect(queued()).toHaveLength(2)
    await read(manyLinks(5))
    expect(queued()).toHaveLength(5)
  })

  it('queues nothing, and asks the database nothing, when the allowance is spent', async () => {
    vi.mocked(t.limits.allowQueued).mockReturnValueOnce(0)
    const request = vi.spyOn(t.uow.repos.linkPreviews, 'requestFetch')
    await read(manyLinks(4))
    expect(queued()).toHaveLength(0)
    expect(request).not.toHaveBeenCalled()
  })

  it('does not spend any of it on links that need no fetch', async () => {
    await read([URL_A])
    await t.drain()
    vi.mocked(t.limits.allowQueued).mockClear()
    await read([URL_A])
    expect(t.limits.allowQueued).not.toHaveBeenCalled()
  })

  it('writes the outbox events for a page of new links in one call', async () => {
    const writeMany = vi.spyOn(t.uow.repos.outbox, 'writeMany')
    await read(manyLinks(20))
    expect(writeMany).toHaveBeenCalledOnce()
    expect(writeMany.mock.calls[0]?.[0]).toHaveLength(20)
  })
})

const publicAudience = (policy = compile()): LinkPreviewAudience => ({
  scope: PUBLIC_PREVIEW_SCOPE,
  policy,
})

describe('peekLinkPreviews: a read that can never cause a fetch', () => {
  const peek = (urls: readonly string[], who = publicAudience()) =>
    peekLinkPreviews(t, { audience: who, urls })

  it('shows a stored preview', async () => {
    await read([URL_A])
    await t.drain()
    expect((await peek([URL_A])).map((reading) => reading.view)).toMatchObject([{ state: 'ready' }])
  })

  it('shows a plain link for one nobody has previewed, and queues nothing, however often it is asked', async () => {
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- the same page opened again and again.
      expect((await peek([URL_A])).map((reading) => reading.view)).toEqual([{ state: 'pending' }])
    }
    expect(queued()).toHaveLength(0)
    expect(await t.uow.repos.linkPreviews.findMany(['public'], [URL_A])).toEqual([])
  })

  it('does not even ask the limits, since it spends nothing', async () => {
    await peek(manyLinks(5))
    expect(t.limits.allowQueued).not.toHaveBeenCalled()
    expect(t.limits.allowRead).not.toHaveBeenCalled()
  })

  it('does not queue a stale preview’s refresh either', async () => {
    await read([URL_A])
    await t.drain()
    t.clock.advance(PREVIEW_FRESH_FOR_MS)
    expect((await peek([URL_A])).map((reading) => reading.view)).toMatchObject([
      { state: 'ready', stale: true },
    ])
    expect(queued()).toHaveLength(0)
  })

  it('applies the audience’s policy like any other read', async () => {
    await read([URL_A])
    await t.drain()
    const strict = publicAudience(compile({ block: ['blog.example'] }))
    expect((await peek([URL_A], strict)).map((reading) => reading.view)).toEqual([
      { state: 'blocked' },
    ])
    const textOnly = publicAudience(compile({ mode: 'text' }))
    expect((await peek([URL_A], textOnly)).map((reading) => reading.view)).toMatchObject([
      { state: 'ready', preview: { thumbnail: null, favicon: null } },
    ])
  })
})

function manyLinks(count: number) {
  return Array.from({ length: count }, (_, i) => `https://h${i}.example/`)
}

describe('which pictures are shown', () => {
  const HASH = 'a'.repeat(64)
  const thumbnail = { hash: HASH, width: 1, height: 1, mediaType: 'image/webp' }

  it('knows the thumbnail and the icon of a stored preview, and nothing else', async () => {
    const { linkPreviews } = t.uow.repos
    await linkPreviews.putReady({
      scope: 'public',
      key: URL_A,
      document: {
        version: 1,
        ...previewOf(URL_A, { thumbnail, favicon: { ...thumbnail, hash: 'b'.repeat(64) } }),
      },
      now: START,
    })
    expect(await linkPreviews.isImageReferenced(HASH)).toBe(true)
    expect(await linkPreviews.isImageReferenced('b'.repeat(64))).toBe(true)
    expect(await linkPreviews.isImageReferenced('c'.repeat(64))).toBe(false)
  })

  it('does not take a hash written in the text of a preview for a picture', async () => {
    await t.uow.repos.linkPreviews.putReady({
      scope: 'public',
      key: URL_A,
      document: {
        version: 1,
        ...previewOf(URL_A, { title: HASH, thumbnail: null, favicon: null }),
      },
      now: START,
    })
    expect(await t.uow.repos.linkPreviews.isImageReferenced(HASH)).toBe(false)
  })

  it('does not know a picture of a row that holds no preview, or a document that is not one', async () => {
    await t.uow.repos.linkPreviews.putFailure({
      scope: 'public',
      key: URL_A,
      failure: 'unreachable',
      now: START,
    })
    await t.uow.repos.linkPreviews.putReady({
      scope: 'public',
      key: 'https://b.example/',
      document: 'not an object',
      now: START,
    })
    expect(await t.uow.repos.linkPreviews.isImageReferenced(HASH)).toBe(false)
  })
})
