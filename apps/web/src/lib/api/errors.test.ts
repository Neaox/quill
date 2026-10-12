import { describe, expect, it } from 'vitest'

import { ApiError, isTransientFailure, retryAfterOf, toApiError } from './errors.ts'

describe('toApiError', () => {
  it('maps the server error envelope to an ApiError', () => {
    const error = toApiError(409, {
      error: { code: 'stale_version', message: 'behind', details: { currentVersion: 3 } },
    })
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(409)
    expect(error.code).toBe('stale_version')
    expect(error.message).toBe('behind')
    expect(error.details).toEqual({ currentVersion: 3 })
  })

  it('falls back to a generic error for a body that is not the envelope shape', () => {
    const error = toApiError(502, 'Bad Gateway')
    expect(error.status).toBe(502)
    expect(error.code).toBe('unknown_error')
  })

  it('falls back to a generic error for a missing body', () => {
    const error = toApiError(500, undefined)
    expect(error.code).toBe('unknown_error')
  })
})

describe('Retry-After', () => {
  it('reads seconds and HTTP dates off the response, as milliseconds', () => {
    expect(toApiError(429, undefined, new Headers({ 'retry-after': '7' })).retryAfterMs).toBe(7000)
    const now = Date.parse('2026-10-11T00:00:00Z')
    expect(
      toApiError(
        503,
        undefined,
        new Headers({ 'retry-after': 'Sun, 11 Oct 2026 00:00:30 GMT' }),
        () => now,
      ).retryAfterMs,
    ).toBe(30_000)
  })

  it('is null when the server gave none, or gave nonsense', () => {
    expect(toApiError(503, undefined).retryAfterMs).toBeNull()
    expect(
      toApiError(503, undefined, new Headers({ 'retry-after': 'soon' })).retryAfterMs,
    ).toBeNull()
  })

  it('is read back off an error, and only off an ApiError', () => {
    expect(retryAfterOf(toApiError(429, undefined, new Headers({ 'retry-after': '2' })))).toBe(2000)
    expect(retryAfterOf(new TypeError('Failed to fetch'))).toBeNull()
  })
})

describe('isTransientFailure', () => {
  it.each([429, 502, 503, 504])('is worth retrying on a %i', (status) => {
    expect(isTransientFailure(toApiError(status, undefined))).toBe(true)
  })

  it.each([400, 401, 403, 404, 409, 413, 423, 500])('never retries a %i', (status) => {
    expect(isTransientFailure(toApiError(status, undefined))).toBe(false)
  })

  it('retries a request that never reached the server', () => {
    expect(isTransientFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isTransientFailure(new Error('a bug'))).toBe(false)
  })
})
