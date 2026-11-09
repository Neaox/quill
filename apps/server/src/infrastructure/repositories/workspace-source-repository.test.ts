import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { NATIVE_ORIGIN, SOURCED_ORIGIN, userId, workspaceId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createUnitRepository } from './unit-repository.ts'
import { createUserRepository } from './user-repository.ts'
import { createWorkspaceRepository } from './workspace-repository.ts'
import { createWorkspaceSourceRepository } from './workspace-source-repository.ts'

/** Where a sourced workspace reads from (ADR-061), against a real Postgres. */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const LATER = new Date('2026-01-02T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER = workspaceId('00000000-0000-4000-8000-000000000102')
const ADMIN = userId('00000000-0000-4000-8000-000000000001')

let database: TestDatabase
let sources: ReturnType<typeof createWorkspaceSourceRepository>
let workspaces: ReturnType<typeof createWorkspaceRepository>

const settings = {
  workspaceId: WORKSPACE,
  remote: 'https://github.com/acme/handbook.git',
  branch: 'main',
  collections: [{ collectionId: 'c-guides', path: 'docs/guides' }],
  history: 'full',
  commitMessages: 'subject',
  manifestEntry: null,
  credential: null,
  outsideLinks: 'forge',
  viewTemplate: null,
  webhookSecretName: null,
  configuredBy: ADMIN,
  now: NOW,
} as const

/** Each workspace's origin, by slug. */
const origins = (rows: readonly { slug: string; origin: unknown }[]) =>
  Object.fromEntries(rows.map((row) => [row.slug, row.origin]))

beforeAll(async () => {
  database = await createTestDatabase()
  sources = createWorkspaceSourceRepository(database.db)
  workspaces = createWorkspaceRepository(database.db)
  await createUnitRepository(database.db).create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await createUserRepository(database.db).create({
    id: ADMIN,
    email: 'admin@example.com',
    displayName: 'Admin',
    now: NOW,
  })
  for (const [id, slug] of [
    [WORKSPACE, 'handbook'],
    [OTHER, 'other'],
  ] as const) {
    await workspaces.create({ id, unitId: 'acme', name: slug, slug, now: NOW })
  }
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM workspace_sources')
})

describe('the workspace source repository', () => {
  it('answers null for a workspace with no source', async () => {
    expect(await sources.find(WORKSPACE)).toBeNull()
  })

  it('stores a source and reads it back', async () => {
    const stored = await sources.put(settings)
    const expected = {
      workspaceId: WORKSPACE,
      remote: settings.remote,
      branch: 'main',
      collections: settings.collections,
      history: 'full',
      commitMessages: 'subject',
      manifestEntry: null,
      credential: null,
      outsideLinks: 'forge',
      viewTemplate: null,
      webhookSecretName: null,
      configuredBy: ADMIN,
      createdAt: NOW,
      updatedAt: NOW,
    }
    expect(stored).toEqual(expected)
    expect(await sources.find(WORKSPACE)).toEqual(expected)
    expect(await sources.find(OTHER)).toBeNull()
  })

  it('lists every sourced workspace, for the reconciliation', async () => {
    expect(await sources.listWorkspaceIds()).toEqual([])
    await sources.put({ ...settings, webhookSecretName: 'sources/handbook-webhook' })
    await sources.put({ ...settings, workspaceId: OTHER })
    expect(await sources.listWorkspaceIds()).toEqual([WORKSPACE, OTHER].toSorted())
    expect((await sources.find(WORKSPACE))?.webhookSecretName).toBe('sources/handbook-webhook')
  })

  it('replaces the settings whole and keeps when it was first configured', async () => {
    await sources.put(settings)
    const credential = { username: 'x-access-token', secretName: 'sources/handbook' }
    const replaced = await sources.put({
      ...settings,
      branch: 'release',
      history: 'head',
      commitMessages: 'none',
      manifestEntry: 'public',
      credential,
      outsideLinks: 'text',
      viewTemplate: 'https://git.example.com/acme/handbook/src/{commit}/{path}',
      now: LATER,
    })
    expect(replaced).toMatchObject({
      branch: 'release',
      history: 'head',
      commitMessages: 'none',
      manifestEntry: 'public',
      credential,
      outsideLinks: 'text',
      viewTemplate: 'https://git.example.com/acme/handbook/src/{commit}/{path}',
      createdAt: NOW,
      updatedAt: LATER,
    })
    expect(await sources.find(WORKSPACE)).toEqual(replaced)
  })

  it('refuses collections it cannot read rather than reading them as none', async () => {
    await sources.put(settings)
    for (const collections of [
      { version: 2, collections: [] },
      { version: 1, collections: [{ collectionId: 'c', path: 7 }] },
      { version: 1 },
      [],
    ]) {
      await database.pool.query('UPDATE workspace_sources SET collections = $1', [
        JSON.stringify(collections),
      ])
      await expect(sources.find(WORKSPACE)).rejects.toThrow('cannot read')
    }
  })

  it('refuses a setting this release does not know', async () => {
    await sources.put(settings)
    await database.pool.query(
      'ALTER TABLE workspace_sources DROP CONSTRAINT workspace_sources_history_check',
    )
    try {
      await database.pool.query(`UPDATE workspace_sources SET history = 'since'`)
      await expect(sources.find(WORKSPACE)).rejects.toThrow('unknown setting "since"')
    } finally {
      await database.pool.query('DELETE FROM workspace_sources')
      await database.pool.query(
        `ALTER TABLE workspace_sources ADD CONSTRAINT workspace_sources_history_check CHECK (history IN ('full', 'head'))`,
      )
    }
  })

  it('refuses half a credential', async () => {
    await sources.put(settings)
    await expect(
      database.pool.query(`UPDATE workspace_sources SET credential_username = 'x'`),
    ).rejects.toThrow('workspace_sources_credential_check')
  })

  it('makes the workspace sourced, in every way the workspace is read', async () => {
    expect((await workspaces.findById(WORKSPACE))?.origin).toEqual(NATIVE_ORIGIN)
    await sources.put(settings)

    expect((await workspaces.findById(WORKSPACE))?.origin).toEqual(SOURCED_ORIGIN)
    expect((await workspaces.findBySlug('handbook'))?.origin).toEqual(SOURCED_ORIGIN)
    expect(origins(await workspaces.listAll())).toEqual({
      handbook: SOURCED_ORIGIN,
      other: NATIVE_ORIGIN,
    })
    expect(origins(await workspaces.listByUnit('acme'))).toEqual({
      handbook: SOURCED_ORIGIN,
      other: NATIVE_ORIGIN,
    })
    expect((await workspaces.rename(WORKSPACE, 'Handbook'))?.origin).toEqual(SOURCED_ORIGIN)
  })
})
