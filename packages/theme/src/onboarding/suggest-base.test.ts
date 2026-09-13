import { describe, expect, it } from 'vitest'
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

  it('suggests Press for editorial policy material', () => {
    expect(
      suggestBase({
        content: 'policies-and-process',
        feel: 'editorial',
        density: 'comfortable',
      }).base,
    ).toBe('press')
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
        content: 'guides-and-references',
        feel: 'precise',
        density: 'compact',
      }).base,
    ).toBe('instrument')
  })
})
