import { describe, expect, it } from 'vitest'
import { press } from '../builtin/press.ts'
import { BUILTIN_THEMES } from '../builtin/themes.ts'
import { runThemeDoctor } from '../doctor/run.ts'
import { validateThemeDocument } from '../schema/validate.ts'
import { forkTheme, resetToBase } from './fork-theme.ts'

describe('forkTheme', () => {
  it('records what it was forked from, so it can be re-opened', () => {
    const fork = forkTheme('editorial', { id: 'northwind', name: 'Northwind' })
    expect(fork.base).toBe('editorial')
    expect(fork.id).toBe('northwind')
    expect(fork.seeds).toEqual(BUILTIN_THEMES.editorial.seeds)
    expect(fork.type.scale).toEqual(BUILTIN_THEMES.editorial.type.scale)
  })

  it('forks a superseded theme’s successor, and records the successor', () => {
    const fork = forkTheme('press', { id: 'northwind', name: 'Northwind' })
    expect(fork.base).toBe('editorial')
    expect(fork.seeds).toEqual(BUILTIN_THEMES.editorial.seeds)
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
    const fork = forkTheme('grid', {
      id: 'northwind',
      name: 'Northwind',
      shape: { radiusStep: 4, density: 'compact' },
    })
    const reset = resetToBase(fork)
    expect(reset.shape).toEqual(BUILTIN_THEMES.grid.shape)
    expect(reset.id).toBe('northwind')
    expect(reset.name).toBe('Northwind')
    expect(reset.base).toBe('grid')
  })

  it('resets an old Press fork to Editorial, keeping the base it saved', () => {
    const saved = { ...press, id: 'northwind', name: 'Northwind', base: 'press' as const }
    const reset = resetToBase(saved)
    expect(reset.seeds).toEqual(BUILTIN_THEMES.editorial.seeds)
    expect(reset.base).toBe('press')
    expect(reset.id).toBe('northwind')
  })

  it('leaves a theme that was never forked alone', () => {
    expect(resetToBase(press)).toBe(press)
  })
})
