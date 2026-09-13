import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES } from '../builtin/themes.ts'
import { runThemeDoctor } from '../doctor/run.ts'
import { validateThemeDocument } from '../schema/validate.ts'
import { forkTheme, resetToBase } from './fork-theme.ts'

describe('forkTheme', () => {
  it('records what it was forked from, so it can be re-opened', () => {
    const fork = forkTheme('press', { id: 'northwind', name: 'Northwind' })
    expect(fork.base).toBe('press')
    expect(fork.id).toBe('northwind')
    expect(fork.seeds).toEqual(BUILTIN_THEMES.press.seeds)
  })

  it('changes only what it is asked to', () => {
    const fork = forkTheme('instrument', {
      id: 'northwind',
      name: 'Northwind',
      seeds: { accent: { hue: 160, chroma: 0.12, lightness: 45 } },
      shape: { density: 'comfortable', radiusStep: 3 },
      variants: { rules: 'cards' },
      type: { reading: { source: 'curated', id: 'newsreader' } },
      levers: ['accent', 'logo'],
      collections: { engineering: { hue: 250, chroma: 0.1 } },
      overrides: { shared: { '--radius-md': '0.5rem' } },
    })
    expect(fork.seeds.accent.hue).toBe(160)
    expect(fork.seeds.tone).toEqual(BUILTIN_THEMES.instrument.seeds.tone)
    expect(fork.variants.history).toBe('timeline')
    expect(fork.variants.rules).toBe('cards')
    expect(fork.type.mono).toEqual(BUILTIN_THEMES.instrument.type.mono)
    expect(fork.levers).toEqual(['accent', 'logo'])
    expect(fork.collections).toEqual({ engineering: { hue: 250, chroma: 0.1 } })
    expect(fork.overrides?.shared).toEqual({ '--radius-md': '0.5rem' })
  })

  it('produces a document the schema and the doctor both accept', () => {
    const fork = forkTheme('atelier', {
      id: 'northwind',
      name: 'Northwind',
      seeds: { accent: { hue: 160, chroma: 0.12, lightness: 45 } },
    })
    expect(validateThemeDocument(fork).valid).toBe(true)
    expect(runThemeDoctor(fork).enforcedRulesHold).toBe(true)
  })
})

describe('resetToBase', () => {
  it('puts a fork back to what it started from, keeping its identity', () => {
    const fork = forkTheme('press', {
      id: 'northwind',
      name: 'Northwind',
      shape: { radiusStep: 4, density: 'compact' },
    })
    const reset = resetToBase(fork)
    expect(reset.shape).toEqual(BUILTIN_THEMES.press.shape)
    expect(reset.id).toBe('northwind')
    expect(reset.name).toBe('Northwind')
    expect(reset.base).toBe('press')
  })

  it('leaves a theme that was never forked alone', () => {
    expect(resetToBase(BUILTIN_THEMES.press)).toBe(BUILTIN_THEMES.press)
  })
})
