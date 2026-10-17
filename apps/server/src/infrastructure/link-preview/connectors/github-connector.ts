import type {
  Clock,
  ConnectorCredentials,
  ConnectorDraft,
  ConnectorFailure,
  LinkConnector,
} from '@quill/application'
import { CODE_SNIPPET_MAX_LINES, CODE_SNIPPET_MAX_LINE_LENGTH, err, ok } from '@quill/domain'
import type { PreviewCode, PreviewStatus, Result } from '@quill/domain'

import type { OutboundReader } from '../../http/outbound-client.ts'
import {
  DESCRIPTION_LIMIT,
  INVISIBLE_FORMATTING,
  SITE_NAME_LIMIT,
  TITLE_LIMIT,
  cleanText,
} from '../plain-text.ts'
import { GITHUB_HOSTS, parseGitHubUrl } from './github-urls.ts'
import type { GitHubTarget, LineRange } from './github-urls.ts'

/**
 * The GitHub connector (ADR-042, layer 1): pull requests, issues, repositories and
 * code permalinks, from `api.github.com`.
 *
 * **Where it may go.** The client is the allowlisted one, whose only host is
 * `api.github.com`; this module builds every request path from validated pieces of the
 * link (`github-urls.ts`), never from the link itself. The token is sent in one place
 * (`get`) and appears nowhere else: not in a draft, a failure, a log line, or an error
 * message.
 *
 * **What it may show: only what anyone could open.** The token can read private
 * repositories, and a preview is stored for everyone who can see the link. So the
 * first thing every resolution does is read the repository, and if it is not public
 * the answer is `restricted` and nothing else is read. A preview made with the
 * instance's credentials is therefore always of public content; private content gets a
 * plain link. (Showing a private preview to those who can open it needs a per-reader
 * check against GitHub, which is not built; see ADR-042's delivery notes.)
 *
 * **Rate limits are a wait, never a failure.** GitHub's headers (`retry-after`,
 * `x-ratelimit-*`) become `rate_limited` with the time to wait, and once an answer says
 * the allowance is spent, no further request is made until it resets.
 */

export const GITHUB_API_HOST = 'api.github.com'
/** How the transparency page (`/bot`) names this connector and where its token goes. */
export const GITHUB_SERVICE = { name: 'GitHub', apiHost: GITHUB_API_HOST } as const
export const GITHUB_SECRET_NAME = 'connectors/github/token'
export const GITHUB_API_VERSION = '2022-11-28'

const SITE = 'GitHub'
/** Longest and shortest a rate-limit wait is allowed to be: never a busy loop, never most of an hour. */
const MIN_WAIT_MS = 1_000
const MAX_WAIT_MS = 30 * 60_000
/** What a 429 that says nothing means. */
const UNSPECIFIED_WAIT_MS = 60_000
/** Lines shown from the top of a file that was linked without a line range. */
const HEAD_LINES = 12
const MAX_LABELS = 6
const LABEL_LIMIT = 50
const AVATAR_HOST = 'avatars.githubusercontent.com'
const FULL_NAME = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/u

const RATE_LIMIT_HEADERS = ['retry-after', 'x-ratelimit-remaining', 'x-ratelimit-reset'] as const

/** A language name for the extension, for styling only; nothing is ever highlighted by running code. */
const LANGUAGES: Readonly<Record<string, string>> = {
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  go: 'go',
  h: 'c',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  md: 'markdown',
  mjs: 'javascript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  yaml: 'yaml',
  yml: 'yaml',
}

export interface GitHubConnectorDeps {
  /** The allowlisted client, whose allowlist is `api.github.com` and nothing else. */
  readonly client: OutboundReader
  readonly clock: Clock
  /** GitHub requires one, and the honest one says who is asking (`user-agent.ts`). */
  readonly userAgent: string
}

type Json = Readonly<Record<string, unknown>>
type Outcome<T> = Result<T, ConnectorFailure>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const failure = (kind: 'not_found' | 'unavailable' | 'restricted'): Outcome<never> => err({ kind })

function clampWait(milliseconds: number): number {
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, Math.ceil(milliseconds)))
}

function seconds(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** When the allowance resets, if the headers say it is spent. */
function exhaustedUntil(headers: Readonly<Record<string, string>>): number | null {
  if (headers['x-ratelimit-remaining'] !== '0') return null
  const reset = seconds(headers['x-ratelimit-reset'])
  return reset === null ? null : reset * 1000
}

/** Whether a repository (or a pull request's base) is open to everyone, closed to some, or unsaid. */
function visibilityOf(repository: unknown): 'public' | 'restricted' | 'unknown' {
  if (!isRecord(repository)) return 'unknown'
  const { private: isPrivate, visibility } = repository
  if (isPrivate === true) return 'restricted'
  if (typeof visibility === 'string' && visibility !== 'public') return 'restricted'
  return isPrivate === false ? 'public' : 'unknown'
}

function apiPath(target: GitHubTarget): string {
  return `/repos/${target.owner}/${target.repo}`
}

/** A picture only from GitHub's own avatar host: the resolver fetches it, so the connector names where. */
function avatarOf(owner: unknown): string | null {
  const address = isRecord(owner) ? text(owner['avatar_url']) : null
  if (address === null) return null
  try {
    const url = new URL(address)
    return url.protocol === 'https:' && url.hostname === AVATAR_HOST ? url.href : null
  } catch {
    return null
  }
}

/* eslint-disable no-control-regex -- removing control characters is the point. */
const CONTROL_EXCEPT_TAB = new RegExp(
  '[\\u0000-\\u0008\\u000A-\\u001F\\u007F-\\u009F\\u2028\\u2029]',
  'gu',
)
/* eslint-enable no-control-regex */

/**
 * One line of someone's source, as data: control characters and invisible formatting
 * (which can make code read as something it is not) are removed, tabs stay, and nothing
 * is interpreted. It is shown as escaped text and never highlighted by a script.
 */
function codeLine(raw: string): string {
  return raw
    .replace(INVISIBLE_FORMATTING, '')
    .replace(CONTROL_EXCEPT_TAB, '')
    .slice(0, CODE_SNIPPET_MAX_LINE_LENGTH)
}

function languageOf(path: string): string | null {
  const name = path.split('/').at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  return dot < 0 ? null : (LANGUAGES[name.slice(dot + 1).toLowerCase()] ?? null)
}

function lineAnchor(range: LineRange | null): string {
  if (range === null) return ''
  return range.start === range.end ? `#L${range.start}` : `#L${range.start}-L${range.end}`
}

function pullStatus(pull: Json): PreviewStatus | null {
  if (pull['merged'] === true || text(pull['merged_at']) !== null) {
    return { label: 'Merged', tone: 'accent' }
  }
  if (pull['state'] === 'closed') return { label: 'Closed', tone: 'danger' }
  if (pull['draft'] === true) return { label: 'Draft', tone: 'neutral' }
  return pull['state'] === 'open' ? { label: 'Open', tone: 'success' } : null
}

function issueStatus(issue: Json): PreviewStatus | null {
  if (issue['state'] === 'open') return { label: 'Open', tone: 'success' }
  if (issue['state'] !== 'closed') return null
  return issue['state_reason'] === 'not_planned'
    ? { label: 'Closed as not planned', tone: 'neutral' }
    : { label: 'Closed', tone: 'accent' }
}

export function createGitHubConnector(deps: GitHubConnectorDeps): LinkConnector {
  const { client, clock, userAgent } = deps
  /** Epoch milliseconds before which no request is made, because GitHub said the allowance is spent. */
  let pausedUntil = 0

  const wait = (until: number): ConnectorFailure => ({
    kind: 'rate_limited',
    retryAfterMs: clampWait(until - clock.now().getTime()),
  })

  /**
   * The one place a request is made and the one place the token is used. Answers the
   * parsed JSON of a 200, or why not.
   */
  async function get(
    path: string,
    credentials: ConnectorCredentials | null,
    signal: AbortSignal,
  ): Promise<Outcome<unknown>> {
    if (signal.aborted) return failure('unavailable')
    if (pausedUntil > clock.now().getTime()) return err(wait(pausedUntil))

    let response
    try {
      response = await client.get({
        url: `https://${GITHUB_API_HOST}${path}`,
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': GITHUB_API_VERSION,
          'user-agent': userAgent,
          ...(credentials === null ? {} : { authorization: `Bearer ${credentials.token}` }),
        },
        exposeHeaders: RATE_LIMIT_HEADERS,
      })
    } catch {
      // Refused, failed or too slow: all the same to a reader, who gets the page layers.
      return failure('unavailable')
    }

    const headers = response.headers ?? {}
    const now = clock.now().getTime()
    const spentUntil = exhaustedUntil(headers)
    if (spentUntil !== null) pausedUntil = spentUntil

    if (response.status === 403 || response.status === 429) {
      const retryAfter = seconds(headers['retry-after'])
      const until =
        retryAfter !== null
          ? now + retryAfter * 1000
          : (spentUntil ?? (response.status === 429 ? now + UNSPECIFIED_WAIT_MS : null))
      if (until === null) return failure('unavailable')
      pausedUntil = Math.max(pausedUntil, Math.min(until, now + MAX_WAIT_MS))
      return err(wait(until))
    }
    if (response.status === 404 || response.status === 410) return failure('not_found')
    if (response.status !== 200) return failure('unavailable')
    try {
      return ok(JSON.parse(response.body))
    } catch {
      return failure('unavailable')
    }
  }

  /** The repository, checked to be public: the gate every other request waits behind. */
  async function publicRepository(
    target: GitHubTarget,
    credentials: ConnectorCredentials | null,
    signal: AbortSignal,
  ): Promise<Outcome<{ readonly fullName: string; readonly json: Json }>> {
    const fetched = await get(apiPath(target), credentials, signal)
    if (!fetched.ok) return fetched
    const json = fetched.value
    const visibility = visibilityOf(json)
    if (visibility === 'restricted') return failure('restricted')
    const fullName = isRecord(json) ? text(json['full_name']) : null
    if (
      visibility === 'unknown' ||
      !isRecord(json) ||
      fullName === null ||
      !FULL_NAME.test(fullName)
    ) {
      return failure('unavailable')
    }
    return ok({ fullName, json })
  }

  function repositoryDraft(fullName: string, json: Json): ConnectorDraft {
    const stars = json['stargazers_count']
    const facts = [
      cleanText(text(json['description']), DESCRIPTION_LIMIT - 24),
      typeof stars === 'number' && Number.isFinite(stars) && stars > 0
        ? `★ ${Math.trunc(stars).toLocaleString('en-US')}`
        : null,
    ].filter((fact) => fact !== null)
    return {
      canonicalUrl: `https://github.com/${fullName}`,
      title: cleanText(fullName, TITLE_LIMIT) ?? fullName,
      description: facts.length === 0 ? null : facts.join(' · '),
      siteName: SITE,
      kind: 'repository',
      imageUrl: avatarOf(json['owner']),
      ...(json['archived'] === true
        ? { status: { label: 'Archived', tone: 'neutral' } satisfies PreviewStatus }
        : {}),
    }
  }

  function labelsOf(item: Json): string[] {
    const labels = Array.isArray(item['labels']) ? item['labels'] : []
    return labels
      .flatMap((label) =>
        isRecord(label) ? (cleanText(text(label['name']), LABEL_LIMIT) ?? []) : [],
      )
      .slice(0, MAX_LABELS)
  }

  function itemDraft(
    item: Json,
    input: { readonly fullName: string; readonly number: number; readonly pull: boolean },
    status: PreviewStatus | null,
  ): Outcome<ConnectorDraft> {
    const suffix = ` (#${input.number})`
    const title = cleanText(text(item['title']), TITLE_LIMIT - suffix.length)
    if (title === null) return failure('unavailable')
    const user = isRecord(item['user']) ? cleanText(text(item['user']['login']), 39) : null
    const labels = labelsOf(item)
    const description = [
      user === null ? `In ${input.fullName}.` : `Opened by ${user} in ${input.fullName}.`,
      labels.length === 0 ? null : `Labels: ${labels.join(', ')}.`,
    ]
      .filter((sentence) => sentence !== null)
      .join(' ')
    return ok({
      canonicalUrl: `https://github.com/${input.fullName}/${input.pull ? 'pull' : 'issues'}/${input.number}`,
      title: `${title}${suffix}`,
      description: cleanText(description, DESCRIPTION_LIMIT),
      siteName: cleanText(`${SITE} · ${input.fullName}`, SITE_NAME_LIMIT),
      kind: 'issue',
      imageUrl: null,
      ...(status === null ? {} : { status }),
    })
  }

  async function pullOrIssue(
    target: GitHubTarget & { readonly kind: 'pull' | 'issue' },
    repository: { readonly fullName: string },
    credentials: ConnectorCredentials | null,
    signal: AbortSignal,
  ): Promise<Outcome<ConnectorDraft>> {
    const asIssue = target.kind === 'issue'
    const fetched = await get(
      `${apiPath(target)}/${asIssue ? 'issues' : 'pulls'}/${target.number}`,
      credentials,
      signal,
    )
    if (!fetched.ok) return fetched
    const item = fetched.value
    if (!isRecord(item)) return failure('unavailable')
    // An issue number can be a pull request's; only the pull request knows whether it merged.
    if (asIssue && isRecord(item['pull_request'])) {
      return pullOrIssue({ ...target, kind: 'pull' }, repository, credentials, signal)
    }
    // A pull request's own account of its base, in case the repository read said otherwise.
    const base = isRecord(item['base']) ? item['base']['repo'] : undefined
    if (base !== undefined && visibilityOf(base) === 'restricted') return failure('restricted')

    const input = { fullName: repository.fullName, number: target.number, pull: !asIssue }
    return itemDraft(item, input, asIssue ? issueStatus(item) : pullStatus(item))
  }

  async function code(
    target: GitHubTarget & { readonly kind: 'code' },
    repository: { readonly fullName: string },
    credentials: ConnectorCredentials | null,
    signal: AbortSignal,
  ): Promise<Outcome<ConnectorDraft>> {
    const encodedPath = target.path.split('/').map(encodeURIComponent).join('/')
    const fetched = await get(
      `${apiPath(target)}/contents/${encodedPath}?ref=${target.sha}`,
      credentials,
      signal,
    )
    if (!fetched.ok) return fetched
    const file = fetched.value
    // A directory is a list; a symbolic link and a submodule have no content to show.
    if (!isRecord(file) || file['type'] !== 'file') return failure('not_found')
    const content = text(file['content'])
    if (file['encoding'] !== 'base64' || content === null) return failure('unavailable')

    let source: string
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(content, 'base64'))
    } catch {
      return failure('unavailable')
    }
    if (source.includes('\u0000')) return failure('unavailable')

    const all = source.split(/\r\n|\r|\n/u)
    if (all.at(-1) === '') all.pop()
    const wanted = target.lines ?? { start: 1, end: HEAD_LINES }
    if (wanted.start > all.length) return failure('not_found')
    const end = Math.min(wanted.end, all.length, wanted.start + CODE_SNIPPET_MAX_LINES - 1)
    const snippet: PreviewCode = {
      language: languageOf(target.path),
      startLine: wanted.start,
      lines: all.slice(wanted.start - 1, end).map(codeLine),
      path: target.path,
      repository: repository.fullName,
    }
    const path = cleanText(target.path, TITLE_LIMIT - 24)
    if (path === null) return failure('unavailable')
    return ok({
      canonicalUrl: `https://github.com/${target.owner}/${target.repo}/blob/${target.sha}/${encodedPath}${lineAnchor(target.lines)}`,
      // The path, as a developer reads it; the lines are in the gutter and in the link's address.
      title: path,
      description: cleanText(
        `${repository.fullName} at ${target.sha.slice(0, 7)}`,
        DESCRIPTION_LIMIT,
      ),
      siteName: SITE,
      kind: 'repository',
      imageUrl: null,
      code: snippet,
    })
  }

  return {
    id: 'github',
    hosts: GITHUB_HOSTS,
    secretName: GITHUB_SECRET_NAME,
    matches: (url) => parseGitHubUrl(url) !== null,

    async resolve(url, credentials, signal) {
      const target = parseGitHubUrl(url)
      if (target === null) return failure('not_found')

      const repository = await publicRepository(target, credentials, signal)
      if (!repository.ok) return repository
      switch (target.kind) {
        case 'repository': {
          return ok(repositoryDraft(repository.value.fullName, repository.value.json))
        }
        case 'pull':
        case 'issue': {
          return pullOrIssue(target, repository.value, credentials, signal)
        }
        case 'code': {
          return code(target, repository.value, credentials, signal)
        }
      }
    },
  }
}
