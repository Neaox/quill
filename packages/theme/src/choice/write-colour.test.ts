import { describe, expect, it } from 'vitest'

import { parseColour } from '../colour/oklch.ts'
import { COLOUR_WRITE_FORMATS, writeColour } from './write-colour.ts'

const teal = parseColour('#0f8a7e')

describe('writeColour', () => {
  it('writes a colour in each format, each of which reads back as the same colour', () => {
    expect(teal).toBeDefined()
    if (teal === undefined) return
    expect(writeColour(teal, 'hex')).toBe('#0f8a7e')
    expect(writeColour(teal, 'rgb')).toBe('rgb(15, 138, 126)')
    expect(writeColour(teal, 'hsl')).toMatch(/^hsl\(174\.\d+, 80\.\d+%, 30(\.\d+)?%\)$/u)
    expect(writeColour(teal, 'oklch')).toBe('oklch(57.05% 0.0983 184)')
    for (const format of COLOUR_WRITE_FORMATS) {
      const read = parseColour(writeColour(teal, format))
      expect(read?.hue).toBeCloseTo(teal.hue, 0)
    }
  })
})
