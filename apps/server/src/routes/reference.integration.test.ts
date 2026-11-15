import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * The reference index's read surface (ADR-065): the latest snapshot's
 * provenance, its history, and the artifact's bytes, all inside the
 * workspace's `view` permission.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let viewer: Record<string, string>
let outsider: Record<string, string>
let snapshotId: string

const ARTIFACT = {
  formatVersion: 1,
  dialect: 'postgres',
  database: 'acme',
  source: 'catalog',
  capturedAt: '2026-01-01T00:00:00.000Z',
  tables: [{ schema: 'public', name: 'accounts' }],
  functions: [],
}

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  viewer = await harness.cookiesFor(tenancy.viewer)
  outsider = await harness.cookiesFor(tenancy.outsider)

  const bytes = new TextEncoder().encode(JSON.stringify(ARTIFACT))
  const blob = await harness.deps.blobStore.put(
    (async function* one() {
      yield bytes
    })(),
    'application/json',
  )
  snapshotId = 'reference-snapshot-1'
  await harness.deps.uow.repos.referenceSnapshots.insert({
    id: snapshotId,
    workspaceId: tenancy.workspaceId,
    kind: 'schema',
    sourceCommit: 'abc1234',
    capturedAt: new Date('2026-01-01T00:00:00.000Z'),
    artifactHash: blob.hash,
    artifactSize: blob.size,
    artifactVersion: 1,
    symbolCount: 0,
    tableCount: 1,
    createdAt: harness.clock.now(),
  })
}, 60_000)

afterAll(async () => {
  await harness.close()
})

function metadata(cookies: Record<string, string> = viewer) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/workspaces/${tenancy.workspaceId}/reference/schema`,
    cookies,
  })
}

function artifact(query = `snapshot=${snapshotId}`, cookies: Record<string, string> = viewer) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/workspaces/${tenancy.workspaceId}/reference/schema/artifact?${query}`,
    cookies,
  })
}

describe('the reference index route', () => {
  it('answers the latest snapshot and its history to a reader', async () => {
    const response = await metadata()
    expect(response.statusCode).toBe(200)
    const body = response.json<{
      latest: { id: string; kind: string; tableCount: number; artifactUrl: string }
      history: readonly { id: string }[]
    }>()
    expect(body.latest).toMatchObject({
      id: snapshotId,
      kind: 'schema',
      sourceCommit: 'abc1234',
      tableCount: 1,
      artifactUrl: `/api/workspaces/${tenancy.workspaceId}/reference/schema/artifact?snapshot=${snapshotId}`,
    })
    expect(body.history.map((row) => row.id)).toEqual([snapshotId])
  })

  it('answers the artifact as JSON', async () => {
    const response = await artifact()
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.headers['cache-control']).toContain('private')
    expect(response.json()).toEqual(ARTIFACT)
  })

  it('refuses a snapshot that is not this workspace and kind', async () => {
    expect((await artifact('snapshot=missing')).statusCode).toBe(404)
    const code = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${tenancy.workspaceId}/reference/code/artifact?snapshot=${snapshotId}`,
      cookies: viewer,
    })
    expect(code.statusCode).toBe(404)
  })

  it('answers 404 when the artifact object is missing', async () => {
    await harness.deps.uow.repos.referenceSnapshots.insert({
      id: 'reference-snapshot-missing-object',
      workspaceId: tenancy.workspaceId,
      kind: 'schema',
      sourceCommit: 'abc1234',
      capturedAt: new Date('2025-12-31T00:00:00.000Z'),
      artifactHash: 'f'.repeat(64),
      artifactSize: 1,
      artifactVersion: 1,
      symbolCount: 0,
      tableCount: 0,
      createdAt: harness.clock.now(),
    })

    const response = await artifact('snapshot=reference-snapshot-missing-object')
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } })
  })

  it('refuses a caller outside the workspace', async () => {
    // A signed-in person the workspace does not include is known, so the
    // refusal is a 403; the anonymous 404 rule is for callers nobody knows.
    expect((await metadata(outsider)).statusCode).toBe(403)
    expect((await artifact(undefined, outsider)).statusCode).toBe(403)
  })

  it('answers no snapshot before the first ingestion', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/workspaces/${tenancy.workspaceId}/reference/code`,
      cookies: viewer,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ latest: null, history: [] })
  })
})
