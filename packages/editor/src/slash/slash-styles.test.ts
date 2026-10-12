import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  HEADING_REM,
  HEADING_STYLE,
  LIST_PADDING,
  OPTION_REM,
  OPTION_STYLE,
  rootFontSize,
  windowStyle,
} from './slash-styles.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('how tall the menu’s rows are', () => {
  it('says each kind of row’s height in rem, which is what the stylesheet and the sums share', () => {
    expect(OPTION_STYLE).toEqual({ height: `${String(OPTION_REM)}rem` })
    expect(HEADING_STYLE).toEqual({ height: `${String(HEADING_REM)}rem` })
  })

  it('reads the root font size a rem is a multiple of', () => {
    vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({
      fontSize: '18.28px',
    } as CSSStyleDeclaration)
    expect(rootFontSize()).toBe(18.28)
  })

  it('falls back to 16 pixels where the browser cannot say', () => {
    expect(rootFontSize()).toBe(16)
    vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({
      fontSize: '0px',
    } as CSSStyleDeclaration)
    expect(rootFontSize()).toBe(16)
  })
})

describe('the space a windowed list keeps for the rows it is not drawing', () => {
  it('is its own padding plus the height of the rows above and below', () => {
    expect(windowStyle({ before: 100, after: 250 })).toEqual({
      paddingTop: LIST_PADDING + 100,
      paddingBottom: LIST_PADDING + 250,
    })
  })
})
