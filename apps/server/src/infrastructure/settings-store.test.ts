import {
  decodeOrganisationSettings,
  defaultOrganisationSettings,
  defaultWorkspaceSettings,
  encodeSettings,
  ORGANISATION_SETTINGS_PATH,
  SETTINGS_VERSION,
  SYSTEM_WORKSPACE_ID,
  workspaceSettingsPath,
} from '@quill/application'
import type { ContentStore, Settings, SettingsWrite } from '@quill/application'
import { workspaceId } from '@quill/domain'
import type { RevisionId } from '@quill/domain'
import { beforeEach, describe, expect, it } from 'vitest'

import { createFakeClock } from '../test-support/fakes.ts'
import { createContentStore } from './content-store.ts'
import { createSettingsStore } from './settings-store.ts'

const AUTHOR = { name: 'Ada Lovelace', email: 'ada@example.com' }
const WORKSPACE = workspaceId('11111111-1111-4111-8111-111111111111')
const OTHER_WORKSPACE = workspaceId('22222222-2222-4222-8222-222222222222')
const organisation = defaultOrganisationSettings()

let contentStore: ContentStore
let settings: Settings

beforeEach(() => {
  contentStore = createContentStore(
    { driver: 'memory' },
    createFakeClock(new Date('2026-01-01T00:00:00.000Z')),
  )
  settings = createSettingsStore(contentStore)
})

const writeOrganisation = async (name: string, expectedRevision: RevisionId | null) =>
  await settings.writeOrganisation({
    document: { ...organisation, name },
    expectedRevision,
    author: AUTHOR,
  })

const landed = <T>(result: SettingsWrite<T>): RevisionId => {
  if (result.kind !== 'written') throw new Error(`Expected a write, got ${result.kind}`)
  return result.revision
}

describe('organisation settings as a file', () => {
  it('is unset before anything is written', async () => {
    expect(await settings.readOrganisation()).toEqual({ kind: 'unset' })
  })

  it('writes the YAML file the ADR names, in the system workspace', async () => {
    await writeOrganisation('Acme', null)
    const file = await contentStore.readFile(SYSTEM_WORKSPACE_ID, ORGANISATION_SETTINGS_PATH)
    expect(file?.text).toBe(encodeSettings({ ...organisation, name: 'Acme' }))
    expect(decodeOrganisationSettings(file?.text ?? '')).toMatchObject({ kind: 'settings' })
  })

  it('reads back what it wrote, at the revision it wrote it at', async () => {
    const revision = landed(await writeOrganisation('Acme', null))
    expect(await settings.readOrganisation()).toEqual({
      kind: 'settings',
      document: { ...organisation, name: 'Acme' },
      revision,
    })
  })

  /** The point of a file: settings get history and restore like documents. */
  it('keeps every earlier version of the file', async () => {
    const first = landed(await writeOrganisation('Acme', null))
    const second = landed(await writeOrganisation('Acme Corporation', first))
    expect(second).not.toBe(first)
    const before = await contentStore.readFile(
      SYSTEM_WORKSPACE_ID,
      ORGANISATION_SETTINGS_PATH,
      first,
    )
    expect(decodeOrganisationSettings(before?.text ?? '')).toMatchObject({
      kind: 'settings',
      document: { name: 'Acme' },
    })
  })

  it('refuses a write based on a revision the file has moved on from', async () => {
    const first = landed(await writeOrganisation('Acme', null))
    await writeOrganisation('Acme Corporation', first)
    const stale = await writeOrganisation('Something else', first)
    expect(stale).toMatchObject({
      kind: 'conflict',
      current: { kind: 'settings', document: { name: 'Acme Corporation' } },
    })
  })

  it('refuses a create when the file is already there', async () => {
    await writeOrganisation('Acme', null)
    expect(await writeOrganisation('Other', null)).toMatchObject({ kind: 'conflict' })
  })

  it('refuses a write based on a revision the store never had', async () => {
    await writeOrganisation('Acme', null)
    expect(await writeOrganisation('Other', 'a'.repeat(40) as RevisionId)).toMatchObject({
      kind: 'conflict',
    })
  })

  /**
   * The revision is the whole system workspace's, and it moves whenever any
   * settings file changes. Comparing bytes rather than revisions is what stops
   * two administrators configuring two different workspaces from colliding.
   */
  it('lets a write through when the head moved but this file did not', async () => {
    const first = landed(await writeOrganisation('Acme', null))
    await settings.writeWorkspace(WORKSPACE, {
      document: defaultWorkspaceSettings(WORKSPACE),
      expectedRevision: null,
      author: AUTHOR,
    })
    expect(await writeOrganisation('Acme Corporation', first)).toMatchObject({ kind: 'written' })
  })

  it('reports a file this release cannot read, with the revision it read it at', async () => {
    await contentStore.putFile({
      workspaceId: SYSTEM_WORKSPACE_ID,
      path: ORGANISATION_SETTINGS_PATH,
      text: `version: ${SETTINGS_VERSION + 1}\nname: Acme\n`,
      expected: null,
      author: AUTHOR,
    })
    const read = await settings.readOrganisation()
    expect(read).toMatchObject({ kind: 'unreadable' })
    if (read.kind !== 'unreadable') throw new Error('expected it to be unreadable')
    expect(read.revision).toBe(await contentStore.head(SYSTEM_WORKSPACE_ID))
  })

  it('reports an unreadable file in a conflict too', async () => {
    await contentStore.putFile({
      workspaceId: SYSTEM_WORKSPACE_ID,
      path: ORGANISATION_SETTINGS_PATH,
      text: 'not: [valid\n',
      expected: null,
      author: AUTHOR,
    })
    expect(await writeOrganisation('Acme', null)).toMatchObject({
      kind: 'conflict',
      current: { kind: 'unreadable' },
    })
  })
})

describe('workspace settings as a file', () => {
  const write = async (id = WORKSPACE, expectedRevision: RevisionId | null = null) =>
    await settings.writeWorkspace(id, {
      document: defaultWorkspaceSettings(id),
      expectedRevision,
      author: AUTHOR,
    })

  it('is unset before anything is written', async () => {
    expect(await settings.readWorkspace(WORKSPACE)).toEqual({ kind: 'unset' })
  })

  it('writes one file per workspace, under its own id', async () => {
    await write()
    expect(
      await contentStore.readFile(SYSTEM_WORKSPACE_ID, workspaceSettingsPath(WORKSPACE)),
    ).not.toBeNull()
    expect(await settings.readWorkspace(OTHER_WORKSPACE)).toEqual({ kind: 'unset' })
  })

  it('reads back what it wrote', async () => {
    const revision = landed(await write())
    expect(await settings.readWorkspace(WORKSPACE)).toEqual({
      kind: 'settings',
      document: defaultWorkspaceSettings(WORKSPACE),
      revision,
    })
  })

  it('refuses a write whose expectation no longer holds', async () => {
    await write()
    expect(await write()).toMatchObject({ kind: 'conflict' })
  })

  it('reports a file this release cannot read', async () => {
    await contentStore.putFile({
      workspaceId: SYSTEM_WORKSPACE_ID,
      path: workspaceSettingsPath(WORKSPACE),
      text: `version: ${SETTINGS_VERSION + 1}\nworkspaceId: ${WORKSPACE}\n`,
      expected: null,
      author: AUTHOR,
    })
    expect(await settings.readWorkspace(WORKSPACE)).toMatchObject({ kind: 'unreadable' })
  })

  it('keeps the documents of ordinary workspaces out of it entirely', async () => {
    await write()
    expect(await contentStore.listTree(SYSTEM_WORKSPACE_ID)).toEqual([
      { path: workspaceSettingsPath(WORKSPACE), kind: 'other' },
    ])
  })
})
