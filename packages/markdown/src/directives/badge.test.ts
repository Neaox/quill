import { describe, expect, it } from 'vitest'

import { badgeTone } from './badge.ts'

describe('the tone of a badge', () => {
  it.each([
    ['ok', 'success'],
    ['warn', 'warning'],
    ['bad', 'danger'],
    ['accent', 'accent'],
    ['plan', 'neutral'],
  ])('is set by the shorthand :%s, whatever attributes it carries', (name, tone) => {
    expect(badgeTone(name, { tone: 'danger' })).toBe(tone)
    expect(badgeTone(name, undefined)).toBe(tone)
  })

  it('is the tone a :badge names, and neutral when it names none or one that does not exist', () => {
    expect(badgeTone('badge', { tone: 'warning' })).toBe('warning')
    expect(badgeTone('badge', {})).toBe('neutral')
    expect(badgeTone('badge', null)).toBe('neutral')
    expect(badgeTone('badge', { tone: 'purple' })).toBe('neutral')
  })

  it('is nothing for a directive that is not a badge', () => {
    expect(badgeTone('kbd', { tone: 'success' })).toBeUndefined()
  })
})
