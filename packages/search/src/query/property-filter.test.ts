import { describe, expect, it } from 'vitest'

import { parsePropertyFilter } from './property-filter.ts'

describe('parsePropertyFilter', () => {
  it('splits at the first equals sign and folds both halves', () => {
    expect(parsePropertyFilter('Severity=High')).toEqual({ key: 'severity', value: 'high' })
    expect(parsePropertyFilter('  note = a=b ')).toEqual({ key: 'note', value: 'a=b' })
  })

  it.each(['severity', 'severity=', '=high', ' =high', 'severity=  ', '=', ''])(
    'is nothing for %j, so the filter matches nothing rather than everything',
    (text) => {
      expect(parsePropertyFilter(text)).toBeNull()
    },
  )
})
