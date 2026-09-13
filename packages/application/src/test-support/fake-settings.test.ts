import { workspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import {
  defaultOrganisationSettings,
  defaultWorkspaceSettings,
  SETTINGS_VERSION,
} from '../settings/documents.ts'
import { createFakeSettings } from './fake-settings.ts'

const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const AUTHOR = { name: 'Ada', email: 'ada@example.com' }
const organisation = defaultOrganisationSettings()

describe('the in-memory settings store', () => {
  it('is unset until something is written', async () => {
    const settings = createFakeSettings()
    expect(await settings.readOrganisation()).toEqual({ kind: 'unset' })
    expect(await settings.readWorkspace(WORKSPACE)).toEqual({ kind: 'unset' })
  })

  it('writes, reads back, and hands out a new revision each time', async () => {
    const settings = createFakeSettings()
    const first = await settings.writeOrganisation({
      document: organisation,
      expectedRevision: null,
      author: AUTHOR,
      changeNote: 'First',
    })
    if (first.kind !== 'written') throw new Error('expected the write to land')
    const second = await settings.writeOrganisation({
      document: { ...organisation, name: 'Acme' },
      expectedRevision: first.revision,
      author: AUTHOR,
    })
    if (second.kind !== 'written') throw new Error('expected the second write to land')
    expect(second.revision).not.toBe(first.revision)
    expect(await settings.readOrganisation()).toMatchObject({ document: { name: 'Acme' } })
    expect(settings.writes).toEqual([
      { path: 'organisation', changeNote: 'First' },
      { path: 'organisation' },
    ])
  })

  it('stores the encoded file, which is what a compare-and-swap compares', async () => {
    const settings = createFakeSettings()
    await settings.writeOrganisation({
      document: organisation,
      expectedRevision: null,
      author: AUTHOR,
    })
    expect(settings.fileAt('organisation')).toContain('name:')
    expect(settings.fileAt(WORKSPACE)).toBeUndefined()
  })

  it('refuses a write based on the wrong revision', async () => {
    const settings = createFakeSettings()
    await settings.writeOrganisation({
      document: organisation,
      expectedRevision: null,
      author: AUTHOR,
    })
    expect(
      await settings.writeOrganisation({
        document: organisation,
        expectedRevision: null,
        author: AUTHOR,
      }),
    ).toMatchObject({ kind: 'conflict', current: { kind: 'settings' } })
  })

  it('keeps each workspace’s file separate', async () => {
    const settings = createFakeSettings()
    const other = workspaceId('00000000-0000-4000-8000-000000000102')
    await settings.writeWorkspace(WORKSPACE, {
      document: defaultWorkspaceSettings(WORKSPACE),
      expectedRevision: null,
      author: AUTHOR,
    })
    expect(await settings.readWorkspace(other)).toEqual({ kind: 'unset' })
  })

  it('refuses a workspace write based on the wrong revision', async () => {
    const settings = createFakeSettings()
    await settings.writeWorkspace(WORKSPACE, {
      document: defaultWorkspaceSettings(WORKSPACE),
      expectedRevision: null,
      author: AUTHOR,
    })
    expect(
      await settings.writeWorkspace(WORKSPACE, {
        document: defaultWorkspaceSettings(WORKSPACE),
        expectedRevision: null,
        author: AUTHOR,
      }),
    ).toMatchObject({ kind: 'conflict' })
  })

  it('reads a planted file with the real reader, and refuses one it cannot understand', async () => {
    const settings = createFakeSettings()
    settings.place('organisation', `version: ${SETTINGS_VERSION + 1}\n`)
    settings.place(WORKSPACE, `version: ${SETTINGS_VERSION + 1}\nworkspaceId: ${WORKSPACE}\n`)
    expect(await settings.readOrganisation()).toMatchObject({ kind: 'unreadable' })
    expect(await settings.readWorkspace(WORKSPACE)).toMatchObject({ kind: 'unreadable' })
  })
})
