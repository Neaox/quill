import { describe, expect, it } from 'vitest'

import {
  acceptSuggestion,
  filterChips,
  FILTERS,
  keySuggestions,
  tokenAt,
  withClause,
  withoutClause,
} from './search-filters.ts'

describe('FILTERS', () => {
  it('describes every filter the language has, once, in the order they are offered', () => {
    expect(FILTERS.map((filter) => filter.key)).toEqual([
      'by',
      'team',
      'tag',
      'collection',
      'in',
      'status',
      'owner',
      'prop',
      'title',
    ])
  })

  it('says in words what each one is for, so a list of them needs no manual', () => {
    for (const filter of FILTERS) {
      expect(filter.label.length).toBeGreaterThan(0)
      expect(filter.hint.length).toBeGreaterThan(0)
    }
  })
})

describe('filterChips', () => {
  it('has no chips for words, phrases and exclusions: only filters are chips', () => {
    expect(filterChips('failover "exact phrase" -draft')).toEqual([])
  })

  it('makes a chip of each filter, in the order typed, remembering which clause it was', () => {
    expect(filterChips('failover tag:runbook by:me')).toMatchObject([
      { clause: 1, key: 'tag', value: 'runbook', negated: false },
      { clause: 2, key: 'by', value: 'me', negated: false },
    ])
  })

  it('reads a quoted value as the words inside the quotes', () => {
    expect(filterChips('by:"Ada Lovelace"')).toMatchObject([{ key: 'by', value: 'Ada Lovelace' }])
  })

  it('knows a filter that was left out', () => {
    expect(filterChips('-team:platform')).toMatchObject([
      { key: 'team', value: 'platform', negated: true },
    ])
  })

  it('says what each chip says, so it can be read as a sentence and named for a screen reader', () => {
    expect(filterChips('by:me -tag:old team:"Platform team"').map((chip) => chip.text)).toEqual([
      'By: me',
      'Not tag: old',
      'Team: Platform team',
    ])
  })

  it('reads a custom property as "Property: key=value", and a left-out one with a Not', () => {
    expect(filterChips('prop:severity=high -prop:"customer name=Acme Ltd"')).toMatchObject([
      { key: 'prop', value: 'severity=high', text: 'Property: severity=high' },
      { key: 'prop', value: 'customer name=Acme Ltd', negated: true },
    ])
    expect(filterChips('-prop:severity=high')[0]?.text).toBe('Not property: severity=high')
  })

  it('has no chips for a query that cannot be read, rather than guessing at part of it', () => {
    expect(filterChips('by:"never closed')).toEqual([])
    expect(filterChips('tag:')).toEqual([])
  })
})

describe('keySuggestions', () => {
  it('offers the property filter to somebody typing its first letters', () => {
    expect(keySuggestions('pr').map((filter) => filter.key)).toEqual(['prop'])
  })
})

describe('withoutClause', () => {
  it('takes one filter out and leaves everything else as it was', () => {
    expect(withoutClause('failover tag:runbook by:me', 1)).toBe('failover by:me')
  })

  it('keeps a quoted value quoted, and a phrase a phrase', () => {
    expect(withoutClause('"exact phrase" by:"Ada Lovelace" tag:x', 2)).toBe(
      '"exact phrase" by:"Ada Lovelace"',
    )
  })

  it('can empty the query', () => {
    expect(withoutClause('tag:x', 0)).toBe('')
  })

  it('leaves text it cannot read exactly as it is', () => {
    expect(withoutClause('by:"never closed', 0)).toBe('by:"never closed')
  })

  it('leaves the query alone for a clause that is not there', () => {
    expect(withoutClause('tag:x', 5)).toBe('tag:x')
  })
})

describe('withClause', () => {
  it('adds a filter after what is there, leaving words and phrases exactly as they were', () => {
    expect(withClause('failover "exact phrase" -draft', 'tag', 'api')).toBe(
      'failover "exact phrase" -draft tag:api',
    )
  })

  it('starts a query from nothing', () => {
    expect(withClause('', 'status', 'draft')).toBe('status:draft')
  })

  it('quotes a value that needs it, through the serializer rather than by hand', () => {
    expect(withClause('by:me', 'collection', 'Release notes')).toBe(
      'by:me collection:"Release notes"',
    )
    expect(withClause('', 'tag', 'say "hi"')).toBe('tag:"say \\"hi\\""')
  })

  it('keeps a hierarchical tag whole', () => {
    expect(withClause('x', 'tag', 'area/billing')).toBe('x tag:area/billing')
  })

  it('leaves text it cannot read exactly as it is', () => {
    expect(withClause('by:"never closed', 'tag', 'api')).toBe('by:"never closed')
  })
})

describe('tokenAt', () => {
  it('is empty in the whitespace between words, where a new one would start', () => {
    expect(tokenAt('failover  tag:x', 9)).toEqual({
      start: 9,
      end: 9,
      raw: '',
      negated: false,
      key: null,
      value: '',
    })
  })

  it('is empty in an empty box', () => {
    expect(tokenAt('', 0)).toMatchObject({ start: 0, end: 0, key: null, value: '' })
  })

  it('finds a word being typed, at either end of it and inside it', () => {
    for (const caret of [9, 10, 12]) {
      expect(tokenAt('failover tea', caret)).toMatchObject({
        start: 9,
        end: 12,
        raw: 'tea',
        key: null,
        value: 'tea',
      })
    }
  })

  it('finds the key and the part of the value typed so far', () => {
    expect(tokenAt('failover by:sa', 14)).toMatchObject({
      start: 9,
      end: 14,
      raw: 'by:sa',
      key: 'by',
      value: 'sa',
      negated: false,
    })
  })

  it('finds a filter with nothing after its colon yet, which is where suggestions begin', () => {
    expect(tokenAt('by:', 3)).toMatchObject({ key: 'by', value: '' })
  })

  it('reads the key whatever its case, and a minus as leaving it out', () => {
    expect(tokenAt('-TAG:ru', 7)).toMatchObject({ key: 'tag', value: 'ru', negated: true })
  })

  it('keeps a quoted value together, spaces and all, and unquotes it', () => {
    expect(tokenAt('by:"Ada Lov', 11)).toMatchObject({
      start: 0,
      end: 11,
      key: 'by',
      value: 'Ada Lov',
    })
    expect(tokenAt('by:"Ada Lovelace" tag:x', 6)).toMatchObject({
      start: 0,
      end: 17,
      key: 'by',
      value: 'Ada Lovelace',
    })
  })

  it('reads the escapes the language has inside a quoted value', () => {
    expect(tokenAt('by:"a\\"b\\\\c"', 4)).toMatchObject({ key: 'by', value: 'a"b\\c' })
  })

  it('treats a colon after a word that is not a filter as an ordinary word', () => {
    expect(tokenAt('http:foo', 8)).toMatchObject({ key: null, value: 'http:foo' })
  })

  it('treats a phrase as a word with nothing to suggest', () => {
    expect(tokenAt('"exact phr', 10)).toMatchObject({ key: null })
  })

  it('finds the token the caret is in, not the last one', () => {
    expect(tokenAt('by:sa tag:ru', 3)).toMatchObject({ key: 'by', value: 'sa' })
    expect(tokenAt('by:sa tag:ru', 12)).toMatchObject({ key: 'tag', value: 'ru' })
  })
})

describe('keySuggestions', () => {
  it('offers the filters a word begins, whatever its case', () => {
    expect(keySuggestions('t').map((filter) => filter.key)).toEqual(['team', 'tag', 'title'])
    expect(keySuggestions('TE').map((filter) => filter.key)).toEqual(['team'])
  })

  it('offers nothing for nothing typed, rather than every filter on every space', () => {
    expect(keySuggestions('')).toEqual([])
  })

  it('offers nothing for a word no filter begins', () => {
    expect(keySuggestions('failover')).toEqual([])
  })

  it('does not offer the filter a word already is', () => {
    expect(keySuggestions('team')).toEqual([])
  })
})

describe('acceptSuggestion', () => {
  it('replaces the token with the filter and its chosen value, and a space to carry on from', () => {
    const token = tokenAt('failover by:sa', 14)
    expect(acceptSuggestion('failover by:sa', token, 'by', 'Sam Taylor')).toEqual({
      text: 'failover by:"Sam Taylor" ',
      caret: 25,
    })
  })

  it('quotes only a value that needs it', () => {
    const token = tokenAt('tag:ru', 6)
    expect(acceptSuggestion('tag:ru', token, 'tag', 'runbook')).toEqual({
      text: 'tag:runbook ',
      caret: 12,
    })
  })

  it('keeps a minus: choosing a value does not turn leaving a person out into asking for them', () => {
    const token = tokenAt('-by:sa', 6)
    expect(acceptSuggestion('-by:sa', token, 'by', 'Sam')).toEqual({
      text: '-by:Sam ',
      caret: 8,
    })
  })

  it('replaces a quoted token whole, and leaves what follows it alone', () => {
    const typed = 'by:"Ada Lov" tag:x'
    const token = tokenAt(typed, 11)
    expect(token).toMatchObject({ start: 0, end: 12, value: 'Ada Lov' })
    expect(acceptSuggestion(typed, token, 'by', 'Ada Lovelace')).toEqual({
      text: 'by:"Ada Lovelace" tag:x',
      caret: 17,
    })
  })

  it('replaces a quote still open, which runs to the end of what is typed', () => {
    const typed = 'by:"Ada Lov'
    expect(acceptSuggestion(typed, tokenAt(typed, 11), 'by', 'Ada Lovelace')).toEqual({
      text: 'by:"Ada Lovelace" ',
      caret: 18,
    })
  })

  it('does not add a space where one already follows', () => {
    const token = tokenAt('by:sa tag:x', 5)
    expect(acceptSuggestion('by:sa tag:x', token, 'by', 'Sam')).toEqual({
      text: 'by:Sam tag:x',
      caret: 6,
    })
  })

  it('turns a word being typed into the filter it begins, ready for its value', () => {
    const token = tokenAt('failover te', 11)
    expect(acceptSuggestion('failover te', token, 'team', null)).toEqual({
      text: 'failover team:',
      caret: 14,
    })
  })
})
