import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ExternalSourceError } from '@quill/application'
import type { ExternalSource, OutboundHostPolicy } from '@quill/application'
import {
  createFakeClock,
  createFakeIdGenerator,
  createFakeSecretCipher,
  createInMemoryUnitOfWork,
} from '@quill/application/test-support'
import type { InMemoryUnitOfWork } from '@quill/application/test-support'
import type { GitCliExternalSourceOptions, SourceCredential } from '@quill/content-store'
import { userId, workspaceId } from '@quill/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setSecret } from '@quill/application'
import {
  createExternalSourceProvider,
  openedOnFirstUse,
  PREVIEW_LIMITS,
} from './external-source-provider.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const HANDBOOK = workspaceId('00000000-0000-4000-8000-000000000101')
const ADMIN = userId('00000000-0000-4000-8000-000000000001')
const POLICY: OutboundHostPolicy = { check: async () => ({ allowed: true }) }

let uow: InMemoryUnitOfWork
let secrets: Parameters<typeof setSecret>[0]

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  secrets = {
    uow,
    secrets: createFakeSecretCipher(),
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
  }
  await uow.repos.workspaces.create({
    id: HANDBOOK,
    unitId: 'acme',
    name: 'Handbook',
    slug: 'handbook',
    now: NOW,
  })
})

async function configure(credential: { username: string; secretName: string } | null = null) {
  await uow.repos.workspaceSources.put({
    workspaceId: HANDBOOK,
    remote: 'https://github.com/acme/handbook.git',
    branch: 'main',
    collections: [
      { collectionId: 'c-guides', path: 'docs/guides' },
      { collectionId: 'c-adr', path: 'docs/adr' },
    ],
    history: 'head',
    commitMessages: 'none',
    manifestEntry: null,
    credential,
    outsideLinks: 'forge',
    viewTemplate: null,
    webhookSecretName: null,
    configuredBy: ADMIN,
    now: NOW,
  })
}

/** A source whose every answer is canned, so a test sees what was opened and asked. */
function cannedSource(narrowed: (readonly string[])[] = []): ExternalSource {
  const change = { kind: 'removed', path: 'docs/a.md' } as const
  return {
    head: async () => 'h',
    fetch: async () => 'f',
    narrow: async (paths) => {
      narrowed.push(paths)
    },
    file: async (_revision, path) => ({ path, fileId: 'm', kind: 'file' }),
    async *files() {
      yield { path: 'docs/a.md', fileId: 'a', kind: 'file' }
    },
    async *readFiles() {
      yield { kind: 'too-large', fileId: 'a', size: 1 }
    },
    async *history() {
      yield {
        id: 'r1',
        author: { name: 'Ada', email: 'ada@example.com' },
        authoredAt: NOW,
        committedAt: NOW,
        subject: 'One',
      }
    },
    async *changes() {
      yield change
    },
    present: async (_revision, paths) => new Set(paths.slice(0, 1)),
  }
}

function provider(overrides: { egressProxy?: string; allowFileRemotesForTesting?: boolean } = {}) {
  const open = vi.fn<(options: GitCliExternalSourceOptions) => Promise<ExternalSource>>(async () =>
    cannedSource(),
  )
  return {
    open,
    sources: createExternalSourceProvider({
      secrets,
      outboundPolicy: POLICY,
      cacheRoot: join('cache', 'sources'),
      open,
      ...overrides,
    }),
  }
}

async function credentialOf(
  options: GitCliExternalSourceOptions | undefined,
): Promise<SourceCredential | null> {
  if (options?.credential === undefined) throw new Error('no credential callback')
  return await options.credential()
}

describe('the external source provider', () => {
  it('answers null for a workspace with no source, and opens nothing', async () => {
    const { sources, open } = provider()
    expect(await sources.forWorkspace(HANDBOOK)).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })

  it('gives the sync job its settings without opening the source', async () => {
    await configure()
    const { sources, open } = provider()
    const connected = await sources.forWorkspace(HANDBOOK)
    expect(connected?.settings).toEqual({
      collections: [
        { collectionId: 'c-guides', path: 'docs/guides' },
        { collectionId: 'c-adr', path: 'docs/adr' },
      ],
      history: 'head',
      commitMessages: 'none',
      manifestEntry: null,
    })
    expect(connected?.configuredAt).toEqual(NOW)
    expect(open).not.toHaveBeenCalled()
  })

  it('opens the adapter once, on first use, with the stored source', async () => {
    await configure()
    const { sources, open } = provider()
    const connected = await sources.forWorkspace(HANDBOOK)
    if (connected === null) throw new Error('not sourced')

    expect(await connected.source.head()).toBe('h')
    expect(await connected.source.fetch()).toBe('f')
    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0]?.[0]).toEqual({
      remote: 'https://github.com/acme/handbook.git',
      branch: 'main',
      paths: ['.quill/workspace.yaml'],
      strictPrefixes: false,
      cacheDirectory: join('cache', 'sources', HANDBOOK),
      outboundPolicy: POLICY,
      credential: expect.any(Function),
    })
    expect(await credentialOf(open.mock.calls[0]?.[0])).toBeNull()
  })

  it('passes the egress proxy and the test-only file remotes on when set', async () => {
    await configure()
    const { sources, open } = provider({
      egressProxy: 'http://proxy.internal:3128',
      allowFileRemotesForTesting: true,
    })
    await (await sources.forWorkspace(HANDBOOK))?.source.head()
    expect(open.mock.calls[0]?.[0]).toMatchObject({
      egressProxy: 'http://proxy.internal:3128',
      allowFileRemotesForTesting: true,
    })
  })

  it('reads the credential from the secrets store at each request', async () => {
    await configure({ username: 'x-access-token', secretName: 'sources/handbook' })
    await setSecret(secrets, { name: 'sources/handbook', value: 'first', actor: ADMIN })
    const { sources, open } = provider()
    await (await sources.forWorkspace(HANDBOOK))?.source.head()
    const options = open.mock.calls[0]?.[0]

    expect(await credentialOf(options)).toEqual({ username: 'x-access-token', password: 'first' })
    await setSecret(secrets, { name: 'sources/handbook', value: 'rotated', actor: ADMIN })
    expect(await credentialOf(options)).toEqual({ username: 'x-access-token', password: 'rotated' })
  })

  it('stops with credential-unavailable when the secret is gone or does not open', async () => {
    await configure({ username: 'x-access-token', secretName: 'sources/handbook' })
    const { sources, open } = provider()
    await (await sources.forWorkspace(HANDBOOK))?.source.head()
    const options = open.mock.calls[0]?.[0]

    const missing = credentialOf(options)
    await expect(missing).rejects.toBeInstanceOf(ExternalSourceError)
    await expect(missing).rejects.toMatchObject({
      reason: 'credential-unavailable',
      message: expect.stringContaining('not stored'),
    })

    await uow.repos.secrets.put({
      name: 'sources/handbook',
      ciphertext: 'sealed',
      wrappedKey: 'wrapped',
      keyId: 'lost',
      now: NOW,
    })
    await expect(credentialOf(options)).rejects.toMatchObject({
      reason: 'credential-unavailable',
      message: expect.stringContaining('does not open'),
    })
  })
})

describe('a draft opened for a preview', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'quill-draft-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function draftProvider() {
    const open = vi.fn<(options: GitCliExternalSourceOptions) => Promise<ExternalSource>>(
      async () => cannedSource(),
    )
    return {
      open,
      sources: createExternalSourceProvider({
        secrets,
        outboundPolicy: POLICY,
        cacheRoot: join(root, 'sources'),
        open,
      }),
    }
  }

  it('opens it in a directory of its own, with the preview’s limits, and removes the directory', async () => {
    await setSecret(secrets, { name: 'sources/handbook', value: 'token', actor: ADMIN })
    const { sources, open } = draftProvider()
    const credential = { username: 'x-access-token', secretName: 'sources/handbook' }
    let during: string[] = []

    const head = await sources.withDraft(
      { remote: 'https://github.com/acme/handbook.git', branch: 'main', credential },
      async (source) => {
        during = await readdir(join(root, 'sources'))
        return await source.head()
      },
    )

    expect(head).toBe('h')
    const options = open.mock.calls[0]?.[0]
    expect(options).toMatchObject({
      remote: 'https://github.com/acme/handbook.git',
      branch: 'main',
      paths: ['.quill/workspace.yaml'],
      ...PREVIEW_LIMITS,
    })
    expect(during).toEqual([expect.stringMatching(/^preview-/u)])
    expect(options?.cacheDirectory).toBe(join(root, 'sources', during[0] ?? ''))
    expect(await credentialOf(options)).toEqual({ username: 'x-access-token', password: 'token' })
    expect(await readdir(join(root, 'sources'))).toEqual([])
  })

  it('removes the directory when the preview fails', async () => {
    const { sources } = draftProvider()
    await expect(
      sources.withDraft(
        { remote: 'https://github.com/acme/handbook.git', branch: 'main', credential: null },
        async () => {
          throw new ExternalSourceError('timeout', 'too slow')
        },
      ),
    ).rejects.toMatchObject({ reason: 'timeout' })
    expect(await readdir(join(root, 'sources'))).toEqual([])
  })
})

async function all<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = []
  for await (const item of items) collected.push(item)
  return collected
}

describe('openedOnFirstUse', () => {
  it('passes every question through to the source it opens', async () => {
    const narrowed: (readonly string[])[] = []
    const open = vi.fn<() => Promise<ExternalSource>>(async () => cannedSource(narrowed))
    const source = openedOnFirstUse(open)
    expect(open).not.toHaveBeenCalled()

    await source.narrow(['docs'])
    expect(narrowed).toEqual([['docs']])
    expect(await source.file('r1', 'docs/a.md')).toEqual({
      path: 'docs/a.md',
      fileId: 'm',
      kind: 'file',
    })
    expect(await all(source.files('r1'))).toEqual([
      { path: 'docs/a.md', fileId: 'a', kind: 'file' },
    ])
    expect(await all(source.readFiles(['a']))).toEqual([
      { kind: 'too-large', fileId: 'a', size: 1 },
    ])
    expect((await all(source.history(null, 'r1'))).map(({ id }) => id)).toEqual(['r1'])
    expect(await all(source.changes(null, 'r1'))).toEqual([{ kind: 'removed', path: 'docs/a.md' }])
    expect([...(await source.present('r1', ['docs/a.md', 'docs/b.md']))]).toEqual(['docs/a.md'])
    expect(open).toHaveBeenCalledOnce()
  })

  it('fails each question with the reason the source would not open', async () => {
    const source = openedOnFirstUse(async () => {
      throw new ExternalSourceError('git-too-old', 'git 2.40 is older than 2.49')
    })
    await expect(source.head()).rejects.toMatchObject({ reason: 'git-too-old' })
  })
})
