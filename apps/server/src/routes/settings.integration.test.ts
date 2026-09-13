import {
  defaultOrganisationSettings,
  defaultWorkspaceSettings,
  ORGANISATION_SETTINGS_PATH,
  SETTINGS_VERSION,
  SYSTEM_WORKSPACE_ID,
  workspaceSettingsPath,
} from '@quill/application'
import type { Layout, OrganisationSettings } from '@quill/application'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * Settings and secrets through HTTP (ADR-034).
 *
 * The whole stack: TypeBox validation, the authorisation rules, the use
 * cases, the real settings adapter over the real content store, and the real
 * envelope cipher over a real master key. Three properties are asserted here
 * and nowhere else, because only here are they properties of the *product*:
 * who may change what, that a concurrent write is refused rather than merged,
 * and that no response and no audit row carries a secret's value.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
let viewer: Record<string, string>
let outsider: Record<string, string>

const OVERRIDE: Layout = {
  comments: 'sidenotes',
  history: 'menu',
  navigation: 'tabs',
  header: 'breadcrumb',
  rules: 'cards',
}

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
  outsider = await harness.cookiesFor(tenancy.outsider)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

const readOrganisation = (cookies = admin) =>
  harness.app.inject({ method: 'GET', url: '/api/settings/organisation', cookies })

const writeOrganisation = (
  settings: OrganisationSettings,
  expectedRevision: string | null,
  cookies = admin,
  changeNote?: string,
) =>
  harness.app.inject({
    method: 'PUT',
    url: '/api/settings/organisation',
    cookies,
    payload: {
      settings,
      expectedRevision,
      ...(changeNote === undefined ? {} : { changeNote }),
    },
  })

const currentRevision = async (): Promise<string | null> =>
  (await readOrganisation()).json<{ revision: string | null }>().revision

describe('organisation settings', () => {
  it('answers with the defaults, and a null revision, before anything is saved', async () => {
    const response = await readOrganisation(viewer)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ revision: null, settings: defaultOrganisationSettings() })
  })

  it('is readable by anyone signed in: every screen renders with it', async () => {
    expect((await readOrganisation(outsider)).statusCode).toBe(200)
  })

  it('needs a session to read at all', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/settings/organisation',
    })
    expect(response.statusCode).toBe(401)
  })

  it('is changed only by an instance administrator', async () => {
    for (const cookies of [editor, viewer, outsider]) {
      const response = await writeOrganisation(defaultOrganisationSettings(), null, cookies)
      expect(response.statusCode).toBe(403)
    }
  })

  it('saves, answers with the new revision, and reads back', async () => {
    const saved = { ...defaultOrganisationSettings(), name: 'Acme' }
    const response = await writeOrganisation(saved, await currentRevision(), admin, 'Named us')
    expect(response.statusCode).toBe(200)
    const body = response.json() as { revision: string; settings: OrganisationSettings }
    expect(body.settings).toEqual(saved)
    expect(body.revision).toMatch(/^[0-9a-f]{40}$/)
    expect((await readOrganisation()).json()).toEqual({ revision: body.revision, settings: saved })
  })

  it('returns the theme doctor’s report beside the saved settings', async () => {
    const response = await writeOrganisation(
      { ...defaultOrganisationSettings(), name: 'Acme two' },
      await currentRevision(),
    )
    const report = (response.json() as { report: { results: unknown[]; summary: object } }).report
    expect(report.results.length).toBeGreaterThan(0)
    expect(report.summary).toMatchObject({ pass: expect.any(Number) })
  })

  it('refuses a second writer who based their change on an older revision', async () => {
    const base = await currentRevision()
    expect(
      (await writeOrganisation({ ...defaultOrganisationSettings(), name: 'First' }, base))
        .statusCode,
    ).toBe(200)
    const second = await writeOrganisation(
      { ...defaultOrganisationSettings(), name: 'Second' },
      base,
    )
    expect(second.statusCode).toBe(409)
    expect(second.json()).toMatchObject({ error: { code: 'settings_conflict' } })
    expect((await readOrganisation()).json()).toMatchObject({ settings: { name: 'First' } })
  })

  it('refuses an expectedRevision that is not a revision', async () => {
    const response = await writeOrganisation(defaultOrganisationSettings(), 'not-a-revision')
    expect(response.statusCode).toBe(400)
  })

  /**
   * Fastify's default validator *removes* a property the schema does not
   * declare. A settings screen written against a newer release would then be
   * told its change had landed when half of it had been dropped.
   */
  it('refuses a field this release does not know, rather than dropping it', async () => {
    const response = await harness.app.inject({
      method: 'PUT',
      url: '/api/settings/organisation',
      cookies: admin,
      payload: {
        settings: defaultOrganisationSettings(),
        expectedRevision: await currentRevision(),
        somethingANewerReleaseSends: true,
      },
    })
    expect(response.statusCode).toBe(400)
  })

  it('does not coerce a policy sent as a string into a boolean', async () => {
    const base = defaultOrganisationSettings()
    const response = await harness.app.inject({
      method: 'PUT',
      url: '/api/settings/organisation',
      cookies: admin,
      payload: {
        settings: { ...base, policies: { ...base.policies, shareLinksAllowed: 'false' } },
        expectedRevision: await currentRevision(),
      },
    })
    expect(response.statusCode).toBe(400)
  })

  it('refuses settings the schema can catch, at the edge', async () => {
    const response = await writeOrganisation(
      { ...defaultOrganisationSettings(), name: '' },
      await currentRevision(),
    )
    expect(response.statusCode).toBe(400)
  })

  /**
   * The one check a JSON schema cannot make: a curated face has to be offered
   * for the role it is used in (ADR-028). It passes the body schema and is
   * refused by the theme package's own validator, behind the use case.
   */
  it('refuses a theme the schema accepts and the theme package does not', async () => {
    const base = defaultOrganisationSettings()
    const response = await writeOrganisation(
      {
        ...base,
        theme: {
          ...base.theme,
          type: { ...base.theme.type, mono: { source: 'curated', id: 'inter' } },
        },
      },
      await currentRevision(),
    )
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({
      error: { code: 'invalid_settings', details: { issues: [{ path: '/theme/type/mono' }] } },
    })
  })

  it('refuses a layout variant outside the bounded set (ADR-028)', async () => {
    const base = defaultOrganisationSettings()
    const response = await harness.app.inject({
      method: 'PUT',
      url: '/api/settings/organisation',
      cookies: admin,
      payload: {
        settings: {
          ...base,
          layout: { ...base.layout, default: { ...base.layout.default, rules: 'shadows' } },
        },
        expectedRevision: await currentRevision(),
      },
    })
    expect(response.statusCode).toBe(400)
  })

  it('writes an audit row naming the fields that changed and no values', async () => {
    await writeOrganisation(
      {
        ...defaultOrganisationSettings(),
        name: 'Audited',
        policies: {
          ...defaultOrganisationSettings().policies,
          shareLinksAllowed: false,
          publicPublishingAllowed: true,
        },
      },
      await currentRevision(),
    )
    const { rows } = await harness.database.pool.query<{ metadata: unknown }>(
      "SELECT metadata FROM audit_events WHERE type = 'settings.organisation.updated' ORDER BY created_at DESC LIMIT 1",
    )
    expect(rows[0]?.metadata).toMatchObject({ changed: expect.arrayContaining(['name']) })
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain('Audited')
  })
})

describe('workspace settings', () => {
  const url = (): string => `/api/workspaces/${tenancy.workspaceId}/settings`

  const read = (cookies: Record<string, string>) =>
    harness.app.inject({ method: 'GET', url: url(), cookies })

  const write = (
    layout: Layout | undefined,
    expectedRevision: string | null,
    cookies = admin,
    changeNote?: string,
  ) =>
    harness.app.inject({
      method: 'PUT',
      url: url(),
      cookies,
      payload: {
        settings: {
          ...defaultWorkspaceSettings(tenancy.workspaceId),
          ...(layout === undefined ? {} : { layout }),
        },
        expectedRevision,
        ...(changeNote === undefined ? {} : { changeNote }),
      },
    })

  const revision = async (): Promise<string | null> =>
    (await read(admin)).json<{ revision: string | null }>().revision

  it('answers with the defaults and the layout the organisation decides', async () => {
    const response = await read(viewer)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      revision: null,
      effective: { layoutSource: 'organisation', layoutLocked: false },
    })
  })

  it('is refused to somebody with no grant on the workspace', async () => {
    expect((await read(outsider)).statusCode).toBe(403)
  })

  /**
   * The system workspace holds the settings files themselves. It is a
   * workspace to the content store and to nothing else: it has no row, so it
   * resolves to nothing and no route reaches it.
   */
  it('does not exist for the system workspace', async () => {
    const verdicts: Array<{ method: string; status: number }> = []
    for (const method of ['GET', 'PUT'] as const) {
      const response = await harness.app.inject({
        method,
        url: `/api/workspaces/${SYSTEM_WORKSPACE_ID}/settings`,
        cookies: admin,
        ...(method === 'PUT'
          ? {
              payload: {
                settings: defaultWorkspaceSettings(SYSTEM_WORKSPACE_ID),
                expectedRevision: null,
              },
            }
          : {}),
      })
      verdicts.push({ method, status: response.statusCode })
    }
    expect(verdicts).toEqual([
      { method: 'GET', status: 404 },
      { method: 'PUT', status: 404 },
    ])
  })

  it('is changed by somebody who manages the workspace, not by an editor', async () => {
    expect((await write(OVERRIDE, await revision(), editor)).statusCode).toBe(403)
    const response = await write(OVERRIDE, await revision(), admin, 'Sidenotes for this team')
    expect(response.statusCode).toBe(200)
    expect((await read(viewer)).json()).toMatchObject({
      settings: { layout: OVERRIDE },
      effective: { layout: OVERRIDE, layoutSource: 'workspace' },
    })
  })

  it('refuses a write whose base no longer says what this one changed', async () => {
    const base = await revision()
    const other: Layout = { ...OVERRIDE, navigation: 'tree' }
    expect((await write(other, base)).statusCode).toBe(200)
    const second = await write(OVERRIDE, base)
    expect(second.statusCode).toBe(409)
    expect(second.json()).toMatchObject({ error: { code: 'settings_conflict' } })
  })

  /**
   * The revision is the system workspace's and moves whenever any workspace's
   * settings change, so the compare-and-swap is over the file's own bytes:
   * an administrator changing the organisation's settings in between does not
   * make this write a conflict. (The adapter's own test states the same rule
   * against the content store directly.)
   */
  it('is not a conflict just because somebody changed a different settings file', async () => {
    const base = await revision()
    await writeOrganisation(
      { ...defaultOrganisationSettings(), name: 'Changed in between' },
      await currentRevision(),
    )
    expect((await write({ ...OVERRIDE, header: 'readout' }, base)).statusCode).toBe(200)
  })

  /**
   * The address is the authority on which workspace this is, so a body that
   * names a different one is a client that has sent the wrong document to the
   * wrong place — refused, rather than quietly rewritten into this workspace.
   */
  it('refuses a document that names a different workspace', async () => {
    const response = await harness.app.inject({
      method: 'PUT',
      url: url(),
      cookies: admin,
      payload: {
        settings: defaultWorkspaceSettings('00000000-0000-4000-8000-0000000000ff'),
        expectedRevision: await revision(),
      },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({
      error: { code: 'invalid_settings', details: { issues: [{ rule: 'workspace-mismatch' }] } },
    })
  })

  it('is refused an override once the organisation locks layout', async () => {
    const base = defaultOrganisationSettings()
    const locked = await writeOrganisation(
      { ...base, layout: { ...base.layout, locked: true } },
      await currentRevision(),
    )
    expect(locked.statusCode).toBe(200)

    const refused = await write(OVERRIDE, await revision())
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ error: { code: 'workspace_layout_locked' } })
    expect((await read(admin)).json()).toMatchObject({
      effective: { layoutSource: 'organisation', layoutLocked: true },
    })

    // Put it back, so the ordering of the tests after this one does not matter.
    await writeOrganisation(
      { ...base, layout: { ...base.layout, locked: false } },
      await currentRevision(),
    )
  })
})

const NAME = 'oidc/entra/client-secret'
const VALUE = 'a-very-secret-value'
const url = (name = NAME): string => `/api/settings/secrets/${encodeURIComponent(name)}`

describe('secrets', () => {
  const set = (value = VALUE, cookies = admin, name = NAME) =>
    harness.app.inject({ method: 'PUT', url: url(name), cookies, payload: { value } })

  it('is administration: nobody else may set, read, list or delete one', async () => {
    for (const cookies of [editor, viewer, outsider]) {
      expect((await set(VALUE, cookies)).statusCode).toBe(403)
      expect((await harness.app.inject({ method: 'GET', url: url(), cookies })).statusCode).toBe(
        403,
      )
      expect(
        (await harness.app.inject({ method: 'GET', url: '/api/settings/secrets', cookies }))
          .statusCode,
      ).toBe(403)
      expect((await harness.app.inject({ method: 'DELETE', url: url(), cookies })).statusCode).toBe(
        403,
      )
    }
  })

  it('stores one and answers with its name and key, never its value', async () => {
    const response = await set()
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ name: NAME, rotatedAt: null })
    expect(response.body).not.toContain(VALUE)
  })

  it('stores the value encrypted, under a data key wrapped by the master key', async () => {
    await set()
    const { rows } = await harness.database.pool.query<{
      ciphertext: string
      wrapped_key: string
      key_id: string
    }>('SELECT ciphertext, wrapped_key, key_id FROM secrets WHERE name = $1', [NAME])
    expect(rows[0]?.ciphertext).not.toContain(VALUE)
    expect(Buffer.from(rows[0]?.ciphertext ?? '', 'base64').toString('utf8')).not.toContain(VALUE)
    expect(rows[0]?.wrapped_key).not.toBe('')
    expect(rows[0]?.key_id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is readable back by the application at the moment of use', async () => {
    await set('the-current-one')
    const opened = await harness.deps.secrets.open(NAME, await sealedRow(NAME))
    expect(opened).toBe('the-current-one')
  })

  it('describes one without its value, and 404s for a name nothing is under', async () => {
    await set()
    const described = await harness.app.inject({ method: 'GET', url: url(), cookies: admin })
    expect(described.statusCode).toBe(200)
    expect(described.body).not.toContain(VALUE)
    expect(
      (await harness.app.inject({ method: 'GET', url: url('nothing/here'), cookies: admin }))
        .statusCode,
    ).toBe(404)
  })

  it('lists names and never values', async () => {
    await set(VALUE, admin, 'smtp/password')
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/settings/secrets',
      cookies: admin,
    })
    expect(listed.statusCode).toBe(200)
    expect((listed.json() as { name: string }[]).map((row) => row.name)).toContain('smtp/password')
    expect(listed.body).not.toContain(VALUE)
  })

  it('refuses a name that is not path-like', async () => {
    const response = await set(VALUE, admin, 'Not A Name')
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: { code: 'invalid_secret_name' } })
  })

  it('refuses a field the body schema does not declare', async () => {
    const response = await harness.app.inject({
      method: 'PUT',
      url: url(),
      cookies: admin,
      payload: { value: VALUE, comment: 'from a newer client' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('takes a name exactly as the router decoded it', async () => {
    // `100%25` is one segment decoding to `100%`, which is not a secret name;
    // double-encoding it is `100%2525` and decodes to `100%25`, also not one.
    // Neither may be decoded twice into something that is.
    const verdicts: Array<{ encoded: string; status: number }> = []
    for (const encoded of ['100%25', '100%2525']) {
      const response = await harness.app.inject({
        method: 'PUT',
        url: `/api/settings/secrets/${encoded}`,
        cookies: admin,
        payload: { value: VALUE },
      })
      verdicts.push({ encoded, status: response.statusCode })
    }
    expect(verdicts).toEqual([
      { encoded: '100%25', status: 422 },
      { encoded: '100%2525', status: 422 },
    ])
  })

  it('refuses an empty value, naming what is wrong with it', async () => {
    const response = await harness.app.inject({
      method: 'PUT',
      url: url(),
      cookies: admin,
      payload: { value: '' },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: { code: 'invalid_secret_value' } })
  })

  it('refuses a value larger than the field is for', async () => {
    const response = await set('x'.repeat(8193))
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: { code: 'invalid_secret_value' } })
  })

  it('deletes one, and says so when there is nothing to delete', async () => {
    await set(VALUE, admin, 'to/delete')
    expect(
      (await harness.app.inject({ method: 'DELETE', url: url('to/delete'), cookies: admin }))
        .statusCode,
    ).toBe(204)
    expect(
      (await harness.app.inject({ method: 'DELETE', url: url('to/delete'), cookies: admin }))
        .statusCode,
    ).toBe(404)
  })

  it('audits setting and deleting one, with the name and the key id and no value', async () => {
    await set(VALUE, admin, 'audited/secret')
    await harness.app.inject({
      method: 'DELETE',
      url: url('audited/secret'),
      cookies: admin,
    })
    const { rows } = await harness.database.pool.query<{ type: string; metadata: unknown }>(
      "SELECT type, metadata FROM audit_events WHERE target_id = 'audited/secret' ORDER BY created_at",
    )
    expect(rows.map((row) => row.type)).toEqual(['secret.set', 'secret.deleted'])
    expect(rows[0]?.metadata).toMatchObject({ keyId: expect.any(String) })
    expect(JSON.stringify(rows)).not.toContain(VALUE)
  })
})

/**
 * A settings file this release cannot read, which is what a downgrade leaves
 * behind. The routes report it rather than replacing an administrator's
 * configuration with the defaults, so these run last and put the file back.
 */
describe('a settings file this release cannot read', () => {
  const plant = async (path: string, text: string): Promise<string | null> => {
    const before = await harness.deps.contentStore.readFile(SYSTEM_WORKSPACE_ID, path)
    await harness.deps.contentStore.putFile({
      workspaceId: SYSTEM_WORKSPACE_ID,
      path,
      text,
      expected: before?.text ?? null,
      author: { name: 'A newer release', email: 'future@example.com' },
    })
    return before?.text ?? null
  }

  it('is reported rather than replaced with the defaults', async () => {
    const before = await plant(
      ORGANISATION_SETTINGS_PATH,
      `version: ${SETTINGS_VERSION + 1}\nname: From the future\n`,
    )

    const read = await readOrganisation(admin)
    expect(read.statusCode).toBe(500)
    expect(read.json()).toMatchObject({ error: { code: 'settings_unreadable' } })

    // And nothing about a workspace can be resolved while it stands: its own
    // file is readable, but nothing resolves without the organisation's.
    const resolved = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${tenancy.workspaceId}/settings`,
      cookies: admin,
    })
    expect(resolved.statusCode).toBe(500)

    const workspace = await harness.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${tenancy.workspaceId}/settings`,
      cookies: admin,
      payload: {
        settings: defaultWorkspaceSettings(tenancy.workspaceId),
        expectedRevision: null,
      },
    })
    expect(workspace.statusCode).toBe(500)

    if (before !== null) await plant(ORGANISATION_SETTINGS_PATH, before)
    expect((await readOrganisation(admin)).statusCode).toBe(200)
  })

  /**
   * The revision is what an administrator needs to act: it is the
   * `expectedRevision` of the PUT that overwrites the file. The parser's own
   * message is not — it describes a file they did not write and quotes from
   * it — so it goes to the log instead.
   */
  it('tells an instance administrator the revision, and nobody else anything', async () => {
    const before = await plant(
      ORGANISATION_SETTINGS_PATH,
      `version: ${SETTINGS_VERSION + 1}
name: From the future
`,
    )

    const asAdmin = (await readOrganisation(admin)).json<{
      error: { message: string; details?: { revision: string } }
    }>()
    expect(asAdmin.error.details?.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(asAdmin.error.message).not.toContain('version')

    const asReader = (await readOrganisation(viewer)).json<{ error: { details?: unknown } }>()
    expect(asReader.error.details).toBeUndefined()

    // And that revision is enough to repair it through the API alone.
    const repaired = await writeOrganisation(
      { ...defaultOrganisationSettings(), name: 'Repaired' },
      asAdmin.error.details?.revision ?? null,
    )
    expect(repaired.statusCode).toBe(200)
    expect((await readOrganisation(admin)).json()).toMatchObject({
      settings: { name: 'Repaired' },
    })
    expect(before).not.toBeNull()
  })

  it('is reported for a workspace’s own file too', async () => {
    const path = workspaceSettingsPath(tenancy.workspaceId)
    const before = await plant(
      path,
      `version: ${SETTINGS_VERSION + 1}\nworkspaceId: ${tenancy.workspaceId}\n`,
    )
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${tenancy.workspaceId}/settings`,
      cookies: admin,
    })
    expect(response.statusCode).toBe(500)
    if (before !== null) await plant(path, before)
  })
})

/** The stored envelope for one secret, straight out of the table. */
async function sealedRow(
  name: string,
): Promise<{ ciphertext: string; wrappedKey: { keyId: string; wrapped: string } }> {
  const { rows } = await harness.database.pool.query<{
    ciphertext: string
    wrapped_key: string
    key_id: string
  }>('SELECT ciphertext, wrapped_key, key_id FROM secrets WHERE name = $1', [name])
  const row = rows[0]
  /* v8 ignore next -- the test stores the secret a line earlier. */
  if (row === undefined) throw new Error(`no secret stored under ${name}`)
  return {
    ciphertext: row.ciphertext,
    wrappedKey: { keyId: row.key_id, wrapped: row.wrapped_key },
  }
}
