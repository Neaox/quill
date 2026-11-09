import { beforeEach, describe, expect, it } from 'vitest'
import { userId, workspaceId } from '@quill/domain'
import type { Role, UserId } from '@quill/domain'

import type { ScopeKind } from '../ports/persistence.ts'
import type { SourceSyncFailure } from '../ports/source-sync.ts'
import {
  createFakeClock,
  createFakeIdGenerator,
  createFakeTokenService,
} from '../test-support/fakes.ts'
import type { FakeClock } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createAuthorizer } from './authorizer.ts'
import { SOURCE_SYNC_REQUESTED } from './events.ts'
import { listNotifications } from './notifications.ts'
import {
  MAX_SOURCE_FAILURE_RECIPIENTS,
  notifySourceSyncFailure,
  reconcileSources,
  sourceFailureKey,
} from './source-freshness.ts'
import type { SourceFailureNotificationDependencies } from './source-freshness.ts'

const NOW = new Date('2026-11-09T12:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER = workspaceId('00000000-0000-4000-8000-000000000102')

const CONFIGURER = userId('00000000-0000-4000-8000-0000000000a1')
const ADMIN = userId('00000000-0000-4000-8000-0000000000a2')
const EDITOR = userId('00000000-0000-4000-8000-0000000000a3')
const GROUP_ADMIN = userId('00000000-0000-4000-8000-0000000000a4')
const DENIED = userId('00000000-0000-4000-8000-0000000000a5')
const UNIT_ADMIN = userId('00000000-0000-4000-8000-0000000000a6')

const FETCH_FAILED: SourceSyncFailure = {
  reason: 'command-failed',
  message: 'git fetch failed: early EOF',
  revision: null,
}

let uow: InMemoryUnitOfWork
let clock: FakeClock
let deps: SourceFailureNotificationDependencies
let grants = 0

async function grant(
  principalKind: 'user' | 'group',
  principalId: string,
  role: Role,
  options: { scopeKind?: ScopeKind; scopeId?: string | null; effect?: 'allow' | 'deny' } = {},
): Promise<void> {
  grants += 1
  await uow.repos.grants.create({
    id: `grant-${grants}`,
    principalKind,
    principalId,
    scopeKind: options.scopeKind ?? 'workspace',
    scopeId: options.scopeId === undefined ? WORKSPACE : options.scopeId,
    role,
    effect: options.effect ?? 'allow',
    createdBy: null,
    now: NOW,
  })
}

async function person(id: UserId, name: string): Promise<void> {
  await uow.repos.users.create({
    id,
    email: `${name.toLowerCase()}@example.com`,
    displayName: name,
    now: NOW,
  })
}

async function putSource(id = WORKSPACE, configuredBy: UserId = CONFIGURER): Promise<void> {
  await uow.repos.workspaceSources.put({
    workspaceId: id,
    remote: 'https://github.com/acme/handbook.git',
    branch: 'main',
    collections: [],
    history: 'full',
    commitMessages: 'subject',
    manifestEntry: null,
    credential: null,
    webhookSecretName: null,
    outsideLinks: 'forge',
    viewTemplate: null,
    configuredBy,
    now: NOW,
  })
}

async function fail(failure: SourceSyncFailure = FETCH_FAILED): Promise<void> {
  clock.advance(60_000)
  await uow.repos.sourceSyncState.recordFailure({
    workspaceId: WORKSPACE,
    failure,
    now: clock.now(),
  })
}

async function told(): Promise<UserId[]> {
  const rows = await Promise.all(
    [CONFIGURER, ADMIN, EDITOR, GROUP_ADMIN, DENIED, UNIT_ADMIN].map(async (user) =>
      (await uow.repos.notifications.listForUser({ userId: user, after: null, limit: 50 })).map(
        () => user,
      ),
    ),
  )
  return rows.flat()
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  clock = createFakeClock(NOW)
  deps = {
    uow,
    clock,
    ids: createFakeIdGenerator(),
    tokens: createFakeTokenService(),
    shareLinkPolicy: { allowed: () => true },
  }
  grants = 0
  await uow.repos.units.create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  for (const [id, slug] of [
    [WORKSPACE, 'handbook'],
    [OTHER, 'other'],
  ] as const) {
    await uow.repos.workspaces.create({ id, unitId: 'acme', name: slug, slug, now: NOW })
  }
  for (const [id, name] of [
    [CONFIGURER, 'Configurer'],
    [ADMIN, 'Admin'],
    [EDITOR, 'Editor'],
    [GROUP_ADMIN, 'Grouped'],
    [DENIED, 'Denied'],
    [UNIT_ADMIN, 'Unit'],
  ] as const) {
    await person(id, name)
  }
  await uow.repos.users.setInstanceAdmin(CONFIGURER, true)
  await putSource()
})

describe('reconcileSources', () => {
  it('asks every sourced workspace to sync', async () => {
    expect(await reconcileSources({ uow, clock })).toBe(1)
    await putSource(OTHER)
    expect(await reconcileSources({ uow, clock })).toBe(2)
    const payloads = uow.events
      .filter((event) => event.type === SOURCE_SYNC_REQUESTED)
      .map(({ payload }) => payload)
    expect(payloads).toEqual([
      { version: 1, workspaceId: WORKSPACE, trigger: 'schedule' },
      { version: 1, workspaceId: WORKSPACE, trigger: 'schedule' },
      { version: 1, workspaceId: OTHER, trigger: 'schedule' },
    ])
  })

  it('asks nothing of an instance with no sources', async () => {
    expect(await reconcileSources({ uow: createInMemoryUnitOfWork(), clock })).toBe(0)
  })
})

describe('sourceFailureKey', () => {
  it('is the reason and the revision, not the message', () => {
    expect(sourceFailureKey(FETCH_FAILED)).toBe('command-failed@')
    expect(sourceFailureKey({ ...FETCH_FAILED, message: 'other words' })).toBe('command-failed@')
    expect(sourceFailureKey({ ...FETCH_FAILED, revision: 'abc' })).toBe('command-failed@abc')
  })
})

describe('notifySourceSyncFailure', () => {
  beforeEach(async () => {
    await grant('user', ADMIN, 'admin')
    await grant('user', EDITOR, 'editor')
    await uow.repos.groups.create({
      id: 'docs-admins',
      unitId: 'acme',
      parentGroupId: null,
      name: 'Docs admins',
      now: NOW,
    })
    await uow.repos.groups.addMember({ groupId: 'docs-admins', userId: GROUP_ADMIN, now: NOW })
    await grant('group', 'docs-admins', 'owner')
    // An admin of the unit, which the workspace inherits from.
    await grant('user', UNIT_ADMIN, 'admin', { scopeKind: 'unit', scopeId: 'acme' })
    // An admin of the unit whom the workspace denies.
    await grant('user', DENIED, 'admin', { scopeKind: 'unit', scopeId: 'acme' })
    await grant('user', DENIED, 'viewer', { effect: 'deny' })
  })

  it('tells everyone who manages the workspace, and the instance admin who configured it', async () => {
    await fail()
    expect(await notifySourceSyncFailure(deps, WORKSPACE)).toBe(4)
    expect((await told()).toSorted()).toEqual(
      [CONFIGURER, ADMIN, GROUP_ADMIN, UNIT_ADMIN].toSorted(),
    )
    const [row] = await uow.repos.notifications.listForUser({
      userId: ADMIN,
      after: null,
      limit: 1,
    })
    expect(row).toMatchObject({
      kind: 'source-sync-failed',
      workspaceId: WORKSPACE,
      failure: { reason: 'command-failed', revision: null },
      createdAt: clock.now(),
      readAt: null,
    })
  })

  it('tells a failure once, however many attempts it stops', async () => {
    await fail()
    await notifySourceSyncFailure(deps, WORKSPACE)
    await fail({ ...FETCH_FAILED, message: 'git fetch failed: reset by peer' })
    expect(await notifySourceSyncFailure(deps, WORKSPACE)).toBe(0)
    expect(await told()).toHaveLength(4)
  })

  it('tells a different failure, and the same one again after a sync that finished', async () => {
    await fail()
    await notifySourceSyncFailure(deps, WORKSPACE)
    await fail({ reason: 'invalid-manifest', message: 'line 3', revision: 'abc' })
    expect(await notifySourceSyncFailure(deps, WORKSPACE)).toBe(4)

    await uow.repos.sourceSyncState.recordSynced({
      workspaceId: WORKSPACE,
      revision: 'def',
      refused: [],
      layout: { origin: 'settings', fingerprint: '[]', collectionIds: [], unknownKeys: [] },
      brokenLinks: [],
      now: clock.now(),
    })
    expect(await notifySourceSyncFailure(deps, WORKSPACE)).toBe(0)
    await fail()
    expect(await notifySourceSyncFailure(deps, WORKSPACE)).toBe(4)
    expect(await told()).toHaveLength(12)
  })

  it('tells nobody when nothing failed, or the workspace has never synced', async () => {
    expect(await notifySourceSyncFailure(deps, WORKSPACE)).toBe(0)
    expect(await notifySourceSyncFailure(deps, OTHER)).toBe(0)
  })

  it('tells nobody twice when two deliveries race', async () => {
    await fail()
    const [first, second] = await Promise.all([
      notifySourceSyncFailure(deps, WORKSPACE),
      notifySourceSyncFailure(deps, WORKSPACE),
    ])
    expect([first, second].toSorted()).toEqual([0, 4])
  })

  it('leaves out a configurer who is no longer an administrator', async () => {
    await uow.repos.users.setInstanceAdmin(CONFIGURER, false)
    await fail()
    expect(await notifySourceSyncFailure(deps, WORKSPACE)).toBe(3)
  })

  it('caps how many are told', async () => {
    const many = Array.from({ length: MAX_SOURCE_FAILURE_RECIPIENTS + 5 }, (_, index) =>
      userId(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    )
    for (const [index, id] of many.entries()) {
      await person(id, `Person${index}`)
      await uow.repos.groups.addMember({ groupId: 'docs-admins', userId: id, now: NOW })
    }
    await fail()
    // Those asked about are capped, and the one the workspace denies is among them.
    expect(await notifySourceSyncFailure(deps, WORKSPACE)).toBe(MAX_SOURCE_FAILURE_RECIPIENTS - 1)
  })

  it('tells nobody about a workspace that has gone, or whose units cannot be placed', async () => {
    await fail()
    const gone = createInMemoryUnitOfWork()
    await gone.repos.workspaces.create({
      id: WORKSPACE,
      unitId: 'missing-unit',
      name: 'Orphan',
      slug: 'orphan',
      now: NOW,
    })
    await gone.repos.workspaceSources.put({
      workspaceId: WORKSPACE,
      remote: 'https://github.com/acme/handbook.git',
      branch: 'main',
      collections: [],
      history: 'full',
      commitMessages: 'subject',
      manifestEntry: null,
      credential: null,
      webhookSecretName: null,
      outsideLinks: 'forge',
      viewTemplate: null,
      configuredBy: null as unknown as UserId,
      now: NOW,
    })
    await gone.repos.sourceSyncState.recordFailure({
      workspaceId: WORKSPACE,
      failure: FETCH_FAILED,
      now: NOW,
    })
    expect(await notifySourceSyncFailure({ ...deps, uow: gone }, WORKSPACE)).toBe(0)
    // The failure is still recorded as told, so it is not tried again on every attempt.
    expect((await gone.repos.sourceSyncState.find(WORKSPACE))?.failureNotified).toBe(
      'command-failed@',
    )

    const empty = createInMemoryUnitOfWork()
    await empty.repos.sourceSyncState.recordFailure({
      workspaceId: WORKSPACE,
      failure: FETCH_FAILED,
      now: NOW,
    })
    expect(await notifySourceSyncFailure({ ...deps, uow: empty }, WORKSPACE)).toBe(0)
  })
})

describe('listNotifications: a source that stopped syncing', () => {
  function authorizerFor(user: UserId) {
    return createAuthorizer(uow.repos, { userId: user, shareLinkToken: null }, deps)
  }

  it('shows the workspace and the failure to whoever still manages it', async () => {
    await grant('user', ADMIN, 'admin')
    await fail({ reason: 'branch-not-found', message: 'no main', revision: null })
    await notifySourceSyncFailure(deps, WORKSPACE)

    const result = await listNotifications(deps, {
      userId: ADMIN,
      authorizer: authorizerFor(ADMIN),
    })
    expect(result).toMatchObject({
      kind: 'listed',
      unread: 1,
      items: [
        {
          kind: 'source-sync-failed',
          workspace: { id: WORKSPACE, slug: 'handbook', name: 'handbook' },
          failure: { reason: 'branch-not-found', revision: null },
          at: clock.now(),
          readAt: null,
        },
      ],
    })

    // Demoted: the row is kept, and no longer shown.
    await grant('user', ADMIN, 'admin', { effect: 'deny' })
    const after = await listNotifications(deps, { userId: ADMIN, authorizer: authorizerFor(ADMIN) })
    expect(after).toMatchObject({ kind: 'listed', items: [], unread: 1 })
  })

  it('leaves out a workspace that has gone', async () => {
    await grant('user', ADMIN, 'admin')
    await fail()
    await notifySourceSyncFailure(deps, WORKSPACE)
    const result = await listNotifications(
      { uow },
      {
        userId: ADMIN,
        authorizer: createAuthorizer(
          createInMemoryUnitOfWork().repos,
          { userId: ADMIN, shareLinkToken: null },
          deps,
        ),
      },
    )
    expect(result).toMatchObject({ kind: 'listed', items: [] })
  })
})
