import { describe, expect, it } from 'vitest'

import { searchesPrivateFields } from './search-query.ts'

describe('searchesPrivateFields', () => {
  it.each([
    'by:ada',
    'team:platform',
    'failover by:"Ada Lovelace"',
    '-by:me',
    'x -team:sre',
    'prop:severity=high',
    '-prop:severity=high',
    'failover prop:"customer name=acme"',
  ])('is true for %s, whether it asks for a person or a property, or leaves one out', (text) => {
    expect(searchesPrivateFields(text)).toBe(true)
  })

  it.each([
    'failover',
    'tag:runbook owner:ada',
    'tag:area/billing',
    '"by:ada" quoted',
    '"prop:a=b" quoted',
    'by',
    'prop',
    'ada by:',
  ])('is false for %s', (text) => {
    expect(searchesPrivateFields(text)).toBe(false)
  })
})
