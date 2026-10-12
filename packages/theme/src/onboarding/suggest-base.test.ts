import { describe, expect, it } from 'vitest'
import { OFFERED_THEME_IDS } from '../schema/theme-ids.ts'
import { suggestBase } from './suggest-base.ts'

describe('suggestBase', () => {
  it('suggests Instrument for precise, compact, technical material', () => {
    const suggestion = suggestBase({
      content: 'runbooks-and-designs',
      feel: 'precise',
      density: 'compact',
    })
    expect(suggestion.base).toBe('instrument')
    expect(suggestion.reason).toContain('precise')
  })

  it('suggests Editorial for editorial policy material', () => {
    expect(
      suggestBase({
        content: 'policies-and-process',
        feel: 'editorial',
        density: 'comfortable',
      }).base,
    ).toBe('editorial')
  })

  it('suggests Atelier for a friendly workspace people browse', () => {
    expect(
      suggestBase({
        content: 'guides-and-references',
        feel: 'friendly',
        density: 'comfortable',
      }).base,
    ).toBe('atelier')
  })

  it('suggests Grid for reference material that is precise but read at ease', () => {
    const suggestion = suggestBase({
      content: 'guides-and-references',
      feel: 'precise',
      density: 'comfortable',
    })
    expect(suggestion.base).toBe('grid')
    expect(suggestion.reason).toContain('hairline')
  })

  it('suggests Calm for process material many people read', () => {
    const suggestion = suggestBase({
      content: 'policies-and-process',
      feel: 'friendly',
      density: 'comfortable',
    })
    expect(suggestion.base).toBe('calm')
    expect(suggestion.reason).toContain('quiet')
  })

  it('never suggests a superseded theme', () => {
    const contents = [
      'runbooks-and-designs',
      'guides-and-references',
      'policies-and-process',
    ] as const
    const feels = ['precise', 'editorial', 'friendly'] as const
    const densities = ['compact', 'comfortable'] as const
    const suggested = contents.flatMap((content) =>
      feels.flatMap((feel) =>
        densities.map((density) => suggestBase({ content, feel, density }).base),
      ),
    )
    expect(suggested).not.toContain('press')
    expect(new Set(suggested)).toEqual(new Set(OFFERED_THEME_IDS))
  })

  it('gives one sentence of reasoning with every suggestion', () => {
    const suggestion = suggestBase({
      content: 'guides-and-references',
      feel: 'editorial',
      density: 'comfortable',
    })
    expect(suggestion.reason.endsWith('.')).toBe(true)
    expect(suggestion.reason.split('.').filter(Boolean)).toHaveLength(1)
  })

  it('breaks a tie towards the default theme', () => {
    expect(
      suggestBase({
        content: 'runbooks-and-designs',
        feel: 'editorial',
        density: 'compact',
      }).base,
    ).toBe('instrument')
  })
})
