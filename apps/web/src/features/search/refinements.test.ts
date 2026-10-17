import { describe, expect, it } from 'vitest'

import { facetValueFixture as value } from '../../lib/api/search-fixtures.ts'
import { RESULTS_FACETS } from '../../lib/api/index.ts'
import { FACETS, refinements } from './refinements.ts'

describe('FACETS', () => {
  it('shows exactly the facets the page asks the server to count, in the same order', () => {
    expect(FACETS.map((facet) => facet.name)).toEqual(RESULTS_FACETS)
  })
})

describe('refinements', () => {
  it('has a group for each facet that has something, in the order Tag, Status, Collection', () => {
    const groups = refinements(
      {
        collection: [value('runbooks', 2, 'Runbooks')],
        tag: [value('api', 5)],
        status: [value('draft', 1, 'Draft')],
      },
      'failover',
    )

    expect(groups.map((group) => [group.name, group.label])).toEqual([
      ['tag', 'Tag'],
      ['status', 'Status'],
      ['collection', 'Collection'],
    ])
    expect(groups[2]?.values).toEqual([value('runbooks', 2, 'Runbooks')])
  })

  it('has nothing when no facets came back, or they are all empty', () => {
    expect(refinements(undefined, 'failover')).toEqual([])
    expect(refinements({ tag: [], status: [] }, 'failover')).toEqual([])
  })

  it('leaves out a value the query already filters on, whatever its case', () => {
    const groups = refinements(
      { tag: [value('API', 5), value('db', 2)], status: [value('draft', 1)] },
      'tag:api status:Draft',
    )

    expect(groups.map((group) => [group.name, group.values.map((v) => v.value)])).toEqual([
      ['tag', ['db']],
    ])
  })

  it('leaves out a value the query rules out too: adding it would contradict the query', () => {
    expect(refinements({ tag: [value('old', 2)] }, '-tag:old')).toEqual([])
  })

  it('leaves out a parent tag the query already filters on, but not the tags beneath it', () => {
    const groups = refinements(
      { tag: [value('area', 9), value('area/billing', 4), value('areas', 1)] },
      'tag:area',
    )

    expect(groups[0]?.values.map((v) => v.value)).toEqual(['area/billing', 'areas'])
  })

  it('keeps a same-named value under another filter: collection:api does not hide tag api', () => {
    const groups = refinements({ tag: [value('api', 5)] }, 'collection:api')

    expect(groups[0]?.values).toEqual([value('api', 5)])
  })

  it('hides nothing when the query cannot be read, because it cannot be known what it asks', () => {
    const groups = refinements({ tag: [value('api', 5)] }, 'tag:"api')

    expect(groups[0]?.values).toEqual([value('api', 5)])
  })
})
