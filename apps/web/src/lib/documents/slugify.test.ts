import { describe, expect, it } from 'vitest'

import { slugify } from './slugify.ts'

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('Quarterly Plan')).toBe('quarterly-plan')
  })

  it('collapses runs of non-alphanumeric characters into one hyphen', () => {
    expect(slugify('API  Reference: v2!!')).toBe('api-reference-v2')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --Getting Started--  ')).toBe('getting-started')
  })

  it('returns an empty string for input with no alphanumeric characters', () => {
    expect(slugify('***')).toBe('')
  })
})
