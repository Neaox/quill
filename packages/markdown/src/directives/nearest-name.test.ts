import { describe, expect, it } from 'vitest'

import { nearestName } from './nearest-name.ts'

describe('nearestName', () => {
  const names = ['acme', 'globex', 'initech']

  it('suggests the name a typo was probably meant to be', () => {
    expect(nearestName('acm', names)).toBe('acme')
    expect(nearestName('amce', names)).toBe('acme')
    expect(nearestName('globe', names)).toBe('globex')
    expect(nearestName('initehc', names)).toBe('initech')
  })

  it('suggests nothing for a word that is not near any of them', () => {
    expect(nearestName('expedia', names)).toBeUndefined()
    expect(nearestName('x', names)).toBeUndefined()
    expect(nearestName('acme', [])).toBeUndefined()
  })

  it('prefers the nearer of two, and the first of two equally near', () => {
    expect(nearestName('boat', ['boot', 'bolt', 'beast'])).toBe('boot')
  })
})
