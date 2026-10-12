import { describe, expect, it } from 'vitest'

import { CHROMA_BUDGET } from '../colour/bands.ts'
import { instrument } from '../builtin/instrument.ts'
import {
  temperatureOf,
  tintOf,
  withAccentChoice,
  withTemperature,
  withTint,
} from './tone-choice.ts'

const tone = { hue: 120, chroma: 0.008 }

describe('temperatureOf', () => {
  it('reads cool and warm from their hues', () => {
    expect(temperatureOf({ ...tone, hue: 250 }, 30)).toBe('cool')
    expect(temperatureOf({ ...tone, hue: 70 }, 30)).toBe('warm')
  })

  it('reads neutral when the tone is on the accent’s hue, even a cool one', () => {
    expect(temperatureOf({ ...tone, hue: 30 }, 30)).toBe('neutral')
    expect(temperatureOf({ ...tone, hue: 250 }, 250)).toBe('neutral')
  })

  it('reads nothing for a hue of its own', () => {
    expect(temperatureOf(tone, 30)).toBeUndefined()
  })
})

describe('withTemperature', () => {
  it('moves the tone to the temperature’s hue and keeps its chroma', () => {
    expect(withTemperature(tone, 'cool', 30)).toEqual({ hue: 250, chroma: 0.008 })
    expect(withTemperature(tone, 'warm', 30)).toEqual({ hue: 70, chroma: 0.008 })
    expect(withTemperature(tone, 'neutral', 30)).toEqual({ hue: 30, chroma: 0.008 })
  })
})

describe('tints', () => {
  it('maps subtle and tinted onto the paper budget, and reads them back', () => {
    const subtle = withTint(tone, 'subtle')
    const tinted = withTint(tone, 'tinted')
    expect(subtle.chroma).toBe(CHROMA_BUDGET.paperTintMinimum)
    expect(tinted.chroma).toBe(CHROMA_BUDGET.paper)
    expect(tintOf(subtle)).toBe('subtle')
    expect(tintOf(tinted)).toBe('tinted')
    expect(subtle.hue).toBe(tone.hue)
  })

  it('reads nothing for a chroma only the fine-tune slider sets', () => {
    expect(tintOf({ ...tone, chroma: 0.03 })).toBeUndefined()
  })
})

describe('withAccentChoice', () => {
  it('replaces the accent and leaves a cool or warm tone where it is', () => {
    const seeds = withAccentChoice(instrument.seeds, { hue: 150, chroma: 0.13 })
    expect(seeds.accent).toEqual({ hue: 150, chroma: 0.13 })
    expect(seeds.tone).toBe(instrument.seeds.tone)
  })

  it('carries a neutral tone along with the accent', () => {
    const neutral = {
      ...instrument.seeds,
      tone: withTemperature(instrument.seeds.tone, 'neutral', instrument.seeds.accent.hue),
    }
    const seeds = withAccentChoice(neutral, { hue: 150, chroma: 0.13 })
    expect(seeds.tone.hue).toBe(150)
    expect(temperatureOf(seeds.tone, seeds.accent.hue)).toBe('neutral')
  })
})
