import { describe, expect, it } from 'vitest'

import { calm } from '../builtin/calm.ts'
import { grid } from '../builtin/grid.ts'
import { instrument } from '../builtin/instrument.ts'
import { ACCENT_TOKENS, withAccent } from './accent-choice.ts'

const teal = { hue: 185, chroma: 0.1 }

describe('ACCENT_TOKENS', () => {
  it('names the accent-derived tokens from the generator’s role table', () => {
    expect([...ACCENT_TOKENS].toSorted()).toEqual([
      '--palette-accent',
      '--palette-accent-foreground',
      '--palette-accent-hover',
      '--palette-accent-ink',
      '--palette-accent-subtle',
      '--palette-selection',
    ])
  })
})

describe('withAccent', () => {
  it('drops the pins a built-in derived from its old accent and keeps every other', () => {
    const theme = withAccent(grid, teal)
    expect(theme.seeds.accent).toEqual(teal)
    expect(theme.overrides).toEqual({ shared: { '--radius-md': '0.625rem' } })
  })

  it('drops the overrides altogether when only accent pins were there', () => {
    expect(withAccent(calm, teal)).not.toHaveProperty('overrides')
  })

  it('leaves a theme without overrides without any', () => {
    expect(withAccent(instrument, teal)).not.toHaveProperty('overrides')
  })
})
