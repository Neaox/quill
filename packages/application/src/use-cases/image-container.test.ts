import { describe, expect, it } from 'vitest'

import { byteAt, readUint16LittleEndian } from './image-container.ts'

describe('reading past the end of an image container', () => {
  it('reads a byte that is there, and nought for one that is not', () => {
    const bytes = Uint8Array.of(7, 9)
    expect(byteAt(bytes, 1)).toBe(9)
    expect(byteAt(bytes, 2)).toBe(0)
  })

  it('reads a little-endian 16-bit number, short reads counting missing bytes as nought', () => {
    expect(readUint16LittleEndian(Uint8Array.of(0x34, 0x12), 0)).toBe(0x1234)
    expect(readUint16LittleEndian(Uint8Array.of(0x34), 0)).toBe(0x34)
  })
})
