import { describe, expect, it } from 'vitest'

import {
  CARD_LAYOUTS,
  DEFAULT_CARD_LAYOUT,
  LINK_DISPLAYS,
  UNCHOSEN,
  isBlockDisplay,
  isCardLayout,
  isLinkDisplay,
} from './display.ts'

describe('the link display vocabulary', () => {
  it('has the displays of the ADR, plain link first', () => {
    expect(LINK_DISPLAYS).toEqual(['url', 'inline', 'compact', 'card', 'embed'])
  })

  it('knows which displays are blocks of their own, and so cannot sit in a line', () => {
    expect(LINK_DISPLAYS.filter((display) => isBlockDisplay(display))).toEqual([
      'compact',
      'card',
      'embed',
    ])
  })

  it('recognises each display and nothing else', () => {
    for (const display of LINK_DISPLAYS) expect(isLinkDisplay(display)).toBe(true)
    for (const other of ['', 'Card', 'chip', 'bookmark', null, undefined, 3]) {
      expect(isLinkDisplay(other)).toBe(false)
    }
  })

  it('recognises each card layout and nothing else', () => {
    expect(CARD_LAYOUTS).toContain(DEFAULT_CARD_LAYOUT)
    for (const layout of CARD_LAYOUTS) expect(isCardLayout(layout)).toBe(true)
    for (const other of ['', 'large', 'Top', null, undefined])
      expect(isCardLayout(other)).toBe(false)
  })

  it('starts from no choice at all: the default decides', () => {
    expect(UNCHOSEN).toEqual({
      display: null,
      layout: 'side',
      showImage: true,
      title: null,
      description: null,
    })
  })
})
