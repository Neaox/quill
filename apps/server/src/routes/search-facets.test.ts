import { describe, expect, it } from 'vitest'

import { facetNamesFrom, FACETS_PATTERN, toFacetsResponse } from './search-facets.ts'

describe('facetNamesFrom', () => {
  it('reads a comma-separated list, each name once, in the order asked', () => {
    expect(facetNamesFrom('status,tag,status')).toEqual(['status', 'tag'])
    expect(facetNamesFrom('collection')).toEqual(['collection'])
  })
})

const accepts = (text: string) => new RegExp(FACETS_PATTERN, 'u').test(text)

describe('FACETS_PATTERN', () => {
  it.each(['tag', 'tag,status,collection', 'status,status'])('accepts %s', (text) => {
    expect(accepts(text)).toBe(true)
  })

  it.each(['', 'labels', 'tag,', ',tag', 'tag, status', 'tag,labels', 'Tag', 'tags'])(
    'refuses %j',
    (text) => {
      expect(accepts(text)).toBe(false)
    },
  )
})

describe('toFacetsResponse', () => {
  const names = new Map([
    ['c1', 'Runbooks'],
    ['c2', 'runbooks'],
    ['c3', 'Guides'],
  ])

  it('labels tags and statuses with their own value', () => {
    expect(
      toFacetsResponse(
        {
          tag: [{ value: 'area/billing', count: 3 }],
          status: [{ value: 'draft', count: 1 }],
        },
        new Map(),
        8,
      ),
    ).toEqual({
      tag: [{ value: 'area/billing', label: 'area/billing', count: 3 }],
      status: [{ value: 'draft', label: 'draft', count: 1 }],
    })
  })

  it('names collections, and counts the ones that share a name together', () => {
    const response = toFacetsResponse(
      {
        collection: [
          { value: 'c2', count: 4 },
          { value: 'c3', count: 5 },
          { value: 'c1', count: 2 },
        ],
      },
      names,
      8,
    )
    // The collection `collection:` would match by name is one value, with every document in it.
    expect(response).toEqual({
      collection: [
        { value: 'runbooks', label: 'runbooks', count: 6 },
        { value: 'Guides', label: 'Guides', count: 5 },
      ],
    })
  })

  it('keeps the top values by count, then label', () => {
    const response = toFacetsResponse(
      {
        collection: [
          { value: 'c1', count: 1 },
          { value: 'c3', count: 1 },
        ],
      },
      names,
      1,
    )
    expect(response.collection).toEqual([{ value: 'Guides', label: 'Guides', count: 1 }])
  })

  it('leaves out a collection that has gone since the count', () => {
    expect(
      toFacetsResponse({ collection: [{ value: 'gone', count: 2 }] }, names, 8).collection,
    ).toEqual([])
  })

  it('has only the facets that were counted', () => {
    expect(toFacetsResponse({}, names, 8)).toEqual({})
  })
})
