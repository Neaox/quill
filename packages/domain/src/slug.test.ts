import { describe, expect, it } from 'vitest'

import { MAX_SLUG_LENGTH, slugify } from './slug.ts'

describe('slugify', () => {
  it('lower-cases words and joins them with hyphens', () => {
    expect(slugify('Regional failover runbook')).toBe('regional-failover-runbook')
  })

  it('strips combining marks so accented letters keep their base letter', () => {
    expect(slugify('  Ünicode: Rösti & chips!  ')).toBe('unicode-rosti-chips')
    expect(slugify('Crème brûlée')).toBe('creme-brulee')
  })

  it('keeps a letter that decomposes to itself', () => {
    expect(slugify('Straße')).toBe('straße')
  })

  it('removes apostrophes outright rather than splitting the word', () => {
    expect(slugify("Don't panic")).toBe('dont-panic')
    expect(slugify('Don’t panic')).toBe('dont-panic')
  })

  it('collapses every run of non-letters into one hyphen', () => {
    expect(slugify('ADR-0012 / tenancy')).toBe('adr-0012-tenancy')
    expect(slugify('API  Reference: v2!!')).toBe('api-reference-v2')
  })

  it('keeps letters from any script', () => {
    expect(slugify('Привет мир')).toBe('привет-мир')
    expect(slugify('設計ノート')).toBe('設計ノート')
  })

  it('drops emoji and symbols, which are neither letters nor digits', () => {
    expect(slugify('Launch 🚀 plan')).toBe('launch-plan')
    expect(slugify('Costs in € and $')).toBe('costs-in-and')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --Getting Started--  ')).toBe('getting-started')
  })

  it('cuts at the last hyphen before the limit so no word is split', () => {
    const slug = slugify(`${'alpha '.repeat(15)}omega`)
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(slug.endsWith('alpha')).toBe(true)
    expect(slug).not.toContain('alph-')
  })

  it('cuts mid-word only when the first word alone exceeds the limit', () => {
    const slug = slugify(`${'a'.repeat(120)} tail`)
    expect(slug).toBe('a'.repeat(MAX_SLUG_LENGTH))
  })

  it('leaves a slug exactly at the limit alone', () => {
    const slug = slugify('a'.repeat(MAX_SLUG_LENGTH))
    expect(slug).toBe('a'.repeat(MAX_SLUG_LENGTH))
  })

  it('answers with an empty string when nothing survives, leaving the fallback to the caller', () => {
    expect(slugify('???')).toBe('')
    expect(slugify('')).toBe('')
    expect(slugify('🚀')).toBe('')
  })
})
