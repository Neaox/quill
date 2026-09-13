import { workspaceId as toWorkspaceId, type UserId, type WorkspaceId } from '@quill/domain'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Layout } from '../settings/layout.ts'
import {
  defaultOrganisationSettings,
  defaultWorkspaceSettings,
  SETTINGS_VERSION,
} from '../settings/documents.ts'
import { encodeSettings } from '../settings/yaml.ts'
import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createFakeSettings, type FakeSettings } from '../test-support/fake-settings.ts'
import {
  createInMemoryUnitOfWork,
  type InMemoryUnitOfWork,
} from '../test-support/in-memory-repositories.ts'
import {
  readEffectiveSettings,
  readOrganisationSettings,
  readWorkspaceSettings,
  SETTINGS_AUDIT_EVENTS,
  updateOrganisationSettings,
  updateWorkspaceSettings,
  type SettingsDependencies,
} from './settings.ts'

const ACTOR = 'user-1' as UserId
const AUTHOR = { name: 'Ada Lovelace', email: 'ada@example.com' }
const WORKSPACE: WorkspaceId = toWorkspaceId('11111111-1111-4111-8111-111111111111')

const OVERRIDE: Layout = {
  comments: 'sidenotes',
  history: 'menu',
  navigation: 'tabs',
  header: 'breadcrumb',
  rules: 'cards',
}

let settings: FakeSettings
let uow: InMemoryUnitOfWork
let deps: SettingsDependencies

beforeEach(() => {
  settings = createFakeSettings()
  uow = createInMemoryUnitOfWork()
  deps = {
    settings,
    uow,
    clock: createFakeClock(new Date('2026-01-01T00:00:00.000Z')),
    ids: createFakeIdGenerator(),
  }
})

function command(document: unknown, expectedRevision: string | null = null) {
  return {
    document,
    expectedRevision: expectedRevision as never,
    actor: ACTOR,
    author: AUTHOR,
  }
}

describe('reading organisation settings', () => {
  it('answers with the defaults, and a null revision, before anything is saved', async () => {
    expect(await readOrganisationSettings(deps)).toEqual({
      kind: 'settings',
      document: defaultOrganisationSettings(),
      revision: null,
    })
  })

  it('answers with what was saved, and the revision it was saved at', async () => {
    const saved = { ...defaultOrganisationSettings(), name: 'Acme' }
    const written = await updateOrganisationSettings(deps, command(saved))
    if (written.kind !== 'updated') throw new Error(`expected an update, got ${written.kind}`)
    expect(await readOrganisationSettings(deps)).toEqual({
      kind: 'settings',
      document: saved,
      revision: written.revision,
    })
  })

  it('reports a file it cannot read rather than quietly replacing it with the defaults', async () => {
    settings.place('organisation', `version: ${SETTINGS_VERSION + 1}\nname: Acme\n`)
    expect(await readOrganisationSettings(deps)).toMatchObject({ kind: 'unreadable' })
  })
})

describe('updating organisation settings', () => {
  it('writes the document and hands back the revision it landed at', async () => {
    const result = await updateOrganisationSettings(
      deps,
      command({ ...defaultOrganisationSettings(), name: 'Acme' }),
    )
    expect(result).toMatchObject({ kind: 'updated', document: { name: 'Acme' } })
  })

  it('returns the theme doctor’s report beside the saved document', async () => {
    const result = await updateOrganisationSettings(deps, command(defaultOrganisationSettings()))
    if (result.kind !== 'updated') throw new Error(`expected an update, got ${result.kind}`)
    expect(result.report.themeId).toBe(defaultOrganisationSettings().theme.id)
    expect(result.report.results.length).toBeGreaterThan(0)
  })

  it('saves a theme the doctor warns about: the report advises, it does not block', async () => {
    const base = defaultOrganisationSettings()
    const shouty = {
      ...base,
      theme: {
        ...base.theme,
        // A near-white accent: readable as a mark, not as text. ADR-028 says
        // the tenant may keep it, with the reason beside it.
        seeds: { ...base.theme.seeds, accent: { hue: 95, chroma: 0.2, lightness: 96 } },
      },
    }
    const result = await updateOrganisationSettings(deps, command(shouty))
    if (result.kind !== 'updated') throw new Error(`expected an update, got ${result.kind}`)
    expect(result.report.warnings.length + result.report.summary.adjusted).toBeGreaterThan(0)
    expect(await readOrganisationSettings(deps)).toMatchObject({ kind: 'settings' })
  })

  /**
   * ADR-028's instance switch. It changes what the doctor calls enforced, and
   * never whether the save is accepted — both halves are asserted here.
   */
  it('reports against the organisation’s own contrast enforcement', async () => {
    const base = defaultOrganisationSettings()
    const enforced = await updateOrganisationSettings(deps, command(base))
    if (enforced.kind !== 'updated') throw new Error(`expected an update, got ${enforced.kind}`)
    expect(enforced.report.results.some((result) => result.enforced)).toBe(true)

    const advisory = await updateOrganisationSettings(
      deps,
      command(
        { ...base, policies: { ...base.policies, contrastEnforcement: 'advisory' } },
        enforced.revision,
      ),
    )
    if (advisory.kind !== 'updated') throw new Error(`expected an update, got ${advisory.kind}`)
    expect(advisory.report.results.some((result) => result.enforced)).toBe(false)
    expect(advisory.report.enforcedRulesHold).toBe(true)
  })

  it('refuses an invalid document without writing anything', async () => {
    const result = await updateOrganisationSettings(
      deps,
      command({ ...defaultOrganisationSettings(), name: '' }),
    )
    expect(result).toMatchObject({ kind: 'invalid' })
    expect(settings.writes).toEqual([])
  })

  it('refuses a second writer who based their change on an older revision', async () => {
    const first = await updateOrganisationSettings(deps, command(defaultOrganisationSettings()))
    if (first.kind !== 'updated') throw new Error('expected the first write to land')
    await updateOrganisationSettings(
      deps,
      command({ ...defaultOrganisationSettings(), name: 'Acme' }, first.revision),
    )

    const stale = await updateOrganisationSettings(
      deps,
      command({ ...defaultOrganisationSettings(), name: 'Other' }, first.revision),
    )
    expect(stale.kind).toBe('conflict')
    if (stale.kind !== 'conflict') throw new Error('expected a conflict')
    expect(stale.current).toMatchObject({ kind: 'settings', document: { name: 'Acme' } })
  })

  it('refuses a first writer whose expectation of "nothing saved" no longer holds', async () => {
    await updateOrganisationSettings(deps, command(defaultOrganisationSettings()))
    expect(
      await updateOrganisationSettings(deps, command(defaultOrganisationSettings())),
    ).toMatchObject({ kind: 'conflict' })
  })

  it('reports the defaults in a conflict when the file it expected has gone', async () => {
    const result = await updateOrganisationSettings(
      deps,
      command(defaultOrganisationSettings(), '0'.repeat(40)),
    )
    expect(result).toMatchObject({
      kind: 'conflict',
      current: { kind: 'settings', document: defaultOrganisationSettings(), revision: null },
    })
  })

  it('reports the current file in a conflict even when nobody can read it', async () => {
    settings.place('organisation', 'not: [valid\n')
    const result = await updateOrganisationSettings(deps, command(defaultOrganisationSettings()))
    expect(result).toMatchObject({ kind: 'conflict', current: { kind: 'unreadable' } })
  })

  it('audits the change with the fields that changed and no values', async () => {
    await updateOrganisationSettings(deps, command(defaultOrganisationSettings()))
    const result = await updateOrganisationSettings(
      deps,
      command(
        {
          ...defaultOrganisationSettings(),
          name: 'Acme',
          policies: {
            ...defaultOrganisationSettings().policies,
            shareLinksAllowed: false,
            publicPublishingAllowed: true,
          },
        },
        (await readOrganisationSettings(deps)).revision,
      ),
    )
    if (result.kind !== 'updated') throw new Error(`expected an update, got ${result.kind}`)
    const [, second] = uow.auditEvents
    expect(second).toMatchObject({
      type: SETTINGS_AUDIT_EVENTS.organisationUpdated,
      actorUserId: ACTOR,
      targetType: 'organisation',
      metadata: { revision: result.revision, changed: ['name', 'policies'] },
    })
    expect(JSON.stringify(second?.metadata)).not.toContain('Acme')
  })

  it('carries a change note into the file’s history', async () => {
    await updateOrganisationSettings(deps, {
      ...command(defaultOrganisationSettings()),
      changeNote: 'Brand refresh',
    })
    expect(settings.writes).toEqual([{ path: 'organisation', changeNote: 'Brand refresh' }])
  })
})

describe('workspace settings', () => {
  it('answer with the defaults before a workspace has a file', async () => {
    expect(await readWorkspaceSettings(deps, WORKSPACE)).toEqual({
      kind: 'settings',
      document: defaultWorkspaceSettings(WORKSPACE),
      revision: null,
    })
  })

  it('accept a layout override when the organisation allows one', async () => {
    const result = await updateWorkspaceSettings(
      deps,
      WORKSPACE,
      command({ ...defaultWorkspaceSettings(WORKSPACE), layout: OVERRIDE }),
    )
    expect(result).toMatchObject({ kind: 'updated', document: { layout: OVERRIDE } })
  })

  it('are refused when the organisation locked layout (ADR-028)', async () => {
    const base = defaultOrganisationSettings()
    await updateOrganisationSettings(
      deps,
      command({ ...base, layout: { ...base.layout, locked: true } }),
    )
    const result = await updateWorkspaceSettings(
      deps,
      WORKSPACE,
      command({ ...defaultWorkspaceSettings(WORKSPACE), layout: OVERRIDE }),
    )
    expect(result).toEqual({ kind: 'layout-locked' })
  })

  it('may still be saved without an override while layout is locked', async () => {
    const base = defaultOrganisationSettings()
    await updateOrganisationSettings(
      deps,
      command({ ...base, layout: { ...base.layout, locked: true } }),
    )
    expect(
      await updateWorkspaceSettings(deps, WORKSPACE, command(defaultWorkspaceSettings(WORKSPACE))),
    ).toMatchObject({ kind: 'updated' })
  })

  it('refuse a document that names a different workspace', async () => {
    const result = await updateWorkspaceSettings(
      deps,
      WORKSPACE,
      command(defaultWorkspaceSettings('another')),
    )
    expect(result).toMatchObject({
      kind: 'invalid',
      issues: [{ rule: 'workspace-mismatch' }],
    })
  })

  it('refuse an invalid document', async () => {
    expect(
      await updateWorkspaceSettings(deps, WORKSPACE, command({ version: SETTINGS_VERSION })),
    ).toMatchObject({ kind: 'invalid' })
  })

  it('refuse a write while the organisation’s own file cannot be read', async () => {
    settings.place('organisation', `version: ${SETTINGS_VERSION + 1}\n`)
    expect(
      await updateWorkspaceSettings(deps, WORKSPACE, command(defaultWorkspaceSettings(WORKSPACE))),
    ).toMatchObject({ kind: 'organisation-unreadable' })
  })

  it('refuse a writer whose expectation no longer holds', async () => {
    await updateWorkspaceSettings(deps, WORKSPACE, command(defaultWorkspaceSettings(WORKSPACE)))
    expect(
      await updateWorkspaceSettings(deps, WORKSPACE, command(defaultWorkspaceSettings(WORKSPACE))),
    ).toMatchObject({ kind: 'conflict' })
  })

  it('report the defaults in a conflict when the file they expected has gone', async () => {
    expect(
      await updateWorkspaceSettings(
        deps,
        WORKSPACE,
        command(defaultWorkspaceSettings(WORKSPACE), '0'.repeat(40)),
      ),
    ).toMatchObject({
      kind: 'conflict',
      current: { kind: 'settings', document: defaultWorkspaceSettings(WORKSPACE), revision: null },
    })
  })

  it('carry a change note into the file’s history', async () => {
    await updateWorkspaceSettings(deps, WORKSPACE, {
      ...command(defaultWorkspaceSettings(WORKSPACE)),
      changeNote: 'Switched to tabs',
    })
    expect(settings.writes).toEqual([{ path: WORKSPACE, changeNote: 'Switched to tabs' }])
  })

  it('are audited against the workspace, naming the layout it now has', async () => {
    const result = await updateWorkspaceSettings(
      deps,
      WORKSPACE,
      command({ ...defaultWorkspaceSettings(WORKSPACE), layout: OVERRIDE }),
    )
    if (result.kind !== 'updated') throw new Error(`expected an update, got ${result.kind}`)
    expect(uow.auditEvents.at(-1)).toMatchObject({
      type: SETTINGS_AUDIT_EVENTS.workspaceUpdated,
      targetType: 'workspace',
      targetId: WORKSPACE,
      metadata: { layout: OVERRIDE },
    })
  })

  it('record a null layout in the audit row when the workspace goes back to inheriting', async () => {
    await updateWorkspaceSettings(deps, WORKSPACE, command(defaultWorkspaceSettings(WORKSPACE)))
    expect(uow.auditEvents.at(-1)?.metadata).toMatchObject({ layout: null })
  })

  it('report a file this release cannot read', async () => {
    settings.place(WORKSPACE, `version: ${SETTINGS_VERSION + 1}\nworkspaceId: ${WORKSPACE}\n`)
    expect(await readWorkspaceSettings(deps, WORKSPACE)).toMatchObject({ kind: 'unreadable' })
  })
})

describe('effective settings', () => {
  it('resolve the organisation default when the workspace has no override', async () => {
    const result = await readEffectiveSettings(deps, WORKSPACE)
    expect(result).toMatchObject({
      kind: 'settings',
      effective: { layoutSource: 'organisation' },
    })
  })

  it('resolve the workspace’s own layout when it has one', async () => {
    await updateWorkspaceSettings(
      deps,
      WORKSPACE,
      command({ ...defaultWorkspaceSettings(WORKSPACE), layout: OVERRIDE }),
    )
    expect(await readEffectiveSettings(deps, WORKSPACE)).toMatchObject({
      effective: { layout: OVERRIDE, layoutSource: 'workspace' },
    })
  })

  it('fall back to inheriting when the workspace’s own file cannot be read', async () => {
    settings.place(WORKSPACE, 'not: [valid\n')
    expect(await readEffectiveSettings(deps, WORKSPACE)).toMatchObject({
      effective: { layoutSource: 'organisation' },
    })
  })

  it('report an unreadable organisation file, because nothing can be resolved without it', async () => {
    settings.place('organisation', encodeSettings({ ...defaultOrganisationSettings(), name: '' }))
    expect(await readEffectiveSettings(deps, WORKSPACE)).toMatchObject({ kind: 'unreadable' })
  })
})
