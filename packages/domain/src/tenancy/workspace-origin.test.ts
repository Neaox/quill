import { describe, expect, it } from 'vitest'

import {
  DISCONNECTED_ORIGIN,
  hasSourceRecord,
  NATIVE_ORIGIN,
  SOURCED_ORIGIN,
} from './workspace-origin.ts'

describe('a workspace’s origin', () => {
  it('has a repository’s record while it reads from one, and after it was disconnected', () => {
    expect(hasSourceRecord(SOURCED_ORIGIN)).toBe(true)
    expect(hasSourceRecord(DISCONNECTED_ORIGIN)).toBe(true)
    expect(hasSourceRecord(NATIVE_ORIGIN)).toBe(false)
  })
})
