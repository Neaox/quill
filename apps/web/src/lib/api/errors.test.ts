import { describe, expect, it } from 'vitest'

import { ApiError, toApiError } from './errors.ts'

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
