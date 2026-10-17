import { describe, expect, it, vi } from 'vitest'

import { zlibInflate } from './drawing-text.ts'

// A failure that is not an Error and carries no code: nothing zlib throws, so
// the inflater is replaced with one that fails the way a broken runtime might.
vi.mock('node:zlib', () => ({
  inflateRaw: (_bytes: unknown, _options: unknown, done: (failure: unknown) => void) => {
    done('boom')
  },
}))

describe('zlibInflate: a failure that names no cause', () => {
  it('is refused as malformed rather than thrown', async () => {
    expect(await zlibInflate(Uint8Array.from([1, 2, 3]), 1024)).toEqual({
      kind: 'refused',
      reason: 'malformed',
    })
  })
})
