import { describe, expect, it } from 'vitest'

import { pageLayoutAttributes } from './page-attributes.ts'

describe('the layout attributes a themed page carries', () => {
  it('takes each axis from the organisation’s layout first, then from the theme', () => {
    expect(
      pageLayoutAttributes([
        { rules: 'plain', navigation: 'tree' },
        { rules: 'hairline', align: 'start' },
      ]),
    ).toEqual({ 'data-rules': 'plain', 'data-align': 'start' })
  })

  it('passes through a value a newer schema adds, without knowing it', () => {
    expect(pageLayoutAttributes([undefined, { align: 'centre' }])).toEqual({
      'data-align': 'centre',
    })
  })

  it('carries only the axes the stylesheet reads from the page', () => {
    expect(pageLayoutAttributes([{ comments: 'panel', header: 'readout' }])).toEqual({})
  })

  it('passes nothing that is not a bare word, because it becomes an attribute on every page', () => {
    expect(pageLayoutAttributes([{ rules: '"><script>', align: 7 }, { rules: 'cards' }])).toEqual({
      'data-rules': 'cards',
    })
  })
})
