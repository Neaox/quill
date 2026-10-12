import { deflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { browserInflate } from './browser-inflate.ts'

describe('browserInflate', () => {
  it('inflates raw deflate within the cap', async () => {
    const result = await browserInflate(deflateRawSync(Buffer.from('hello diagram')), 1024)
    expect(result.kind === 'inflated' && new TextDecoder().decode(result.bytes)).toBe(
      'hello diagram',
    )
  })

  it('stops reading a bomb as soon as it passes the cap', async () => {
    const bomb = deflateRawSync(Buffer.alloc(8 * 1024 * 1024))
    expect(await browserInflate(bomb, 64 * 1024)).toEqual({ kind: 'refused', reason: 'too-large' })
  })

  it('refuses bytes that are not raw deflate', async () => {
    expect(await browserInflate(Uint8Array.from([0xff, 0xff, 0xff, 0xff]), 1024)).toEqual({
      kind: 'refused',
      reason: 'malformed',
    })
  })
})
