import { describe, expect, it } from 'vitest'
import type { Colour } from '../colour/oklch.ts'
import { bestTextOn } from './best-text-on.ts'

const white: Colour = { lightness: 99.5, chroma: 0, hue: 0 }
const ink: Colour = { lightness: 24, chroma: 0.02, hue: 250 }

describe('bestTextOn', () => {
  it('picks white over ink on a dark accent', () => {
    const choice = bestTextOn({ lightness: 42, chroma: 0.12, hue: 25 }, [white, ink])
    expect(choice.colour).toBe(white)
    expect(choice.ratio).toBeGreaterThan(4.5)
    expect(choice.lc).toBeGreaterThan(0)
  })

  it('picks ink over white on a light accent', () => {
    const choice = bestTextOn({ lightness: 85, chroma: 0.12, hue: 85 }, [white, ink])
    expect(choice.colour).toBe(ink)
  })

  it('keeps the caller order when two candidates tie', () => {
    expect(bestTextOn({ lightness: 50, chroma: 0, hue: 0 }, [white, white]).colour).toBe(white)
  })
})
