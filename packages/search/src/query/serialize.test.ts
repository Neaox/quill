import { describe, expect, it } from 'vitest'

import { filter, phrase, term } from './query.ts'
import { serializeQuery } from './serialize.ts'

describe('serializeQuery', () => {
  it('serializes an empty query to an empty string', () => {
    expect(serializeQuery({ clauses: [] })).toBe('')
  })

  it('serializes terms plainly and joins them with a space', () => {
    expect(serializeQuery({ clauses: [term('hello'), term('world')] })).toBe('hello world')
  })

  it('negates a term with a leading dash', () => {
    expect(serializeQuery({ clauses: [term('draft', true)] })).toBe('-draft')
  })

  it('always quotes a phrase', () => {
    expect(serializeQuery({ clauses: [phrase('getting started')] })).toBe('"getting started"')
  })

  it('escapes a quote and a backslash inside a phrase', () => {
    expect(serializeQuery({ clauses: [phrase('say "hi" \\now')] })).toBe(
      String.raw`"say \"hi\" \\now"`,
    )
  })

  it('negates a phrase', () => {
    expect(serializeQuery({ clauses: [phrase('work in progress', true)] })).toBe(
      '-"work in progress"',
    )
  })

  it('serializes a filter value without spaces unquoted', () => {
    expect(serializeQuery({ clauses: [filter('tag', 'release')] })).toBe('tag:release')
  })

  it('quotes a filter value that contains whitespace', () => {
    expect(serializeQuery({ clauses: [filter('owner', 'Jane Doe')] })).toBe('owner:"Jane Doe"')
  })

  it('negates a filter', () => {
    expect(serializeQuery({ clauses: [filter('status', 'archived', true)] })).toBe(
      '-status:archived',
    )
  })

  it('serializes a mix of clause kinds in order', () => {
    const query = {
      clauses: [
        term('release'),
        term('draft', true),
        filter('tag', 'changelog'),
        phrase('breaking change'),
      ],
    }
    expect(serializeQuery(query)).toBe('release -draft tag:changelog "breaking change"')
  })
})
