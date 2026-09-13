import { describe, expect, it } from 'vitest'

import { createVersionedReader } from './versioned-reader.ts'

interface Note {
  readonly version: number
  readonly text: string
}

const reader = createVersionedReader<Note>({
  // Version 1 called it `body`; version 2 calls it `text`. Both stay readable
  // for ever, which is the whole point (ADR-033).
  1: (value) => {
    const body = (value as { body?: unknown }).body
    return typeof body === 'string' ? { version: 1, text: body } : null
  },
  2: (value) => {
    const text = (value as { text?: unknown }).text
    return typeof text === 'string' ? { version: 2, text } : null
  },
})

describe('createVersionedReader', () => {
  it('reads every version ever shipped, not only the current one', () => {
    expect(reader.current).toBe(2)
    expect(reader.read({ version: 1, body: 'from an older release' })).toEqual({
      version: 1,
      text: 'from an older release',
    })
    expect(reader.read({ version: 2, text: 'from this one' })).toEqual({
      version: 2,
      text: 'from this one',
    })
  })

  it('leaves a record it cannot read alone rather than guessing at it', () => {
    // A version a later release wrote, a record with no version, a record that
    // is not a record, and a version this release knows but cannot parse.
    expect(reader.read({ version: 3, text: 'from the future' })).toBeNull()
    expect(reader.read({ text: 'no version' })).toBeNull()
    expect(reader.read(null)).toBeNull()
    expect(reader.read('a string')).toBeNull()
    expect(reader.read({ version: 2, text: 42 })).toBeNull()
  })
})
