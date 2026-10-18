import { describe, expect, it } from 'vitest'

import {
  FAILURE_REMEMBERED_FOR_MS,
  PREVIEW_FRESH_FOR_MS,
  REQUEST_IN_FLIGHT_FOR_MS,
  isStale,
  retryAfter,
} from './snapshot.ts'

const FETCHED = new Date('2026-10-10T09:00:00.000Z')

describe('the life of a stored preview', () => {
  it('is fresh for three days and stale from the moment the third day ends', () => {
    expect(PREVIEW_FRESH_FOR_MS).toBe(3 * 24 * 60 * 60 * 1000)
    expect(isStale(FETCHED, new Date(FETCHED.getTime() + PREVIEW_FRESH_FOR_MS - 1))).toBe(false)
    expect(isStale(FETCHED, new Date(FETCHED.getTime() + PREVIEW_FRESH_FOR_MS))).toBe(true)
  })

  it('remembers a failure for an hour', () => {
    expect(FAILURE_REMEMBERED_FOR_MS).toBe(60 * 60 * 1000)
    expect(retryAfter(FETCHED).toISOString()).toBe('2026-10-10T10:00:00.000Z')
  })

  it('gives a request minutes, not hours, to be lost before another may be made', () => {
    expect(REQUEST_IN_FLIGHT_FOR_MS).toBeGreaterThan(60_000)
    expect(REQUEST_IN_FLIGHT_FOR_MS).toBeLessThan(FAILURE_REMEMBERED_FOR_MS)
  })
})
