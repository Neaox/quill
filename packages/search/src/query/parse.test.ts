import { describe, expect, it } from 'vitest'

import { parseQuery } from './parse.ts'
import { filter, phrase, term } from './query.ts'

describe('parseQuery', () => {
  it('parses an empty query to no clauses', () => {
    expect(parseQuery('')).toEqual({ ok: true, value: { clauses: [] } })
  })

  it('parses whitespace-only input to no clauses', () => {
    expect(parseQuery('   \t  ')).toEqual({ ok: true, value: { clauses: [] } })
  })

  it('parses bare words as terms', () => {
    const result = parseQuery('hello world')
    expect(result).toEqual({ ok: true, value: { clauses: [term('hello'), term('world')] } })
  })

  it('parses a term that contains non-letter characters', () => {
    const result = parseQuery('abc123')
    expect(result).toEqual({ ok: true, value: { clauses: [term('abc123')] } })
  })

  it('parses a term with no leading letters', () => {
    const result = parseQuery('123abc')
    expect(result).toEqual({ ok: true, value: { clauses: [term('123abc')] } })
  })

  it('collapses repeated whitespace between clauses', () => {
    const result = parseQuery('foo    bar')
    expect(result).toEqual({ ok: true, value: { clauses: [term('foo'), term('bar')] } })
  })

  it('parses a quoted phrase', () => {
    const result = parseQuery('"getting started"')
    expect(result).toEqual({ ok: true, value: { clauses: [phrase('getting started')] } })
  })

  it('parses an empty phrase', () => {
    const result = parseQuery('""')
    expect(result).toEqual({ ok: true, value: { clauses: [phrase('')] } })
  })

  it('unescapes a quote and a backslash inside a phrase', () => {
    const result = parseQuery(String.raw`"say \"hi\" \\now"`)
    expect(result).toEqual({ ok: true, value: { clauses: [phrase('say "hi" \\now')] } })
  })

  it('negates a term with a leading dash', () => {
    const result = parseQuery('-draft')
    expect(result).toEqual({ ok: true, value: { clauses: [term('draft', true)] } })
  })

  it('negates a phrase with a leading dash', () => {
    const result = parseQuery('-"work in progress"')
    expect(result).toEqual({
      ok: true,
      value: { clauses: [phrase('work in progress', true)] },
    })
  })

  it.each(['title', 'tag', 'owner', 'status', 'collection', 'in'] as const)(
    'parses the %s field filter',
    (key) => {
      const result = parseQuery(`${key}:value`)
      expect(result).toEqual({ ok: true, value: { clauses: [filter(key, 'value')] } })
    },
  )

  it('reads a field filter key case-insensitively', () => {
    const result = parseQuery('TAG:release')
    expect(result).toEqual({ ok: true, value: { clauses: [filter('tag', 'release')] } })
  })

  it('parses in:workspace', () => {
    const result = parseQuery('in:workspace')
    expect(result).toEqual({ ok: true, value: { clauses: [filter('in', 'workspace')] } })
  })

  it('parses a quoted field filter value with spaces', () => {
    const result = parseQuery('owner:"Jane Doe"')
    expect(result).toEqual({ ok: true, value: { clauses: [filter('owner', 'Jane Doe')] } })
  })

  it('negates a field filter', () => {
    const result = parseQuery('-status:archived')
    expect(result).toEqual({ ok: true, value: { clauses: [filter('status', 'archived', true)] } })
  })

  it('treats an unknown field prefix as a plain term', () => {
    const result = parseQuery('foo:bar')
    expect(result).toEqual({ ok: true, value: { clauses: [term('foo:bar')] } })
  })

  it('parses a mix of terms, phrases, exclusions, and filters', () => {
    const result = parseQuery('release notes -draft tag:changelog "breaking change"')
    expect(result).toEqual({
      ok: true,
      value: {
        clauses: [
          term('release'),
          term('notes'),
          term('draft', true),
          filter('tag', 'changelog'),
          phrase('breaking change'),
        ],
      },
    })
  })

  it('reports the position of an unterminated quoted phrase', () => {
    const result = parseQuery('hello "world')
    expect(result).toEqual({
      ok: false,
      error: { kind: 'unterminated-quote', position: 6, message: expect.any(String) },
    })
  })

  it('reports the position of an unterminated quoted filter value', () => {
    const result = parseQuery('title:"never closes')
    expect(result).toEqual({
      ok: false,
      error: { kind: 'unterminated-quote', position: 6, message: expect.any(String) },
    })
  })

  it('reports an empty filter value at the end of input', () => {
    const result = parseQuery('title:')
    expect(result).toEqual({
      ok: false,
      error: { kind: 'empty-filter-value', position: 5, message: expect.any(String) },
    })
  })

  it('reports an empty filter value before whitespace', () => {
    const result = parseQuery('title: rest')
    expect(result).toEqual({
      ok: false,
      error: { kind: 'empty-filter-value', position: 5, message: expect.any(String) },
    })
  })

  it('reports an empty quoted filter value', () => {
    const result = parseQuery('title:""')
    expect(result).toEqual({
      ok: false,
      error: { kind: 'empty-filter-value', position: 5, message: expect.any(String) },
    })
  })
})
