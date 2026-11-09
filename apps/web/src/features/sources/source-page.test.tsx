import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { admin } from '../settings/settings-fixtures.ts'
import { describeRefusal, describeSourceFailure, shortRevision } from './source-words.ts'

const PATH = '/w/handbook/source'
const HEAD = '4f1c2a9e8b7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b'
const FAILED_AT = '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b'

const workspace = () =>
  jsonResponse(200, {
    id: 'ws-1',
    unitId: 'unit-1',
    name: 'Handbook',
    slug: 'handbook',
    createdAt: '2026-01-01T00:00:00.000Z',
    origin: { kind: 'sourced' },
  })

const SYNCED = {
  lastSyncedRevision: HEAD,
  lastSyncedAt: '2026-11-09T09:00:00.000Z',
  lastAttemptAt: '2026-11-09T09:00:00.000Z',
  failure: null,
  refused: [],
  brokenLinks: [],
  unknownKeys: [],
}

function source(overrides: Record<string, unknown> = {}) {
  return {
    remote: 'https://github.com/acme/handbook.git',
    branch: 'main',
    collections: [{ collectionId: 'c-1', slug: 'guides', name: 'Guides', path: 'docs/guides' }],
    history: 'full',
    commitMessages: 'subject',
    credential: null,
    outsideLinks: 'forge',
    viewTemplate: null,
    webhookSecret: null,
    updatedAt: '2026-11-09T08:00:00.000Z',
    sync: SYNCED,
    syncing: false,
    ...overrides,
  }
}

function routes(body: unknown, extra: FakeRoutes = {}): FakeRoutes {
  return {
    'GET /api/me': admin,
    'GET /api/workspaces': () => jsonResponse(200, []),
    'GET /api/workspaces/{id}': workspace,
    'GET /api/workspaces/{id}/tree': () => jsonResponse(200, { collections: [] }),
    'GET /api/workspaces/{id}/source': () => jsonResponse(200, body),
    ...extra,
  }
}

const heading = () => screen.findByRole('heading', { level: 1, name: 'Handbook repository' })

describe('a repository’s page', () => {
  it('says it is up to date, with the last good revision and the settings', async () => {
    renderApp(PATH, routes(source()))
    await heading()

    expect(screen.getByText('Up to date')).toBeVisible()
    expect(screen.getAllByText(shortRevision(HEAD))[0]).toHaveAttribute('title', HEAD)
    expect(screen.getByRole('textbox', { name: 'Repository' })).toHaveValue(
      'https://github.com/acme/handbook.git',
    )
    expect(screen.getByText(/To the file on the forge/u)).toBeVisible()
    expect(screen.getByText(/None. Pushes arrive with the daily check/u)).toBeVisible()
    // Nothing to fix folds to one line.
    expect(
      screen.getByText(
        'Nothing to fix: no file was left out, every relative link goes somewhere and the manifest has no key this release ignores.',
      ),
    ).toBeVisible()
    expect(screen.queryByRole('list', { name: 'Files not stored' })).toBeNull()
    await expectNoAccessibilityViolations(document.body)
  })

  it('has not synced yet, and says so', async () => {
    renderApp(PATH, routes(source({ sync: null })))
    await heading()
    expect(screen.getByText('Not synced yet')).toBeVisible()
    // Before anything has synced there is no list to speak of.
    expect(screen.queryByRole('heading', { name: 'Files, links and manifest keys' })).toBeNull()
  })

  it('names why the last sync stopped, where, and that nothing was taken away', async () => {
    renderApp(
      PATH,
      routes(
        source({
          sync: {
            ...SYNCED,
            failure: {
              reason: 'invalid-manifest',
              message: '.quill/workspace.yaml, line 3: a collection needs a path',
              revision: FAILED_AT,
            },
          },
        }),
      ),
    )
    await heading()
    expect(screen.getByText(describeSourceFailure('invalid-manifest'))).toBeVisible()
    // The file is linked to the forge at the commit that failed, and the revision is said once.
    const file = screen.getByRole('link', { name: '.quill/workspace.yaml' })
    expect(file).toHaveAttribute(
      'href',
      `https://github.com/acme/handbook/blob/${FAILED_AT}/.quill/workspace.yaml`,
    )
    expect(file.closest('p')).toHaveTextContent(
      '.quill/workspace.yaml, line 3: A collection needs a path.',
    )
    expect(screen.getAllByText(shortRevision(FAILED_AT))).toHaveLength(1)
    expect(screen.getByText(/Readers still see/u)).toHaveTextContent('nothing was taken away')
  })

  it('says a first sync that failed left the workspace empty', async () => {
    renderApp(
      PATH,
      routes(
        source({
          sync: {
            ...SYNCED,
            lastSyncedRevision: null,
            lastSyncedAt: null,
            failure: { reason: 'branch-not-found', message: 'no main', revision: null },
          },
        }),
      ),
    )
    await heading()
    expect(screen.getByText('The branch wasn’t found in the repository.')).toBeVisible()
    expect(screen.getByText('no main')).toBeVisible()
    expect(screen.getByText(/the workspace is empty/u)).toBeVisible()
  })

  it('lists files not stored, broken links and manifest keys it does not read', async () => {
    renderApp(
      PATH,
      routes(
        source({
          sync: {
            ...SYNCED,
            refused: [{ path: 'docs/guides/huge.md', revision: HEAD, reason: 'too-large' }],
            brokenLinks: [{ path: 'docs/guides/setup.md', url: '../gone.md', revision: HEAD }],
            unknownKeys: [
              { key: 'owners', line: 4 },
              { key: 'theme', line: null },
            ],
          },
          webhookSecret: 'sources/handbook-webhook',
          credential: { username: 'x-access-token', secretName: 'sources/handbook' },
        }),
      ),
    )
    await heading()
    const files = screen.getByRole('list', { name: 'Files not stored' })
    expect(within(files).getByRole('link', { name: 'docs/guides/huge.md' })).toBeVisible()
    expect(within(files).getByText(new RegExp(describeRefusal('too-large'), 'u'))).toBeVisible()
    expect(screen.getByText('../gone.md')).toBeVisible()
    const keys = screen.getByRole('list', { name: 'Manifest keys not read' })
    expect(within(keys).getByText('owners')).toBeVisible()
    expect(within(keys).getByText('Line 4')).toBeVisible()
    expect(within(keys).getByText(/Its line wasn’t recorded/u)).toBeVisible()
    expect(screen.getByText('sources/handbook-webhook')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'GitHub webhook' })).toHaveValue(
      `${globalThis.location.origin}/api/workspaces/ws-1/source/webhooks/github`,
    )
    expect(screen.getByText('x-access-token')).toBeVisible()
    await expectNoAccessibilityViolations(document.body)
  })

  it('asks for a sync, and shows it under way until the attempt is recorded', async () => {
    let asked = 0
    let body = source()
    renderApp(
      PATH,
      routes(body, {
        'GET /api/workspaces/{id}/source': () => jsonResponse(200, body),
        'POST /api/workspaces/{id}/source/sync': () => {
          asked += 1
          return jsonResponse(202, { requested: true })
        },
      }),
    )
    await heading()
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => {
      expect(asked).toBe(1)
    })
    expect(await screen.findByText('Syncing now')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled()

    body = source({
      sync: { ...SYNCED, lastAttemptAt: new Date(Date.now() + 60_000).toISOString() },
    })
    await waitFor(
      () => {
        expect(screen.getByText('Up to date')).toBeVisible()
      },
      { timeout: 5_000 },
    )
  })

  it('shows a sync running in another process', async () => {
    renderApp(PATH, routes(source({ syncing: true })))
    await heading()
    expect(screen.getByText('Syncing now')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled()
  })

  it('says when a sync could not be asked for', async () => {
    renderApp(
      PATH,
      routes(source(), {
        'POST /api/workspaces/{id}/source/sync': () =>
          errorResponse(429, 'rate_limited', 'Too many requests'),
      }),
    )
    await heading()
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(await screen.findByText("Couldn't ask for a sync")).toBeVisible()
  })

  it.each([
    [403, 'forbidden'],
    [409, 'workspace_not_sourced'],
  ])('is not available when the API answers %i', async (status, code) => {
    renderApp(
      PATH,
      routes(undefined, {
        'GET /api/workspaces/{id}/source': () => errorResponse(status, code, 'No'),
      }),
    )
    expect(await screen.findByText('This page is not available')).toBeVisible()
  })

  it('says the page did not load on any other failure', async () => {
    renderApp(
      PATH,
      routes(undefined, {
        'GET /api/workspaces/{id}/source': () => errorResponse(500, 'internal', 'Boom'),
      }),
    )
    expect(await screen.findByText("Couldn't load the repository")).toBeVisible()
  })

  it('copies an address, and says when the browser refuses', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValueOnce(undefined)
    writeText.mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderApp(PATH, routes(source()))
    await heading()
    const copy = screen.getByRole('button', { name: 'Copy the repository' })
    await userEvent.click(copy)
    expect(writeText).toHaveBeenCalledWith('https://github.com/acme/handbook.git')
    expect(await screen.findByText('Copied.')).toBeVisible()
    await userEvent.click(copy)
    expect(await screen.findByText(/Copying was refused/u)).toBeVisible()
  })

  it('names a failure that is not the manifest’s, and links nothing on a forge it does not know', async () => {
    renderApp(
      PATH,
      routes(
        source({
          remote: 'https://git.example.com/acme/handbook.git',
          sync: {
            ...SYNCED,
            refused: [{ path: 'docs/a.md', revision: HEAD, reason: 'something-new' }],
            failure: {
              reason: 'invalid-manifest',
              message: 'not the usual shape',
              revision: FAILED_AT,
            },
          },
        }),
      ),
    )
    await heading()
    expect(screen.getByText('not the usual shape')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'docs/a.md' })).toBeNull()
    expect(screen.getByText(/Not stored/u)).toBeVisible()
  })

  it('names the empty lists in one line beside the ones with something in them', async () => {
    renderApp(
      PATH,
      routes(
        source({
          sync: { ...SYNCED, brokenLinks: null, unknownKeys: [{ key: 'owners', line: 2 }] },
        }),
      ),
    )
    await heading()
    expect(
      screen.getByText('Also: no file was left out. Broken links are checked at the next sync.'),
    ).toBeVisible()
  })
})
