import { describe, expect, it } from 'vitest'

import {
  AppError,
  conflict,
  forbidden,
  notFound,
  sessionExpired,
  unauthenticated,
} from './errors.ts'

describe('AppError', () => {
  it('carries status, code, message, and optional details', () => {
    const error = new AppError(418, 'teapot', 'I am a teapot', { reason: 'brewing' })
    expect(error.statusCode).toBe(418)
    expect(error.code).toBe('teapot')
    expect(error.message).toBe('I am a teapot')
    expect(error.details).toEqual({ reason: 'brewing' })
    expect(error.name).toBe('AppError')
    expect(error).toBeInstanceOf(Error)
  })

  it('leaves details undefined when omitted', () => {
    expect(new AppError(500, 'oops', 'Oops').details).toBeUndefined()
  })
})

describe('error factories', () => {
  it('unauthenticated defaults to a sign-in message', () => {
    const error = unauthenticated()
    expect(error.statusCode).toBe(401)
    expect(error.code).toBe('unauthenticated')
    expect(error.message).toBe('Sign in required')
  })

  it('unauthenticated accepts a custom message', () => {
    expect(unauthenticated('custom').message).toBe('custom')
  })

  it('sessionExpired is distinct from unauthenticated', () => {
    const error = sessionExpired()
    expect(error.statusCode).toBe(401)
    expect(error.code).toBe('session_expired')
  })

  it('forbidden defaults to a not-allowed message', () => {
    const error = forbidden()
    expect(error.statusCode).toBe(403)
    expect(error.code).toBe('forbidden')
    expect(error.message).toBe('Not allowed')
  })

  it('notFound defaults to a not-found message', () => {
    const error = notFound()
    expect(error.statusCode).toBe(404)
    expect(error.code).toBe('not_found')
    expect(error.message).toBe('Not found')
  })

  it('conflict carries a caller-chosen code, message, and details', () => {
    const error = conflict('stale_version', 'stale', { currentVersion: 3 })
    expect(error.statusCode).toBe(409)
    expect(error.code).toBe('stale_version')
    expect(error.details).toEqual({ currentVersion: 3 })
  })
})
