import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../../test-support/harness.ts'
import type { ServerHarness } from '../../test-support/harness.ts'
import { seedTenancy } from '../../test-support/tenancy-fixture.ts'

let harness: ServerHarness
let cookies: Record<string, string>

beforeAll(async () => {
  harness = await createServerHarness()
  const tenancy = await seedTenancy(harness)
  cookies = await harness.cookiesFor(tenancy.editor)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

describe('GET /api/extensions/drawio', () => {
  it('tells a writer where the editor is, and that it is not a third party’s', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/extensions/drawio',
      cookies,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      editor: { url: 'http://localhost:8080/', origin: 'http://localhost:8080', thirdParty: false },
    })
  })

  it('lets the page frame exactly that origin', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/extensions/drawio',
      cookies,
    })
    expect(response.headers['content-security-policy']).toContain(
      'frame-src http://localhost:8080;',
    )
  })

  it('is for signed-in people only', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/extensions/drawio' })
    expect(response.statusCode).toBe(401)
  })
})
