import { defaultOrganisationSettings } from '@quill/application'
import type { OrganisationSettings } from '@quill/application'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createServerHarness } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * The organisation's emoji images (ADR-038): an administrator uploads one,
 * saves it under a name, and anybody can then load it at its hashed address.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

const BOUNDARY = 'quillemoji'
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#e0565b"/></svg>',
)

/** Two frames of 2×2, as Pillow writes an animated GIF (the application's image fixtures). */
const ANIMATED_GIF = Buffer.from(
  'R0lGODlhAgACAIEAAMwAAMwzMzMAzAAAACH/C05FVFNDQVBFMi4wAwEAAAAh/hBhbmltYXRlZCBjb21tZW50ACH5BAAKAAAA' +
    'LAAAAAACAAIAAAgHAAMACCAgIAAh+QQBCgABACwAAAAAAgACAIEA/wAAAAAAAAAAAAAIBgABCAQQEAA7',
  'base64',
)

function multipart(bytes: Buffer, contentType: string, field = 'file') {
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${field}"; filename="e"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  )
  return {
    payload: Buffer.concat([head, bytes, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  }
}

const upload = (bytes: Buffer, contentType = 'image/svg+xml', cookies = admin, field = 'file') =>
  harness.app.inject({
    method: 'POST',
    url: '/api/settings/organisation/emoji-images',
    cookies,
    ...multipart(bytes, contentType, field),
  })

async function save(change: (settings: OrganisationSettings) => OrganisationSettings) {
  const current = await harness.app.inject({
    method: 'GET',
    url: '/api/settings/organisation',
    cookies: admin,
  })
  const { revision, settings } = current.json<{
    revision: string | null
    settings: OrganisationSettings
  }>()
  const response = await harness.app.inject({
    method: 'PUT',
    url: '/api/settings/organisation',
    cookies: admin,
    payload: {
      settings: change(settings ?? defaultOrganisationSettings()),
      expectedRevision: revision,
    },
  })
  expect(response.statusCode).toBe(200)
}

describe('uploading an emoji image', () => {
  it('stores it for an administrator and answers with its hash', async () => {
    const response = await upload(SVG)
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({
      hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      mediaType: 'image/svg+xml',
    })
  })

  it('is instance administration', async () => {
    expect((await upload(SVG, 'image/svg+xml', editor)).statusCode).toBe(403)
  })

  it('refuses what is not an emoji image, saying why', async () => {
    const pdf = await upload(Buffer.from('%PDF-1.7\n'), 'application/pdf')
    expect(pdf.statusCode).toBe(422)
    expect(pdf.body).toContain('file_type_not_allowed')
    expect((await upload(SVG, 'image/png')).body).toContain('file_type_mismatch')
    expect((await upload(Buffer.alloc(0), 'image/png')).body).toContain('file_empty')
    expect((await upload(SVG, 'image/svg+xml', admin, 'other')).body).toContain('file_missing')
    const cut = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0])
    expect((await upload(cut, 'image/png')).body).toContain('file_malformed')
    const large = await upload(Buffer.concat([SVG, Buffer.alloc(300 * 1024, 32)]))
    expect(large.statusCode).toBe(413)
  })

  it('refuses an animation longer than ten seconds, saying how long it is', async () => {
    const slow = Buffer.from(ANIMATED_GIF)
    for (let at = slow.indexOf(0xf9); at !== -1; at = slow.indexOf(0xf9, at + 1)) {
      if (slow[at - 1] === 0x21) slow.writeUInt16LE(600, at + 3)
    }
    const response = await upload(slow, 'image/gif')
    expect(response.statusCode).toBe(422)
    expect(response.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'file_animation_too_long',
      message: expect.stringContaining('runs for 12.0 seconds'),
    })
  })

  it('stores an animated GIF with a still of its first frame, and answers with both', async () => {
    const response = await upload(ANIMATED_GIF, 'image/gif')
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({
      hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      mediaType: 'image/gif',
      still: expect.stringMatching(/^[0-9a-f]{64}$/u),
      // Timed for the reader's brief play, and bounded in the file (ADR-047).
      frames: 2,
      milliseconds: 200,
      plays: 3,
      original: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
  })
})

describe('serving an emoji image', () => {
  it('serves a saved emoji to anybody, immutable and sandboxed', async () => {
    const { hash } = (await upload(SVG)).json<{ hash: string }>()
    const url = `/api/emoji/acme.${hash.slice(0, 16)}.svg`

    // Uploaded but not named in the settings: not served.
    expect((await harness.app.inject({ method: 'GET', url })).statusCode).toBe(404)

    await save((settings) => ({
      ...settings,
      emoji: [{ name: 'acme', hash, mediaType: 'image/svg+xml', width: 16, height: 16 }],
    }))

    const response = await harness.app.inject({ method: 'GET', url })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('image/svg+xml')
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-security-policy']).toContain('sandbox')
    expect(response.rawPayload).toEqual(SVG)

    const summary = await harness.app.inject({
      method: 'GET',
      url: '/api/settings/organisation/theme',
    })
    expect(summary.json<{ emoji: unknown }>().emoji).toEqual([
      { name: 'acme', src: url, width: 16, height: 16 },
    ])

    expect(
      (await harness.app.inject({ method: 'GET', url: '/api/emoji/nope.svg' })).statusCode,
    ).toBe(404)
  })

  it('serves an animation and its still, and names both for the renderer', async () => {
    const { hash, still, frames, milliseconds } = (await upload(ANIMATED_GIF, 'image/gif')).json<{
      hash: string
      still: string
      frames: number
      milliseconds: number
    }>()
    await save((settings) => ({
      ...settings,
      emoji: [
        {
          name: 'party',
          hash,
          still,
          frames,
          milliseconds,
          mediaType: 'image/gif',
          width: 2,
          height: 2,
        },
      ],
    }))

    const src = `/api/emoji/party.${hash.slice(0, 16)}.gif`
    const stillSrc = `/api/emoji/party.${still.slice(0, 16)}.gif`
    const responses = await Promise.all(
      [src, stillSrc].map(async (url) => harness.app.inject({ method: 'GET', url })),
    )
    for (const response of responses) {
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('image/gif')
    }

    const summary = await harness.app.inject({
      method: 'GET',
      url: '/api/settings/organisation/theme',
    })
    expect(summary.json<{ emoji: unknown }>().emoji).toEqual([
      { name: 'party', src, still: stillSrc, frames: 2, milliseconds: 200, width: 2, height: 2 },
    ])
  })
})
