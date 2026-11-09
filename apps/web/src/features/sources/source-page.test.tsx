import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

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
    expect(screen.getByText('https://github.com/acme/handbook.git')).toBeVisible()
    expect(screen.getByText(/To the file on the forge/u)).toBeVisible()
    expect(screen.getByText(/None. Pushes arrive with the daily reconciliation/u)).toBeVisible()
    expect(screen.getByText(/Every file under the source’s paths was stored/u)).toBeVisible()
    expect(screen.getByText(/Every relative link goes somewhere/u)).toBeVisible()
    await expectNoAccessibilityViolations(document.body)
  })

  it('has not synced yet, and says so', async () => {
    renderApp(PATH, routes(source({ sync: null })))
    await heading()
    expect(screen.getByText('Not synced yet')).toBeVisible()
    expect(screen.getAllByText('None yet')).toHaveLength(2)
    expect(screen.getByText(/Not checked yet/u)).toBeVisible()
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
    const stopped = screen.getByText('The last sync stopped').closest('[class]')?.parentElement
    expect(stopped).toHaveTextContent(
      `It stopped at ${shortRevision(FAILED_AT)}: ${describeSourceFailure('invalid-manifest')}.`,
    )
    expect(stopped).toHaveTextContent('line 3: a collection needs a path')
    expect(stopped).toHaveTextContent('Readers still see the last good revision')
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
    expect(screen.getByText(/It stopped: its branch was not found\./u)).toBeVisible()
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
    expect(screen.getByText('docs/guides/huge.md')).toBeVisible()
    expect(screen.getByText(describeRefusal('too-large'))).toBeVisible()
    expect(screen.getByText('../gone.md')).toBeVisible()
    const keys = screen.getByRole('list', { name: 'Manifest keys not read' })
    expect(within(keys).getByText('owners')).toBeVisible()
    expect(within(keys).getByText('Line 4')).toBeVisible()
    expect(screen.getByText('sources/handbook-webhook')).toBeVisible()
    expect(
      screen.getByText(`${globalThis.location.origin}/api/workspaces/ws-1/source/webhooks/github`),
    ).toBeVisible()
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
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled()

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
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled()
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
})
