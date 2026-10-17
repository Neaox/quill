import { readFileSync } from 'node:fs'

import { createFakeClock } from '@quill/application/test-support'
import type { ConnectorCredentials } from '@quill/application'
import { CODE_SNIPPET_MAX_LINES } from '@quill/domain'
import { beforeEach, describe, expect, it } from 'vitest'

import { OutboundRequestError } from '../../http/outbound-client.ts'
import type {
  OutboundReader,
  OutboundRequest,
  OutboundResponse,
} from '../../http/outbound-client.ts'
import { createGitHubConnector } from './github-connector.ts'

const fixtureText = (name: string) =>
  readFileSync(new URL(`./__fixtures__/github/${name}.json`, import.meta.url), 'utf8')
const fixture = (name: string): unknown => JSON.parse(fixtureText(name))

/** A right-to-left override: invisible, and able to make code read as something it is not. */
const RLO = String.fromCodePoint(0x202e)
/** Control characters, named, so that this file holds none of them. */
const NUL = String.fromCodePoint(0)
const BELL = String.fromCodePoint(7)
const ESC = String.fromCodePoint(0x1b)
const NOW = new Date('2026-10-17T10:00:00.000Z')
const TOKEN: ConnectorCredentials = { token: 'ghp_SECRET_TOKEN_VALUE' }
const SHA = 'e9c026c611c1160eaad50da00be4e676b626018f'
const NEVER_ABORTED = new AbortController().signal

type Reply = OutboundResponse | (() => OutboundResponse) | Error

const json = (
  body: unknown,
  headers: Record<string, string> = {},
  status = 200,
): OutboundResponse => ({
  status,
  body: typeof body === 'string' ? body : JSON.stringify(body),
  headers,
})
const failure = (status: number, headers: Record<string, string> = {}) =>
  json({ message: 'nope' }, headers, status)

function setUp() {
  const clock = createFakeClock(NOW)
  const replies = new Map<string, Reply>()
  const requests: OutboundRequest[] = []
  const client: OutboundReader = {
    async get(request) {
      requests.push(request)
      const path = new URL(request.url).pathname + new URL(request.url).search
      const reply = replies.get(path)
      if (reply === undefined) throw new Error(`unexpected request: ${request.url}`)
      if (reply instanceof Error) throw reply
      return typeof reply === 'function' ? reply() : reply
    },
  }
  const connector = createGitHubConnector({
    client,
    clock,
    userAgent: 'QuillBot/1 (+https://quill.example/bot)',
  })
  const reply = (path: string, response: Reply) => replies.set(path, response)
  const resolve = (
    url: string,
    credentials: ConnectorCredentials | null = TOKEN,
    signal = NEVER_ABORTED,
  ) => connector.resolve(new URL(url), credentials, signal)
  return { connector, clock, reply, requests, resolve }
}

let t: ReturnType<typeof setUp>
beforeEach(() => {
  t = setUp()
})

const value = <T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T => {
  if (!result.ok) throw new Error(`expected a preview, got ${JSON.stringify(result.error)}`)
  return result.value
}

describe('the connector', () => {
  it('claims the hosts of GitHub and the shapes of link it can preview', () => {
    expect(t.connector.id).toBe('github')
    expect(t.connector.hosts).toEqual(['github.com', 'www.github.com'])
    expect(t.connector.secretName).toBe('connectors/github/token')
    expect(t.connector.matches(new URL('https://github.com/o/r/pull/1'))).toBe(true)
    expect(t.connector.matches(new URL('https://github.com/o/r/actions'))).toBe(false)
  })
})

describe('a repository', () => {
  beforeEach(() => {
    t.reply('/repos/sindresorhus/is', json(fixture('repo-is')))
  })

  it('shows its name, description and stars, with the owner’s picture to be fetched by the resolver', async () => {
    const draft = value(await t.resolve('https://github.com/sindresorhus/is'))
    expect(draft).toEqual({
      canonicalUrl: 'https://github.com/sindresorhus/is',
      title: 'sindresorhus/is',
      description: 'Type check values · ★ 1,798',
      siteName: 'GitHub',
      kind: 'repository',
      imageUrl: 'https://avatars.githubusercontent.com/u/170270?v=4',
    })
  })

  it('asks only for the repository, authenticated, with a User-Agent, as a single request', async () => {
    await t.resolve('https://github.com/sindresorhus/is')
    expect(t.requests).toHaveLength(1)
    expect(t.requests[0]).toMatchObject({
      url: 'https://api.github.com/repos/sindresorhus/is',
      headers: {
        authorization: `Bearer ${TOKEN.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'QuillBot/1 (+https://quill.example/bot)',
      },
    })
  })

  it('sends no Authorization header when no credentials are configured', async () => {
    await t.resolve('https://github.com/sindresorhus/is', null)
    expect(t.requests[0]?.headers).not.toHaveProperty('authorization')
  })

  it('says an archived repository is archived', async () => {
    t.reply('/repos/sindresorhus/is', json({ ...(fixture('repo-is') as object), archived: true }))
    expect(value(await t.resolve('https://github.com/sindresorhus/is')).status).toEqual({
      label: 'Archived',
      tone: 'neutral',
    })
  })

  it('leaves out the stars when there are none, and the description when there is none', async () => {
    t.reply(
      '/repos/o/r',
      json({
        ...(fixture('repo-is') as object),
        full_name: 'o/r',
        description: null,
        stargazers_count: 0,
      }),
    )
    expect(value(await t.resolve('https://github.com/o/r')).description).toBeNull()
  })

  it('does not fetch a picture from anywhere but GitHub’s own avatar host', async () => {
    t.reply(
      '/repos/sindresorhus/is',
      json({
        ...(fixture('repo-is') as object),
        owner: { login: 'x', avatar_url: 'https://evil.example/a.png' },
      }),
    )
    expect(value(await t.resolve('https://github.com/sindresorhus/is')).imageUrl).toBeNull()
  })

  it('uses the name GitHub gives the repository, which is the new one after a rename', async () => {
    t.reply('/repos/old/name', json({ ...(fixture('repo-is') as object), full_name: 'new/name' }))
    const draft = value(await t.resolve('https://github.com/old/name'))
    expect(draft.canonicalUrl).toBe('https://github.com/new/name')
    expect(draft.title).toBe('new/name')
  })

  it('cleans the description it is given: no markup survives as anything but text, no control characters', async () => {
    t.reply(
      '/repos/sindresorhus/is',
      json({
        ...(fixture('repo-is') as object),
        description: `<img src=x onerror=alert(1)>${NUL}${RLO}txt

more`,
      }),
    )
    const { description } = value(await t.resolve('https://github.com/sindresorhus/is'))
    expect(description).toBe('<img src=x onerror=alert(1)> txt more · ★ 1,798')
  })
})

describe('private content: no preview is made, and nothing further is read', () => {
  it.each([
    ['private', { private: true, visibility: 'private' }],
    ['internal', { private: false, visibility: 'internal' }],
    ['marked private without a visibility', { private: true, visibility: undefined }],
  ])('a %s repository is restricted', async (_name, overrides) => {
    t.reply('/repos/o/secret', json({ ...(fixture('repo-hello-world') as object), ...overrides }))
    expect(await t.resolve('https://github.com/o/secret')).toEqual({
      ok: false,
      error: { kind: 'restricted' },
    })
  })

  it.each([
    ['a pull request', 'https://github.com/o/secret/pull/3'],
    ['an issue', 'https://github.com/o/secret/issues/3'],
    ['a code permalink', `https://github.com/o/secret/blob/${SHA}/a.ts#L1-L3`],
  ])(
    '%s in a private repository is restricted after one request, the repository’s',
    async (_name, url) => {
      t.reply(
        '/repos/o/secret',
        json({ ...(fixture('repo-hello-world') as object), private: true, visibility: 'private' }),
      )
      expect(await t.resolve(url)).toEqual({ ok: false, error: { kind: 'restricted' } })
      expect(t.requests.map((request) => request.url)).toEqual([
        'https://api.github.com/repos/o/secret',
      ])
    },
  )

  it('does not guess when the answer does not say whether the repository is public', async () => {
    t.reply('/repos/o/r', json({ full_name: 'o/r', description: 'x' }))
    expect(await t.resolve('https://github.com/o/r')).toEqual({
      ok: false,
      error: { kind: 'unavailable' },
    })
  })

  it('treats a pull request that says its base is private as restricted, whatever the repository said', async () => {
    t.reply('/repos/o/r', json(fixture('repo-hello-world')))
    t.reply(
      '/repos/o/r/pulls/3',
      json({
        ...(fixture('pull-open') as object),
        base: { ref: 'main', repo: { full_name: 'o/r', private: true, visibility: 'private' } },
      }),
    )
    expect(await t.resolve('https://github.com/o/r/pull/3')).toEqual({
      ok: false,
      error: { kind: 'restricted' },
    })
  })

  it('makes nothing of a private repository when there are no credentials either: GitHub answers 404', async () => {
    t.reply('/repos/o/secret', failure(404))
    expect(await t.resolve('https://github.com/o/secret', null)).toEqual({
      ok: false,
      error: { kind: 'not_found' },
    })
  })
})

describe('a pull request', () => {
  beforeEach(() => {
    t.reply('/repos/octocat/Hello-World', json(fixture('repo-hello-world')))
  })

  it.each([
    ['an open one', 'pull-open', { label: 'Open', tone: 'success' }],
    ['a merged one', 'pull-merged', { label: 'Merged', tone: 'accent' }],
    ['one closed without merging', 'pull-closed', { label: 'Closed', tone: 'danger' }],
  ])('reports %s', async (_name, name, status) => {
    t.reply('/repos/octocat/Hello-World/pulls/9', json(fixture(name)))
    const draft = value(await t.resolve('https://github.com/octocat/Hello-World/pull/9'))
    expect(draft.status).toEqual(status)
    expect(draft.kind).toBe('issue')
  })

  it('reports a draft as a draft, whatever else it says', async () => {
    t.reply(
      '/repos/octocat/Hello-World/pulls/9',
      json({ ...(fixture('pull-open') as object), draft: true }),
    )
    expect(value(await t.resolve('https://github.com/octocat/Hello-World/pull/9')).status).toEqual({
      label: 'Draft',
      tone: 'neutral',
    })
  })

  it('names the number, the repository, the author and the labels', async () => {
    t.reply(
      '/repos/octocat/Hello-World/pulls/217',
      json({
        ...(fixture('pull-merged') as object),
        labels: [{ name: 'bug' }, { name: 'help wanted' }, { name: 7 }],
      }),
    )
    const draft = value(await t.resolve('https://github.com/octocat/Hello-World/pull/217/files'))
    expect(draft).toEqual({
      canonicalUrl: 'https://github.com/octocat/Hello-World/pull/217',
      title: 'fix: is.class for minified class expression (#217)',
      description: 'Opened by tgriesser in octocat/Hello-World. Labels: bug, help wanted.',
      siteName: 'GitHub · octocat/Hello-World',
      kind: 'issue',
      imageUrl: null,
      status: { label: 'Merged', tone: 'accent' },
    })
  })

  it('leaves the labels out when there are none, and caps how many it names', async () => {
    t.reply('/repos/octocat/Hello-World/pulls/9', json(fixture('pull-open')))
    expect(
      value(await t.resolve('https://github.com/octocat/Hello-World/pull/9')).description,
    ).not.toContain('Labels')

    const many = Array.from({ length: 30 }, (_, index) => ({ name: `label-${index}` }))
    t.reply(
      '/repos/octocat/Hello-World/pulls/10',
      json({ ...(fixture('pull-open') as object), labels: many }),
    )
    const { description } = value(await t.resolve('https://github.com/octocat/Hello-World/pull/10'))
    expect(description).toContain('label-0')
    expect(description).not.toContain('label-29')
  })

  it('is not found when the repository or the pull request is not', async () => {
    t.reply('/repos/octocat/Hello-World/pulls/9', failure(404))
    expect(await t.resolve('https://github.com/octocat/Hello-World/pull/9')).toEqual({
      ok: false,
      error: { kind: 'not_found' },
    })
  })

  it('does not trust a title that is longer than a title should be, and keeps the number', async () => {
    t.reply(
      '/repos/octocat/Hello-World/pulls/9',
      json({ ...(fixture('pull-open') as object), title: 'x'.repeat(5000) }),
    )
    const { title } = value(await t.resolve('https://github.com/octocat/Hello-World/pull/9'))
    expect(title.length).toBeLessThanOrEqual(200)
    expect(title.endsWith('(#9)')).toBe(true)
  })
})

describe('an issue', () => {
  beforeEach(() => {
    t.reply('/repos/octocat/Hello-World', json(fixture('repo-hello-world')))
  })

  const issue = (overrides: object) => ({
    ...(fixture('issue-is-a-pull') as object),
    pull_request: undefined,
    number: 7,
    title: 'It crashes',
    state: 'open',
    ...overrides,
  })

  it('reports an open issue, with the same words as a pull request', async () => {
    t.reply('/repos/octocat/Hello-World/issues/7', json(issue({})))
    const draft = value(await t.resolve('https://github.com/octocat/Hello-World/issues/7'))
    expect(draft).toMatchObject({
      title: 'It crashes (#7)',
      kind: 'issue',
      status: { label: 'Open', tone: 'success' },
      canonicalUrl: 'https://github.com/octocat/Hello-World/issues/7',
    })
  })

  it.each([
    ['completed', { label: 'Closed', tone: 'accent' }],
    ['not_planned', { label: 'Closed as not planned', tone: 'neutral' }],
    [null, { label: 'Closed', tone: 'accent' }],
  ])('reports an issue closed as %s', async (reason, status) => {
    t.reply(
      '/repos/octocat/Hello-World/issues/7',
      json(issue({ state: 'closed', state_reason: reason })),
    )
    expect(
      value(await t.resolve('https://github.com/octocat/Hello-World/issues/7')).status,
    ).toEqual(status)
  })

  it('follows an issue number that is really a pull request to the pull request, which knows if it merged', async () => {
    t.reply('/repos/octocat/Hello-World/issues/1', json(fixture('issue-is-a-pull')))
    t.reply(
      '/repos/octocat/Hello-World/pulls/1',
      json({ ...(fixture('pull-merged') as object), number: 1 }),
    )
    const draft = value(await t.resolve('https://github.com/octocat/Hello-World/issues/1'))
    expect(draft.status).toEqual({ label: 'Merged', tone: 'accent' })
    expect(draft.canonicalUrl).toBe('https://github.com/octocat/Hello-World/pull/1')
  })
})

describe('a code permalink', () => {
  const API_PATH = `/repos/sindresorhus/is/contents/source/index.ts?ref=${SHA}`
  const link = (hash = '#L12-L16') =>
    `https://github.com/sindresorhus/is/blob/${SHA}/source/index.ts${hash}`

  beforeEach(() => {
    t.reply('/repos/sindresorhus/is', json(fixture('repo-is')))
    t.reply(API_PATH, json(fixture('contents-file')))
  })

  it('carries the lines the link names, numbered from the first of them', async () => {
    const draft = value(await t.resolve(link()))
    expect(draft.code).toEqual({
      language: 'typescript',
      startLine: 12,
      lines: [
        '\tNodeStream,',
        '\tNonEmptyString,',
        '\tNonNegativeInteger,',
        '\tNonNegativeNumber,',
        '\tObservableLike,',
      ],
      path: 'source/index.ts',
      repository: 'sindresorhus/is',
    })
    expect(draft).toMatchObject({
      title: 'source/index.ts, lines 12 to 16',
      description: 'sindresorhus/is at e9c026c',
      siteName: 'GitHub',
      kind: 'repository',
      canonicalUrl: link(),
    })
  })

  it('asks for the file at exactly that commit, after checking the repository is public', async () => {
    await t.resolve(link())
    expect(t.requests.map((request) => request.url)).toEqual([
      'https://api.github.com/repos/sindresorhus/is',
      `https://api.github.com${API_PATH}`,
    ])
  })

  it('names a single line as one', async () => {
    const draft = value(await t.resolve(link('#L3')))
    expect(draft.code?.lines).toEqual(['\tClass,'])
    expect(draft.title).toBe('source/index.ts, line 3')
  })

  it('caps a long range at the most lines a snippet carries', async () => {
    const draft = value(await t.resolve(link('#L1-L40')))
    expect(draft.code?.lines).toHaveLength(CODE_SNIPPET_MAX_LINES)
    expect(draft.code?.startLine).toBe(1)
  })

  it('shows the start of the file when the link names no lines', async () => {
    const draft = value(await t.resolve(link('')))
    expect(draft.code?.startLine).toBe(1)
    expect(draft.code?.lines.length).toBeGreaterThan(0)
    expect(draft.title).toBe('source/index.ts')
  })

  it('is not found when the lines start after the end of the file', async () => {
    expect(await t.resolve(link('#L5000-L5010'))).toEqual({
      ok: false,
      error: { kind: 'not_found' },
    })
  })

  it('shortens the range to the end of the file', async () => {
    const draft = value(await t.resolve(link('#L38-L90')))
    expect(draft.code?.startLine).toBe(38)
    expect(draft.code?.lines.length).toBeLessThan(10)
  })

  it('does not take a directory, a symbolic link or a submodule for a file', async () => {
    t.reply(API_PATH, json(fixture('contents-dir')))
    expect(await t.resolve(link())).toEqual({ ok: false, error: { kind: 'not_found' } })
    t.reply(API_PATH, json({ type: 'symlink', path: 'source/index.ts', target: '../x' }))
    expect(await t.resolve(link())).toEqual({ ok: false, error: { kind: 'not_found' } })
  })

  it('does not show a file that is not text', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0xff, 0xfe])
    t.reply(
      API_PATH,
      json({
        type: 'file',
        encoding: 'base64',
        path: 'source/index.ts',
        content: bytes.toString('base64'),
      }),
    )
    expect(await t.resolve(link())).toEqual({ ok: false, error: { kind: 'unavailable' } })
  })

  it('does not show a file with an encoding it does not read', async () => {
    t.reply(
      API_PATH,
      json({ type: 'file', encoding: 'none', path: 'source/index.ts', content: '' }),
    )
    expect(await t.resolve(link())).toEqual({ ok: false, error: { kind: 'unavailable' } })
  })

  it('removes control characters from the lines, keeps tabs, and leaves markup as the text it is', async () => {
    const source = `<script>alert(1)</script>${BELL}${ESC}[31m	x${RLO}`
    t.reply(
      API_PATH,
      json({
        type: 'file',
        encoding: 'base64',
        path: 'source/index.ts',
        content: Buffer.from(source).toString('base64'),
      }),
    )
    const draft = value(await t.resolve(link('#L1')))
    expect(draft.code?.lines).toEqual(['<script>alert(1)</script>[31m\tx'])
  })

  it('names the language from the file’s extension, and none for an extension it does not know', async () => {
    t.reply(
      `/repos/sindresorhus/is/contents/Makefile.zzz?ref=${SHA}`,
      json(fixture('contents-readme')),
    )
    const draft = value(
      await t.resolve(`https://github.com/sindresorhus/is/blob/${SHA}/Makefile.zzz#L1`),
    )
    expect(draft.code?.language).toBeNull()
  })

  it('encodes each segment of a path with spaces for the API, and keeps them out of nothing else', async () => {
    t.reply(
      `/repos/sindresorhus/is/contents/my%20docs/a%20b.md?ref=${SHA}`,
      json(fixture('contents-readme')),
    )
    value(await t.resolve(`https://github.com/sindresorhus/is/blob/${SHA}/my%20docs/a%20b.md#L1`))
    expect(t.requests.at(-1)?.url).toBe(
      `https://api.github.com/repos/sindresorhus/is/contents/my%20docs/a%20b.md?ref=${SHA}`,
    )
  })
})

describe('where the credentials may go', () => {
  it('only ever contacts api.github.com, whatever the link, and only under /repos/', async () => {
    t.reply('/repos/o/r', json(fixture('repo-hello-world')))
    t.reply('/repos/o/r/pulls/2', json(fixture('pull-open')))
    t.reply(`/repos/o/r/contents/a.ts?ref=${SHA}`, json(fixture('contents-readme')))
    await t.resolve('https://www.github.com/o/r')
    await t.resolve('https://github.com/o/r/pull/2')
    await t.resolve(`https://github.com/o/r/blob/${SHA}/a.ts#L1`)
    for (const request of t.requests) {
      expect(request.url).toMatch(/^https:\/\/api\.github\.com\/repos\/o\/r(\/|\?|$)/u)
    }
  })

  it('is not found for a link that is not one of its shapes, without a request', async () => {
    expect(await t.resolve('https://github.com/settings/profile')).toEqual({
      ok: false,
      error: { kind: 'not_found' },
    })
    expect(t.requests).toHaveLength(0)
  })

  it('keeps the token out of the draft and of every failure', async () => {
    t.reply('/repos/o/r', json(fixture('repo-hello-world')))
    const outcomes = [
      await t.resolve('https://github.com/o/r'),
      await t.resolve('https://github.com/o/missing'.replace('missing', 'r/pull/99')),
    ].map((outcome) => JSON.stringify(outcome))
    expect(outcomes.join('')).not.toContain(TOKEN.token)
  })
})

describe('when GitHub cannot answer', () => {
  beforeEach(() => {
    t.reply('/repos/o/r', json(fixture('repo-hello-world')))
  })

  it.each([
    [401, 'unavailable'],
    [404, 'not_found'],
    [410, 'not_found'],
    [403, 'unavailable'],
    [451, 'unavailable'],
    [500, 'unavailable'],
    [502, 'unavailable'],
  ])('reads %i as %s', async (status, kind) => {
    t.reply('/repos/o/r', failure(status))
    expect(await t.resolve('https://github.com/o/r')).toEqual({ ok: false, error: { kind } })
  })

  it('reads an answer that is not JSON, or not an object, as unavailable', async () => {
    t.reply('/repos/o/r', json('<html>sign in</html>'))
    expect(await t.resolve('https://github.com/o/r')).toEqual({
      ok: false,
      error: { kind: 'unavailable' },
    })
    t.reply('/repos/o/r', json('[1,2]'))
    expect(await t.resolve('https://github.com/o/r')).toEqual({
      ok: false,
      error: { kind: 'unavailable' },
    })
  })

  it('reads a refused, failed or timed-out request as unavailable, with nothing thrown', async () => {
    t.reply('/repos/o/r', new OutboundRequestError('timeout', 'slow'))
    expect(await t.resolve('https://github.com/o/r')).toEqual({
      ok: false,
      error: { kind: 'unavailable' },
    })
    t.reply('/repos/o/r', new Error('socket hang up'))
    expect(await t.resolve('https://github.com/o/r')).toEqual({
      ok: false,
      error: { kind: 'unavailable' },
    })
  })

  it('makes no request once the call’s time is up', async () => {
    const aborted = AbortSignal.abort()
    expect(await t.resolve('https://github.com/o/r', TOKEN, aborted)).toEqual({
      ok: false,
      error: { kind: 'unavailable' },
    })
    expect(t.requests).toHaveLength(0)
  })

  it('stops between requests when the time runs out part way', async () => {
    const controller = new AbortController()
    t.reply('/repos/o/r', () => {
      controller.abort()
      return json(fixture('repo-hello-world'))
    })
    t.reply('/repos/o/r/pulls/2', json(fixture('pull-open')))
    expect(await t.resolve('https://github.com/o/r/pull/2', TOKEN, controller.signal)).toEqual({
      ok: false,
      error: { kind: 'unavailable' },
    })
    expect(t.requests).toHaveLength(1)
  })
})

describe('rate limits: never a failure, always a wait', () => {
  const epoch = (offsetMs: number) => String(Math.floor((NOW.getTime() + offsetMs) / 1000))

  it('waits until the limit resets when GitHub says none are left', async () => {
    t.reply(
      '/repos/o/r',
      failure(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': epoch(90_000) }),
    )
    expect(await t.resolve('https://github.com/o/r')).toEqual({
      ok: false,
      error: { kind: 'rate_limited', retryAfterMs: 90_000 },
    })
  })

  it('obeys Retry-After, which the secondary limit uses, on a 403 or a 429', async () => {
    t.reply('/repos/o/r', failure(403, { 'retry-after': '45' }))
    expect(await t.resolve('https://github.com/o/r')).toMatchObject({
      error: { kind: 'rate_limited', retryAfterMs: 45_000 },
    })
    t.clock.advance(46_000)
    t.reply('/repos/o/r', failure(429, { 'retry-after': '12' }))
    expect(await t.resolve('https://github.com/o/r')).toMatchObject({
      error: { kind: 'rate_limited', retryAfterMs: 12_000 },
    })
  })

  it('waits a minute on a 429 that says nothing, and never less than a second or more than half an hour', async () => {
    t.reply('/repos/o/r', failure(429))
    expect(await t.resolve('https://github.com/o/r')).toMatchObject({
      error: { retryAfterMs: 60_000 },
    })
    t.clock.advance(61_000)
    t.reply('/repos/o/r', failure(429, { 'retry-after': '0' }))
    expect(await t.resolve('https://github.com/o/r')).toMatchObject({
      error: { retryAfterMs: 1_000 },
    })
    t.clock.advance(2_000)
    t.reply(
      '/repos/o/r',
      failure(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': epoch(6 * 3600_000) }),
    )
    expect(await t.resolve('https://github.com/o/r')).toMatchObject({
      error: { retryAfterMs: 30 * 60_000 },
    })
  })

  it('does not take an ordinary 403 for a rate limit', async () => {
    t.reply('/repos/o/r', failure(403, { 'x-ratelimit-remaining': '4000' }))
    expect(await t.resolve('https://github.com/o/r')).toEqual({
      ok: false,
      error: { kind: 'unavailable' },
    })
  })

  it('stops asking, with no request at all, once a success has said the allowance is spent', async () => {
    t.reply(
      '/repos/o/r',
      json(fixture('repo-hello-world'), {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': epoch(120_000),
      }),
    )
    value(await t.resolve('https://github.com/o/r'))
    expect(t.requests).toHaveLength(1)

    expect(await t.resolve('https://github.com/o/r')).toEqual({
      ok: false,
      error: { kind: 'rate_limited', retryAfterMs: 120_000 },
    })
    expect(t.requests).toHaveLength(1)

    t.clock.advance(120_000)
    value(await t.resolve('https://github.com/o/r'))
    expect(t.requests).toHaveLength(2)
  })

  it('waits on the second request of a resolution, too', async () => {
    t.reply('/repos/o/r', json(fixture('repo-hello-world')))
    t.reply('/repos/o/r/pulls/2', failure(403, { 'retry-after': '30' }))
    expect(await t.resolve('https://github.com/o/r/pull/2')).toMatchObject({
      error: { kind: 'rate_limited', retryAfterMs: 30_000 },
    })
  })

  it('reads a reset time that is nonsense as no information', async () => {
    t.reply(
      '/repos/o/r',
      failure(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'soon' }),
    )
    expect(await t.resolve('https://github.com/o/r')).toEqual({
      ok: false,
      error: { kind: 'unavailable' },
    })
  })
})

describe('what it asks the client for', () => {
  it('names the rate limit headers it needs, and no others', async () => {
    t.reply('/repos/o/r', json(fixture('repo-hello-world')))
    await t.resolve('https://github.com/o/r')
    expect([...(t.requests[0]?.exposeHeaders ?? [])].toSorted()).toEqual([
      'retry-after',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ])
  })
})
