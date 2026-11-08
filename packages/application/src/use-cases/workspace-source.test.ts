import { beforeEach, describe, expect, it } from 'vitest'
import { collectionId, documentId, userId, workspaceId } from '@quill/domain'

import { aShortId, createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { SOURCE_SYNC_REQUESTED } from './events.ts'
import {
  MAX_SOURCE_COLLECTIONS,
  WORKSPACE_SOURCE_AUDIT_EVENTS,
  configureWorkspaceSource,
  getWorkspaceSource,
  requestManualSourceSync,
} from './workspace-source.ts'
import type { CollectionRow } from '../ports/persistence.ts'
import type { ConfigureWorkspaceSourceCommand } from './workspace-source.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const ACTOR = userId('00000000-0000-4000-8000-000000000001')

let uow: InMemoryUnitOfWork
let deps: {
  uow: InMemoryUnitOfWork
  clock: ReturnType<typeof createFakeClock>
  ids: ReturnType<typeof createFakeIdGenerator>
  allowFileRemotes?: boolean
}

function command(
  overrides: Partial<ConfigureWorkspaceSourceCommand> = {},
): ConfigureWorkspaceSourceCommand {
  return {
    workspaceId: WORKSPACE,
    remote: 'https://github.com/acme/handbook.git',
    branch: 'main',
    collections: [
      { slug: 'guides', name: 'Guides', path: 'docs/guides/' },
      { slug: 'decisions', name: 'Decisions', path: 'docs/adr' },
    ],
    history: 'full',
    commitMessages: 'subject',
    credential: null,
    configuredBy: ACTOR,
    ...overrides,
  }
}

/** A collection named after its slug. */
const namedAfter = (slug: string, path: string) => ({ slug, name: slug, path })

/** The collection whose slug is `guides`. */
const guidesIn = (rows: readonly CollectionRow[]) => rows.find((row) => row.slug === 'guides')

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  deps = { uow, clock: createFakeClock(NOW), ids: createFakeIdGenerator() }
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Handbook',
    slug: 'handbook',
    now: NOW,
  })
})

describe('configureWorkspaceSource', () => {
  it('stores the source, creates its collections and makes the workspace sourced', async () => {
    const result = await configureWorkspaceSource(deps, command())
    if (result.kind !== 'configured') throw new Error(`unexpected result: ${result.kind}`)

    expect(result.view.collections.map(({ slug, name, path }) => ({ slug, name, path }))).toEqual([
      { slug: 'guides', name: 'Guides', path: 'docs/guides' },
      { slug: 'decisions', name: 'Decisions', path: 'docs/adr' },
    ])
    const stored = await uow.repos.workspaceSources.find(WORKSPACE)
    expect(stored).toMatchObject({
      remote: 'https://github.com/acme/handbook.git',
      branch: 'main',
      history: 'full',
      commitMessages: 'subject',
      credential: null,
      configuredBy: ACTOR,
      createdAt: NOW,
      updatedAt: NOW,
    })
    const collections = await uow.repos.collections.listByWorkspace(WORKSPACE)
    expect(stored?.collections).toEqual(
      ['guides', 'decisions'].map((slug) => ({
        collectionId: collections.find((row) => row.slug === slug)?.id,
        path: slug === 'guides' ? 'docs/guides' : 'docs/adr',
      })),
    )
    expect((await uow.repos.workspaces.findById(WORKSPACE))?.origin).toEqual({ kind: 'sourced' })
    expect(result.view.state).toBeNull()
  })

  it('asks for the first sync and audits where it reads from, never a secret', async () => {
    await uow.repos.secrets.put({
      name: 'sources/handbook',
      ciphertext: 'sealed',
      wrappedKey: 'wrapped',
      keyId: 'k1',
      now: NOW,
    })
    const credential = { username: 'x-access-token', secretName: 'sources/handbook' }
    await configureWorkspaceSource(deps, command({ credential }))

    expect(uow.events.map(({ type, payload }) => ({ type, payload }))).toEqual([
      {
        type: SOURCE_SYNC_REQUESTED,
        payload: { version: 1, workspaceId: WORKSPACE, trigger: 'manual' },
      },
    ])
    expect(uow.auditEvents).toEqual([
      expect.objectContaining({
        type: WORKSPACE_SOURCE_AUDIT_EVENTS.configured,
        actorUserId: ACTOR,
        targetType: 'workspace',
        targetId: WORKSPACE,
        metadata: {
          remote: 'https://github.com/acme/handbook.git',
          branch: 'main',
          paths: ['docs/guides', 'docs/adr'],
          history: 'full',
          commitMessages: 'subject',
          credentialSecret: 'sources/handbook',
        },
      }),
    ])
    expect((await uow.repos.workspaceSources.find(WORKSPACE))?.credential).toEqual(credential)
  })

  it('keeps a collection by its slug: renames it, and creates only new slugs', async () => {
    await configureWorkspaceSource(deps, command())
    const before = await uow.repos.collections.listByWorkspace(WORKSPACE)
    deps.clock.advance(60_000)

    const result = await configureWorkspaceSource(
      deps,
      command({
        branch: 'release',
        collections: [
          { slug: 'guides', name: 'How-to guides', path: 'docs/how-to' },
          { slug: 'decisions', name: 'Decisions', path: 'docs/adr' },
          { slug: 'reference', name: 'Reference', path: 'docs/reference' },
        ],
      }),
    )
    if (result.kind !== 'configured') throw new Error(`unexpected result: ${result.kind}`)

    const after = await uow.repos.collections.listByWorkspace(WORKSPACE)
    expect(guidesIn(after)?.id).toBe(guidesIn(before)?.id)
    expect(guidesIn(after)?.name).toBe('How-to guides')
    expect(after).toHaveLength(3)
    expect(result.view.source).toMatchObject({
      branch: 'release',
      createdAt: NOW,
      updatedAt: deps.clock.now(),
    })
  })

  it('fixes the collections and paths once the source has synced, and only then', async () => {
    await configureWorkspaceSource(deps, command())
    const moved = command({
      collections: [
        { slug: 'guides', name: 'Guides', path: 'docs/how-to' },
        { slug: 'decisions', name: 'Decisions', path: 'docs/adr' },
      ],
    })
    // Before any sync, nothing has been read yet, so anything may change.
    expect((await configureWorkspaceSource(deps, moved)).kind).toBe('configured')
    await uow.repos.sourceSyncState.recordSynced({
      workspaceId: WORKSPACE,
      revision: 'abc',
      refused: [],
      now: NOW,
    })

    expect(await configureWorkspaceSource(deps, command())).toMatchObject({
      kind: 'invalid',
      field: 'collections',
      message: expect.stringContaining('cannot change yet'),
    })
    const renamed = command({
      branch: 'release',
      commitMessages: 'none',
      collections: [
        { slug: 'decisions', name: 'Architecture decisions', path: 'docs/adr/' },
        { slug: 'guides', name: 'How-to guides', path: 'docs/how-to' },
      ],
    })
    expect((await configureWorkspaceSource(deps, renamed)).kind).toBe('configured')
  })

  it('changes the settings of a sourced workspace that already holds documents', async () => {
    await configureWorkspaceSource(deps, command())
    await addDocument()
    const result = await configureWorkspaceSource(deps, command({ history: 'head' }))
    expect(result.kind).toBe('configured')
  })

  it('refuses to make a workspace that holds documents sourced', async () => {
    await addDocument()
    expect(await configureWorkspaceSource(deps, command())).toEqual({ kind: 'not-empty' })
    expect(await uow.repos.workspaceSources.find(WORKSPACE)).toBeNull()
  })

  it('answers not-found for a workspace that does not exist', async () => {
    const result = await configureWorkspaceSource(
      deps,
      command({ workspaceId: workspaceId('00000000-0000-4000-8000-000000000999') }),
    )
    expect(result).toEqual({ kind: 'not-found' })
  })

  it('accepts a file remote only when tests allow it', async () => {
    const remote = 'file:///srv/handbook.git'
    expect(await configureWorkspaceSource(deps, command({ remote }))).toMatchObject({
      kind: 'invalid',
      field: 'remote',
    })
    deps.allowFileRemotes = true
    expect((await configureWorkspaceSource(deps, command({ remote }))).kind).toBe('configured')
  })

  it.each([
    ['remote', { remote: 'http://github.com/acme/handbook.git' }, 'https://'],
    ['branch', { branch: '--upload-pack=x' }, 'not a valid branch'],
    ['history', { history: 'since' as never }, 'history setting'],
    ['commitMessages', { commitMessages: 'body' as never }, 'commit message setting'],
    ['collections', { collections: [] }, 'at least one'],
    [
      'collections',
      {
        collections: Array.from({ length: MAX_SOURCE_COLLECTIONS + 1 }, (_, i) =>
          namedAfter(`c${i}`, `p${i}`),
        ),
      },
      'at most',
    ],
    ['collections', { collections: [{ slug: 'guides', name: '  ', path: 'docs' }] }, 'name'],
    [
      'collections',
      { collections: [{ slug: 'Guides!', name: 'Guides', path: 'docs' }] },
      'try "guides"',
    ],
    ['collections', { collections: [namedAfter('guides', 'docs/**')] }, 'glob'],
    [
      'collections',
      { collections: [namedAfter('a', 'docs'), namedAfter('a', 'other')] },
      'the slug "a"',
    ],
    [
      'collections',
      { collections: [namedAfter('a', 'docs'), namedAfter('b', 'docs/')] },
      'read "docs"',
    ],
    ['credential', { credential: { username: 'a:b', secretName: 'sources/x' } }, 'colon'],
    [
      'credential',
      { credential: { username: 'x', secretName: 'not a name' } },
      'not a secret name',
    ],
    ['credential', { credential: { username: 'x', secretName: 'sources/missing' } }, 'No secret'],
  ] satisfies [string, Partial<ConfigureWorkspaceSourceCommand>, string][])(
    'refuses an invalid %s (%#)',
    async (field, overrides, message) => {
      const result = await configureWorkspaceSource(deps, command(overrides))
      expect(result).toMatchObject({
        kind: 'invalid',
        field,
        message: expect.stringContaining(message),
      })
      expect(await uow.repos.workspaceSources.find(WORKSPACE)).toBeNull()
    },
  )
})

describe('getWorkspaceSource', () => {
  it('answers null for a native workspace', async () => {
    expect(await getWorkspaceSource(deps, WORKSPACE)).toBeNull()
  })

  it('answers the source with its collections named and its sync state', async () => {
    await configureWorkspaceSource(deps, command())
    await uow.repos.sourceSyncState.recordSynced({
      workspaceId: WORKSPACE,
      revision: 'abc',
      refused: [],
      now: NOW,
    })
    const view = await getWorkspaceSource(deps, WORKSPACE)
    expect(view?.collections.map(({ slug }) => slug)).toEqual(['guides', 'decisions'])
    expect(view?.state?.lastSyncedRevision).toBe('abc')
  })

  it('leaves out a collection that no longer exists', async () => {
    await configureWorkspaceSource(deps, command())
    const guides = await uow.repos.collections.findBySlug(WORKSPACE, 'guides')
    if (guides === null) throw new Error('no guides collection')
    await uow.repos.collections.delete(guides.id)
    const view = await getWorkspaceSource(deps, WORKSPACE)
    expect(view?.collections.map(({ slug }) => slug)).toEqual(['decisions'])
  })
})

describe('requestManualSourceSync', () => {
  it('answers not-sourced for a native workspace and records nothing', async () => {
    const result = await requestManualSourceSync(deps, {
      workspaceId: WORKSPACE,
      requestedBy: ACTOR,
    })
    expect(result).toEqual({ kind: 'not-sourced' })
    expect(uow.events).toEqual([])
  })

  it('records a manual sync request and audits it', async () => {
    await configureWorkspaceSource(deps, command())
    const result = await requestManualSourceSync(deps, {
      workspaceId: WORKSPACE,
      requestedBy: ACTOR,
    })
    expect(result).toEqual({ kind: 'requested' })
    expect(uow.events.at(-1)).toMatchObject({
      type: SOURCE_SYNC_REQUESTED,
      payload: { workspaceId: WORKSPACE, trigger: 'manual' },
    })
    expect(uow.auditEvents.at(-1)).toMatchObject({
      type: WORKSPACE_SOURCE_AUDIT_EVENTS.syncRequested,
      actorUserId: ACTOR,
      targetId: WORKSPACE,
      metadata: {},
    })
  })
})

async function addDocument(): Promise<void> {
  await uow.repos.documents.create({
    id: documentId('00000000-0000-4000-8000-000000000701'),
    shortId: aShortId(1),
    workspaceId: WORKSPACE,
    collectionId: collectionId('00000000-0000-4000-8000-000000000801'),
    parentId: null,
    slug: 'native',
    path: 'native.md',
    title: 'Native',
    status: 'published',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
}
