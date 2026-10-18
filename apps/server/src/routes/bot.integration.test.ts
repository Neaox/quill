import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { defaultOrganisationSettings } from '@quill/application'
import { revisionId } from '@quill/domain'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'

/**
 * The page the link preview bot's user agent names (ADR-042). The user agent
 * promises it, so it has to be there, for anyone, without signing in.
 */

let harness: ServerHarness

beforeAll(async () => {
  harness = await createServerHarness()
}, 30_000)

afterAll(async () => {
  await harness.close()
})

describe('GET /bot', () => {
  it('is public, and a page', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/bot' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('link preview bot')
  })

  it('names the same user agent the fetcher sends', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/bot' })
    expect(response.body).toContain(`/bot)`)
    expect(response.body).toContain(new URL(harness.deps.config.appUrl).origin)
  })

  it('is cacheable and revalidates by tag', async () => {
    const first = await harness.app.inject({ method: 'GET', url: '/bot' })
    expect(first.headers['cache-control']).toContain('s-maxage')
    const second = await harness.app.inject({
      method: 'GET',
      url: '/bot',
      headers: { 'if-none-match': String(first.headers['etag']) },
    })
    expect(second.statusCode).toBe(304)
  })

  it('does not set a cookie or show the application', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/bot' })
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.body).not.toContain('"error"')
  })

  it('names the product when the organisation has no settings to name it', async () => {
    const read = vi
      .spyOn(harness.deps.settings, 'readOrganisation')
      .mockResolvedValue({ kind: 'unset' })
    const response = await harness.app.inject({ method: 'GET', url: '/bot' })
    read.mockRestore()
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('link preview bot')
  })

  it('names the organisation, when it has named itself', async () => {
    const read = vi.spyOn(harness.deps.settings, 'readOrganisation').mockResolvedValue({
      kind: 'settings',
      document: { ...defaultOrganisationSettings(), name: 'Acme Docs' },
      revision: revisionId('a'.repeat(40)),
    })
    const response = await harness.app.inject({ method: 'GET', url: '/bot' })
    read.mockRestore()
    expect(response.body).toContain('The Acme Docs link preview bot')
  })
})
