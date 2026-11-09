import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { expectNoAccessibilityViolations } from '@quill/ui/testing/axe'

import { renderApp } from '../../lib/api/render-app.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from '../../lib/api/testing.ts'
import { admin, member } from '../settings/settings-fixtures.ts'

const HEAD = '4f1c2a9e8b7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b'

const workspace = (origin: 'native' | 'sourced') => () =>
  jsonResponse(200, {
    id: 'ws-1',
    unitId: 'unit-1',
    name: 'Handbook',
    slug: 'handbook',
    createdAt: '2026-01-01T00:00:00.000Z',
    origin: { kind: origin },
    permissions: { view: true, comment: true, edit: false, arrange: false, manage: true },
  })

const node = (
  path: string,
  title: string,
  depth = 0,
  kind = 'document',
  change: string | null = null,
) => ({
  path,
  title,
  kind,
  change,
  depth,
})

function preview(overrides: Record<string, unknown> = {}) {
  return {
    revision: HEAD,
    manifest: {
      path: '.quill/workspace.yaml',
      state: 'read',
      problem: null,
      entries: [{ slug: null, collections: 1 }],
      entry: null,
      unknownKeys: [],
    },
    origin: 'manifest',
    collections: [
      {
        slug: 'guides',
        title: 'Guides',
        path: 'docs/guides',
        order: 'title',
        status: 'new',
        previousTitle: null,
        documents: 3,
        nodes: [
          node('docs/guides/concepts', 'Concepts', 0, 'generated-folder'),
          node('docs/guides/concepts/tenancy.md', 'Tenancy', 1),
          node('docs/guides/setup.md', 'Setting up'),
        ],
      },
    ],
    skipped: [
      {
        reason: 'excluded',
        count: 1,
        paths: ['docs/guides/drafts/wip.md'],
        patterns: { 'docs/guides/drafts/wip.md': 'docs/guides/drafts' },
      },
      { reason: 'symbolic-link', count: 1, paths: ['docs/guides/link.md'], patterns: {} },
    ],
    assets: 0,
    limits: { files: 5, truncated: false, unread: 0 },
    changes: null,
    ...overrides,
  }
}

const SAVED = {
  remote: 'https://github.com/acme/handbook.git',
  branch: 'main',
  collections: [],
  history: 'full',
  commitMessages: 'subject',
  manifestEntry: 'public',
  credential: null,
  outsideLinks: 'text',
  viewTemplate: null,
  webhookSecret: null,
  updatedAt: '2026-11-09T08:00:00.000Z',
  sync: null,
  syncing: false,
}

interface Recorded {
  previews: Record<string, unknown>[]
  saves: Record<string, unknown>[]
}

function routes(
  origin: 'native' | 'sourced',
  answer: (body: Record<string, unknown>) => Response,
  extra: FakeRoutes = {},
): { routes: FakeRoutes; recorded: Recorded } {
  const recorded: Recorded = { previews: [], saves: [] }
  // Saving makes the workspace read from the repository, as the server does.
  let current = origin
  return {
    recorded,
    routes: {
      'GET /api/me': admin,
      'GET /api/workspaces': () => jsonResponse(200, []),
      'GET /api/workspaces/{id}': () => workspace(current)(),
      'GET /api/workspaces/{id}/tree': () => jsonResponse(200, { collections: [] }),
      'GET /api/workspaces/{id}/documents': () => jsonResponse(200, []),
      'GET /api/workspaces/{id}/source': () => jsonResponse(200, SAVED),
      'GET /api/settings/secrets': () =>
        jsonResponse(200, [
          {
            name: 'sources/handbook',
            keyId: 'k1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            rotatedAt: null,
          },
        ]),
      'POST /api/workspaces/{id}/source/preview': async (request) => {
        const body = (await request.json()) as Record<string, unknown>
        recorded.previews.push(body)
        return answer(body)
      },
      'PUT /api/workspaces/{id}/source': async (request) => {
        const body = (await request.json()) as Record<string, unknown>
        recorded.saves.push(body)
        current = 'sourced'
        return jsonResponse(200, { ...SAVED, ...body, updatedAt: '2026-11-09T09:00:00.000Z' })
      },
      ...extra,
    },
  }
}

const ok =
  (overrides: Record<string, unknown> = {}) =>
  () =>
    jsonResponse(200, { outcome: 'preview', preview: preview(overrides) })

async function check(user: ReturnType<typeof userEvent.setup>, address: string) {
  await user.type(await screen.findByRole('textbox', { name: /Address/u }), address)
  await user.click(screen.getByRole('button', { name: 'Check the repository' }))
}

describe('connecting a workspace to a repository', () => {
  it('asks for what is missing before reading anything', async () => {
    const user = userEvent.setup()
    const { routes: table, recorded } = routes('native', ok())
    renderApp('/w/handbook/source/connect', table)
    await screen.findByRole('button', { name: 'Check the repository' })

    await user.clear(screen.getByRole('textbox', { name: /Branch/u }))
    await user.click(screen.getByRole('radio', { name: 'Private: a token stored as a secret' }))
    await user.click(screen.getByRole('button', { name: 'Check the repository' }))

    expect(screen.getByText('Enter the repository’s address.')).toBeVisible()
    expect(screen.getByText('Enter the branch to read.')).toBeVisible()
    expect(screen.getByText('Choose the secret that holds the token.')).toBeVisible()
    expect(recorded.previews).toEqual([])
    expect(screen.getByRole('button', { name: 'Connect and sync' })).toBeDisabled()
    expect(
      screen.getByText('Preview these settings first, so you can see what saving does.'),
    ).toBeVisible()
    await expectNoAccessibilityViolations(document.body)
  })

  it('previews the repository: its collections, its tree with folders marked, and what it leaves out', async () => {
    const user = userEvent.setup()
    const { routes: table, recorded } = routes('native', ok({ assets: 2 }))
    renderApp('/w/handbook/source/connect', table)
    await check(user, 'https://github.com/acme/handbook.git')
    expect(
      await screen.findByText(
        'Images and other files a page shows are imported with that page: 2 here.',
      ),
    ).toBeVisible()

    const guides = await screen.findByRole('region', { name: /^Guides/u })
    expect(within(guides).getByText('New collection')).toBeVisible()
    const tree = within(guides).getByRole('list', { name: 'Pages in Guides' })
    expect(within(tree).getByText('Folder page, written by Quill')).toBeVisible()
    // Tenancy is nested under its folder's page.
    const concepts = within(tree).getByText('Concepts').closest('li')
    expect(concepts).not.toBeNull()
    expect(within(concepts as HTMLElement).getByText('Tenancy')).toBeVisible()
    expect(
      screen.getByText('These files under the collections’ paths won’t become pages.'),
    ).toBeVisible()
    expect(screen.getByText('Excluded by the manifest: 1')).toBeVisible()
    expect(screen.getByText('docs/guides/drafts')).toBeVisible()
    expect(screen.getByText('Symbolic links: 1')).toBeVisible()
    expect(recorded.previews).toEqual([
      {
        remote: 'https://github.com/acme/handbook.git',
        branch: 'main',
        credential: null,
        collections: [],
        manifestEntry: null,
      },
    ])
    expect(screen.getByRole('button', { name: 'Connect and sync' })).toBeEnabled()
    await expectNoAccessibilityViolations(document.body)
  })

  it('lists the manifest’s workspaces and previews the one chosen', async () => {
    const user = userEvent.setup()
    const several = {
      path: '.quill/workspace.yaml',
      state: 'problem',
      problem: {
        line: null,
        message: 'it describes 2 workspaces and none has the slug "handbook".',
      },
      entries: [
        { slug: 'internal', collections: 1 },
        { slug: 'public', collections: 2 },
      ],
      entry: null,
      unknownKeys: [],
    }
    const { routes: table, recorded } = routes('native', (body) =>
      body['manifestEntry'] === 'public'
        ? jsonResponse(200, {
            outcome: 'preview',
            preview: preview({
              manifest: { ...several, state: 'read', problem: null, entry: 'public' },
            }),
          })
        : jsonResponse(200, {
            outcome: 'preview',
            preview: preview({ manifest: several, origin: null, collections: [], skipped: [] }),
          }),
    )
    renderApp('/w/handbook/source/connect', table)
    await check(user, 'https://github.com/acme/handbook.git')

    expect(await screen.findByText(/describes 2 workspaces/u)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Connect and sync' })).toBeDisabled()
    expect(screen.getByText('Choose which workspace in the manifest this one reads.')).toBeVisible()

    await user.click(screen.getByRole('radio', { name: 'public' }))
    expect(await screen.findByRole('region', { name: /^Guides/u })).toBeVisible()
    expect(recorded.previews.at(-1)).toMatchObject({ manifestEntry: 'public' })
    expect(screen.getByRole('button', { name: 'Connect and sync' })).toBeEnabled()
  })

  it('names the collections by path when the repository has no manifest', async () => {
    const user = userEvent.setup()
    const absent = {
      path: '.quill/workspace.yaml',
      state: 'absent',
      problem: null,
      entries: [],
      entry: null,
      unknownKeys: [],
    }
    const { routes: table, recorded } = routes('native', (body) =>
      jsonResponse(200, {
        outcome: 'preview',
        preview:
          (body['collections'] as unknown[]).length === 0
            ? preview({ manifest: absent, origin: 'settings', collections: [], skipped: [] })
            : preview({ manifest: absent, origin: 'settings' }),
      }),
    )
    renderApp('/w/handbook/source/connect', table)
    await check(user, 'https://github.com/acme/plain.git')

    expect(await screen.findByText(/has no manifest/u)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add a collection' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Path in the repository' }),
      'docs/user-guide',
    )
    // The name follows the path until somebody types one.
    expect(screen.getByRole('textbox', { name: 'Collection name' })).toHaveValue('User guide')
    expect(screen.getByText('The settings changed since this preview')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Preview these collections' }))

    await screen.findByRole('region', { name: /^Guides/u })
    expect(recorded.previews.at(-1)).toMatchObject({
      collections: [{ slug: 'user-guide', name: 'User guide', path: 'docs/user-guide' }],
    })
  })

  it('puts why the repository could not be read beside the field to fix', async () => {
    const user = userEvent.setup()
    const { routes: table } = routes('native', () =>
      jsonResponse(200, {
        outcome: 'unreadable',
        reason: 'credential-refused',
        message:
          "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      }),
    )
    renderApp('/w/handbook/source/connect', table)
    await check(user, 'https://github.com/acme/private.git')

    expect(await screen.findByText(/The repository refused access/u)).toBeVisible()
    expect(screen.getByText('Couldn’t read the repository')).toBeVisible()
    await user.click(screen.getByText('What Git said'))
    expect(screen.getByText(/terminal prompts disabled/u)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Connect and sync' })).toBeDisabled()
  })

  it('shows a refusal of a setting beside it', async () => {
    const user = userEvent.setup()
    const { routes: table } = routes('native', () =>
      errorResponse(422, 'invalid_source', 'The address must start with https://.', {
        field: 'remote',
      }),
    )
    renderApp('/w/handbook/source/connect', table)
    await check(user, 'http://example.com/docs.git')
    expect(await screen.findByText('The address must start with https://.')).toBeVisible()
    expect(screen.getByRole('textbox', { name: /Address/u })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('reports a manifest mistake with its line, and offers nothing to save', async () => {
    const user = userEvent.setup()
    const { routes: table } = routes(
      'native',
      ok({
        manifest: {
          path: '.quill/workspace.yaml',
          state: 'problem',
          problem: { line: 4, message: '"**/*.md" is a glob with no directory in front of it' },
          entries: [],
          entry: null,
          unknownKeys: [],
        },
        origin: null,
        collections: [],
        skipped: [],
      }),
    )
    renderApp('/w/handbook/source/connect', table)
    await check(user, 'https://github.com/acme/broken.git')
    expect(await screen.findByText('The manifest has a mistake')).toBeVisible()
    expect(screen.getByText(/, line 4: "\*\*\/\*\.md" is a glob/u)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Connect and sync' })).toBeDisabled()
  })

  it('chooses a credential by the secret’s name, and saves what it previewed', async () => {
    const user = userEvent.setup()
    const { routes: table, recorded } = routes('native', ok())
    renderApp('/w/handbook/source/connect', table)
    await user.type(
      await screen.findByRole('textbox', { name: /Address/u }),
      'https://github.com/acme/handbook.git',
    )
    await user.click(screen.getByRole('radio', { name: 'Private: a token stored as a secret' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Secret' }), 'sources/handbook')
    await user.click(screen.getByRole('radio', { name: 'Only the latest commit, imported once' }))
    await user.click(screen.getByRole('button', { name: 'Check the repository' }))
    await screen.findByRole('region', { name: /^Guides/u })

    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))
    await screen.findByRole('heading', { level: 1, name: 'Handbook repository' })
    expect(recorded.saves).toEqual([
      {
        remote: 'https://github.com/acme/handbook.git',
        branch: 'main',
        credential: { username: 'x-access-token', secretName: 'sources/handbook' },
        collections: [],
        manifestEntry: null,
        history: 'head',
        commitMessages: 'subject',
      },
    ])
  })

  it('says why a workspace that has documents cannot be connected', async () => {
    const { routes: table, recorded } = routes('native', ok(), {
      'GET /api/workspaces/{id}/documents': () =>
        jsonResponse(200, [{ id: 'd-1', title: 'Written here' }]),
    })
    renderApp('/w/handbook/source/connect', table)
    expect(await screen.findByText('This workspace already has documents')).toBeVisible()
    expect(screen.getByText(/It holds one document written here/u)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Check the repository' })).toBeNull()
    expect(recorded.previews).toEqual([])
  })

  it('is not offered to somebody who is not an instance administrator', async () => {
    const { routes: table } = routes('native', ok(), { 'GET /api/me': member })
    renderApp('/w/handbook/source/connect', table)
    expect(await screen.findByText('This page is not available')).toBeVisible()
  })
})

describe('changing a connected source', () => {
  it('opens on the saved settings, previews them, and says what a change would do', async () => {
    const user = userEvent.setup()
    const { routes: table, recorded } = routes('sourced', (body) =>
      jsonResponse(200, {
        outcome: 'preview',
        preview: preview({
          manifest: {
            path: '.quill/workspace.yaml',
            state: 'read',
            problem: null,
            entries: [
              { slug: 'internal', collections: 1 },
              { slug: 'public', collections: 1 },
            ],
            entry: body['manifestEntry'],
            unknownKeys: [],
          },
          changes:
            body['manifestEntry'] === 'internal'
              ? {
                  added: 2,
                  moved: 1,
                  unchanged: 0,
                  archived: [{ path: 'packages/ui/README.md', title: 'UI kit' }],
                  retired: [{ slug: 'packages', title: 'Packages' }],
                }
              : { added: 0, moved: 0, unchanged: 3, archived: [], retired: [] },
        }),
      }),
    )
    renderApp('/w/handbook/source/settings', table)
    await screen.findByRole('heading', { level: 1, name: 'Handbook repository settings' })
    expect(await screen.findByText(/Saving changes no page/u)).toBeVisible()
    expect(screen.getByRole('radio', { name: 'public' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'internal' }))
    expect(
      await screen.findByText(
        /Saving adds 2 pages, moves one page to another collection, archives one page and retires one collection\./u,
      ),
    ).toBeVisible()
    await user.click(screen.getByText('Archived: one page'))
    expect(screen.getByText('packages/ui/README.md')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Save and sync' }))
    await screen.findByRole('heading', { level: 1, name: 'Handbook repository' })
    // What the form does not show is sent back as it was.
    expect(recorded.saves).toEqual([
      expect.objectContaining({
        manifestEntry: 'internal',
        outsideLinks: 'text',
        viewTemplate: null,
      }),
    ])
    expect(recorded.saves[0]).not.toHaveProperty('webhookSecret')
  })

  it('says the preview is out of date when a field changes, until it is asked again', async () => {
    const user = userEvent.setup()
    const { routes: table } = routes(
      'sourced',
      ok({ changes: { added: 0, moved: 0, unchanged: 3, archived: [], retired: [] } }),
    )
    renderApp('/w/handbook/source/settings', table)
    await screen.findByText(/Saving changes no page/u)
    const branch = screen.getByRole('textbox', { name: /Branch/u })
    await user.clear(branch)
    await user.type(branch, 'release')
    expect(screen.getByText('The settings changed since this preview')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save and sync' })).toBeDisabled()
    await waitFor(() => {
      expect(screen.queryByText(/Saving changes no page/u)).toBeNull()
    })
  })
})
