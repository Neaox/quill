import { describe, expect, it } from 'vitest'

import { REDACTED, redactShareToken, serialiseRequest } from './logging.ts'

const TOKEN = 'Yb3n-Xq7Tz9LmK0aQw2Rd4Ef6Gh8Jk1Np3Sv5Uz7Wx9'

describe('redactShareToken', () => {
  it('takes the token out of an API share URL, whatever follows it', () => {
    expect(redactShareToken(`/api/share/${TOKEN}`)).toBe(`/api/share/${REDACTED}`)
    expect(redactShareToken(`/api/share/${TOKEN}/documents/abc/rendered`)).toBe(
      `/api/share/${REDACTED}/documents/abc/rendered`,
    )
    expect(redactShareToken(`/api/share/${TOKEN}?revision=x`)).toBe(
      `/api/share/${REDACTED}?revision=x`,
    )
  })

  it('takes it out of the page address too, which is what a browser asks for', () => {
    expect(redactShareToken(`/share/${TOKEN}`)).toBe(`/share/${REDACTED}`)
  })

  it('leaves every other URL exactly as it was', () => {
    for (const url of [
      '/api/documents/abc/rendered',
      '/api/share',
      '/api/share/',
      '/w/engineering/d/authentication-k7m3q9v2xd',
      '/not/api/share/secret',
    ]) {
      expect(redactShareToken(url)).toBe(url)
    }
  })
})

describe('serialiseRequest', () => {
  it('logs the fields Fastify logs, with the token gone from the URL', () => {
    expect(
      serialiseRequest({
        id: 'req-1',
        method: 'GET',
        url: `/api/share/${TOKEN}`,
        ip: '203.0.113.7',
      }),
    ).toEqual({
      id: 'req-1',
      method: 'GET',
      url: `/api/share/${REDACTED}`,
      remoteAddress: '203.0.113.7',
    })
  })

  it('never lets the token through', () => {
    const line = JSON.stringify(
      serialiseRequest({
        id: 'req-2',
        method: 'GET',
        url: `/api/share/${TOKEN}/documents/abc/rendered`,
        ip: '203.0.113.7',
      }),
    )
    expect(line).not.toContain(TOKEN)
  })
})
