import { describe, expect, it } from 'vitest'

import { expandTagPaths, normaliseTag } from './tags.ts'

describe('normaliseTag', () => {
  it.each([
    ['Runbook', 'runbook'],
    ['  Runbook  ', 'runbook'],
    ['Area/Billing', 'area/billing'],
    ['area / billing', 'area/billing'],
    ['area//billing', 'area/billing'],
    ['/area/billing/', 'area/billing'],
    ['a/b/c', 'a/b/c'],
  ])('reads %j as %j', (written, normalised) => {
    expect(normaliseTag(written)).toBe(normalised)
  })

  it.each(['', '   ', '/', '//', ' / / '])('reads %j as no tag at all', (written) => {
    expect(normaliseTag(written)).toBeNull()
  })
})

describe('expandTagPaths', () => {
  it('names a flat tag once', () => {
    expect(expandTagPaths(['Runbook'])).toEqual(['runbook'])
  })

  it('names every ancestor of a hierarchical tag, parent first', () => {
    expect(expandTagPaths(['area/billing/invoices'])).toEqual([
      'area',
      'area/billing',
      'area/billing/invoices',
    ])
  })

  it('names a shared ancestor once, however the tags are cased or repeated', () => {
    expect(expandTagPaths(['Area/Billing', 'area/support', 'AREA', 'area/billing'])).toEqual([
      'area',
      'area/billing',
      'area/support',
    ])
  })

  it('drops what is not a tag, and has no paths without tags', () => {
    expect(expandTagPaths(['', '/', 'ok'])).toEqual(['ok'])
    expect(expandTagPaths([])).toEqual([])
  })
})
