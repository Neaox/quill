import { describe, expect, it } from 'vitest'

import { BRAND } from './index.ts'

describe('BRAND', () => {
  it('has a lowercase slug usable as an identifier', () => {
    expect(BRAND.slug).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  it('derives the scope from the slug', () => {
    expect(BRAND.scope).toBe(`@${BRAND.slug}`)
  })

  it('has a non-empty display name', () => {
    expect(BRAND.name.length).toBeGreaterThan(0)
  })

  it('is frozen', () => {
    expect(Object.isFrozen(BRAND)).toBe(true)
  })
})
