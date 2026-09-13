/**
 * Round-trip properties for the query language: `parseQuery` and
 * `serializeQuery` must agree on every well-formed `SearchQuery`, however it
 * was assembled. The arbitraries stay inside the grammar's unambiguous
 * territory (a term never holds whitespace, a colon, a quote, or a leading
 * dash — the parser would read those back as something else) so the
 * property is about the serializer and parser agreeing with each other, not
 * about guessing what a user meant by adversarial input.
 */
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { parseQuery } from './parse.ts'
import { FIELD_FILTER_KEYS, type QueryClause, type SearchQuery } from './query.ts'
import { serializeQuery } from './serialize.ts'

const termValue = fc
  .string({ minLength: 1, maxLength: 12, unit: 'grapheme' })
  .filter((value) => !/[\s"\\:]/.test(value) && !value.startsWith('-'))

const filterValue = fc.string({ minLength: 1, maxLength: 16, unit: 'grapheme' })
const phraseValue = fc.string({ maxLength: 16, unit: 'grapheme' })
const fieldKey = fc.constantFrom(...FIELD_FILTER_KEYS)
const negated = fc.boolean()

const clauseArbitrary: fc.Arbitrary<QueryClause> = fc.oneof(
  fc.record({ kind: fc.constant('term' as const), value: termValue, negated }),
  fc.record({ kind: fc.constant('phrase' as const), value: phraseValue, negated }),
  fc.record({
    kind: fc.constant('filter' as const),
    key: fieldKey,
    value: filterValue,
    negated,
  }),
)

const searchQueryArbitrary: fc.Arbitrary<SearchQuery> = fc
  .array(clauseArbitrary, { maxLength: 8 })
  .map((clauses) => ({ clauses }))

describe('query round trip', () => {
  it('parses back what it serialized, clause for clause', () => {
    fc.assert(
      fc.property(searchQueryArbitrary, (query) => {
        const text = serializeQuery(query)
        const parsed = parseQuery(text)
        expect(parsed).toEqual({ ok: true, value: query })
      }),
    )
  })

  it('serializing what it parsed reproduces an equivalent query', () => {
    fc.assert(
      fc.property(searchQueryArbitrary, (query) => {
        const text = serializeQuery(query)
        const reparsed = parseQuery(text)
        expect(reparsed.ok).toBe(true)
        const roundTripped = reparsed.ok ? serializeQuery(reparsed.value) : ''
        expect(roundTripped).toBe(text)
      }),
    )
  })
})
