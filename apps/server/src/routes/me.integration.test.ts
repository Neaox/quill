import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * A person's own preferences (ADR-034; ADR-047's "Animated images" setting;
 * `docs/architecture/api-contract-settings.md`, "Person preferences").
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let editor: Record<string, string>
let viewer: Record<string, string>

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

const read = (cookies?: Record<string, string>) =>
  harness.app.inject({
    method: 'GET',
    url: '/api/me/preferences',
    ...(cookies === undefined ? {} : { cookies }),
  })

const save = (payload: unknown, cookies?: Record<string, string>) =>
  harness.app.inject({
    method: 'PUT',
    url: '/api/me/preferences',
    payload: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
    ...(cookies === undefined ? {} : { cookies }),
  })

describe('GET /api/me/preferences', () => {
  it('is the defaults for someone who has never saved any', async () => {
    const response = await read(viewer)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ animatedImages: 'brief' })
  })

  it('needs a session', async () => {
    expect((await read()).statusCode).toBe(401)
  })
})

describe('PUT /api/me/preferences', () => {
  it('saves the preference and returns the effective preferences', async () => {
    const response = await save({ animatedImages: 'never' }, editor)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ animatedImages: 'never' })
    expect((await read(editor)).json()).toEqual({ animatedImages: 'never' })
  })

  it('is one person’s own: nobody else’s preferences change', async () => {
    await save({ animatedImages: 'hover' }, editor)
    expect((await read(viewer)).json()).toEqual({ animatedImages: 'brief' })
  })

  it('returns a preference left out to its default', async () => {
    await save({ animatedImages: 'never' }, editor)
    const response = await save({}, editor)
    expect(response.json()).toEqual({ animatedImages: 'brief' })
  })

  it('refuses a value nothing offers', async () => {
    const response = await save({ animatedImages: 'sometimes' }, editor)
    expect(response.statusCode).toBe(400)
  })

  it('refuses a preference this release does not know, rather than dropping it', async () => {
    const response = await save({ animatedImages: 'never', laterPreference: true }, editor)
    expect(response.statusCode).toBe(400)
    expect((await read(editor)).json()).not.toEqual({ animatedImages: 'never' })
  })

  it('needs a session', async () => {
    expect((await save({ animatedImages: 'never' })).statusCode).toBe(401)
  })

  it('refuses a request from another site', async () => {
    const response = await harness.app.inject({
      method: 'PUT',
      url: '/api/me/preferences',
      cookies: editor,
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      payload: { animatedImages: 'never' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('cross_origin_rejected')
  })
})
