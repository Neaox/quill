import { createLinkConnectorRegistry } from '@quill/application'
import type {
  ConnectorCredentialSource,
  ConnectorDraft,
  ConnectorFailure,
  LinkConnector,
} from '@quill/application'
import { createFakeClock } from '@quill/application/test-support'
import { compileLinkPolicy, createEmbedRegistry, err, ok } from '@quill/domain'
import type { CompiledLinkPolicy, LinkPreviewPolicy } from '@quill/domain'
import { describe, expect, it, vi } from 'vitest'

import type { OpenWebReader, OpenWebResponse } from '../http/open-web-client.ts'
import { OutboundRequestError } from '../http/outbound-client.ts'
import type { ImageIngestor } from './image-ingestor.ts'
import { createLinkPreviewProvider } from './link-preview-provider.ts'
import { createOembedRegistry } from './oembed-registry.ts'

/**
 * Layer 1 of the resolution (ADR-042): a connector is asked before any page is read, a
 * failure falls through to the page layers, and the three outcomes that are not failures
 * (restricted, rate limited, forbidden by policy) never do.
 */

const NOW = new Date('2026-10-13T09:00:00.000Z')
const REPO_URL = 'https://github.com/octocat/Hello-World'
const REGISTRY = createOembedRegistry([])

const PAGE: OpenWebResponse = {
  status: 200,
  url: REPO_URL,
  mediaType: 'text/html',
  charset: null,
  body: new TextEncoder().encode(
    '<title>octocat/Hello-World</title><meta name="description" content="From the page">',
  ),
  truncated: false,
}

const draft: ConnectorDraft = {
  canonicalUrl: REPO_URL,
  title: 'octocat/Hello-World',
  description: 'My first repository',
  siteName: 'GitHub',
  kind: 'repository',
  imageUrl: 'https://avatars.githubusercontent.com/u/583231',
  status: { label: 'Open', tone: 'success' },
}

function compile(policy: LinkPreviewPolicy): CompiledLinkPolicy {
  const compiled = compileLinkPolicy(policy)
  if (!compiled.ok) throw new Error('policy did not compile')
  return compiled.value
}

function setUp(
  resolveConnector: LinkConnector['resolve'],
  options: { credentials?: ConnectorCredentialSource; matches?: boolean } = {},
) {
  const get = vi.fn<OpenWebReader['get']>(async (request) => {
    if (request.url !== REPO_URL) throw new OutboundRequestError('dns_failure', 'no route')
    return PAGE
  })
  const ingest = vi.fn<ImageIngestor['ingest']>(async (url) => ({
    hash: `hash:${url}`,
    width: 460,
    height: 460,
    mediaType: 'image/webp',
  }))
  const connector: LinkConnector = {
    id: 'test',
    hosts: ['github.com'],
    secretName: 'connectors/test/token',
    matches: () => options.matches ?? true,
    resolve: vi.fn<LinkConnector['resolve']>(resolveConnector),
  }
  const provider = createLinkPreviewProvider({
    reader: { get },
    images: { ingest },
    oembed: REGISTRY,
    embeds: createEmbedRegistry([]),
    clock: createFakeClock(NOW),
    connectors: createLinkConnectorRegistry([connector]),
    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
  })
  return {
    provider,
    connector,
    ingest,
    asked: () => get.mock.calls.map(([request]) => request.url),
  }
}

describe('resolve: connectors, layer 1', () => {
  it('answers from the connector with its layer, status and picture, without fetching the page', async () => {
    const t = setUp(async () => ok(draft))
    expect(await t.provider.resolve(REPO_URL)).toEqual({
      ok: true,
      value: {
        url: REPO_URL,
        canonicalUrl: REPO_URL,
        title: 'octocat/Hello-World',
        description: 'My first repository',
        siteName: 'GitHub',
        kind: 'repository',
        thumbnail: expect.objectContaining({
          hash: 'hash:https://avatars.githubusercontent.com/u/583231',
        }),
        favicon: null,
        layer: 'connector',
        fetchedAt: '2026-10-13T09:00:00.000Z',
        status: { label: 'Open', tone: 'success' },
      },
    })
    expect(t.asked()).toEqual([])
  })

  it('carries a code snippet through', async () => {
    const code = {
      language: 'typescript',
      startLine: 3,
      lines: ['a', 'b'],
      path: 'a.ts',
      repository: 'o/r',
    }
    const t = setUp(async () => ok({ ...draft, imageUrl: null, code }))
    const result = await t.provider.resolve(REPO_URL)
    expect(result.ok && result.value.code).toEqual(code)
    expect(t.ingest).not.toHaveBeenCalled()
  })

  it.each<ConnectorFailure>([{ kind: 'not_found' }, { kind: 'unavailable' }])(
    'falls through to the page layers when the connector says %j, and shows no error',
    async (failure) => {
      const t = setUp(async () => err(failure))
      const result = await t.provider.resolve(REPO_URL)
      expect(result.ok && result.value).toMatchObject({
        layer: 'page',
        title: 'octocat/Hello-World',
      })
      expect(t.asked()).toEqual([REPO_URL])
    },
  )

  it('falls through when the connector breaks its promise and throws', async () => {
    const t = setUp(async () => {
      throw new Error('boom')
    })
    const result = await t.provider.resolve(REPO_URL)
    expect(result.ok && result.value.layer).toBe('page')
  })

  it('makes no preview of restricted content, and does not read the page either', async () => {
    const t = setUp(async () => err({ kind: 'restricted' }))
    expect(await t.provider.resolve(REPO_URL)).toEqual({ ok: false, error: 'restricted' })
    expect(t.asked()).toEqual([])
  })

  it('defers, rather than fails or falls through, when the connector is rate limited', async () => {
    const t = setUp(async () => err({ kind: 'rate_limited', retryAfterMs: 90_000 }))
    await expect(t.provider.resolve(REPO_URL)).rejects.toMatchObject({
      name: 'LinkPreviewRetryLater',
      retryAfterMs: 90_000,
    })
    expect(t.asked()).toEqual([])
  })

  it('does not ask a connector about a link the organisation’s policy forbids', async () => {
    const t = setUp(async () => ok(draft))
    const policy = compile({ mode: 'rich', allow: [], block: ['github.com'] })
    expect(await t.provider.resolve(REPO_URL, { policy })).toEqual({ ok: false, error: 'blocked' })
    expect(t.connector.resolve).not.toHaveBeenCalled()
  })

  it('does not fetch the connector’s picture for a text-only organisation, and keeps the text', async () => {
    const t = setUp(async () => ok(draft))
    const policy = compile({ mode: 'text', allow: [], block: [] })
    const result = await t.provider.resolve(REPO_URL, { policy })
    expect(result.ok && result.value).toMatchObject({ layer: 'connector', thumbnail: null })
    expect(t.ingest).not.toHaveBeenCalled()
  })

  it('does not use a connector for a link it does not claim', async () => {
    const t = setUp(async () => ok(draft), { matches: false })
    const result = await t.provider.resolve(REPO_URL)
    expect(result.ok && result.value.layer).toBe('page')
    expect(t.connector.resolve).not.toHaveBeenCalled()
  })

  it('gives the connector the credentials from the source at the moment of use', async () => {
    const forConnector = vi.fn<ConnectorCredentialSource['forConnector']>(async () => ({
      token: 't0ken',
    }))
    const t = setUp(async () => ok(draft), { credentials: { forConnector } })
    await t.provider.resolve(REPO_URL)
    const [url, credentials, signal] = vi.mocked(t.connector.resolve).mock.calls[0] ?? []
    expect(url?.href).toBe(REPO_URL)
    expect(credentials).toEqual({ token: 't0ken' })
    expect(signal?.aborted).toBe(false)
    expect(forConnector).toHaveBeenCalledWith(expect.objectContaining({ id: 'test' }))
  })

  it.each([
    ['no credentials source', undefined],
    ['a source with none stored', { forConnector: async () => null }],
    [
      'a source that fails',
      {
        forConnector: async (): Promise<null> => {
          throw new Error('database down')
        },
      },
    ],
  ])('works anonymously with %s', async (_name, credentials) => {
    const t = setUp(async () => ok(draft), credentials === undefined ? {} : { credentials })
    await t.provider.resolve(REPO_URL)
    expect(vi.mocked(t.connector.resolve).mock.calls[0]?.[1]).toBeNull()
  })

  it('hands the connector a signal that ends the call when its time is up', async () => {
    vi.useFakeTimers()
    try {
      let seen: AbortSignal | undefined
      // A connector that waits on a slow API until it is told to stop.
      const t = setUp(
        (_url, _credentials, signal) =>
          new Promise((resolve) => {
            seen = signal
            signal.addEventListener('abort', () => {
              resolve(err({ kind: 'unavailable' }))
            })
          }),
      )
      const pending = t.provider.resolve(REPO_URL)
      await vi.advanceTimersByTimeAsync(20_000)
      await pending
      expect(seen?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
