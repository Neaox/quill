import { afterEach, describe, expect, it, vi } from 'vitest'

import { MENU_MAX_HEIGHT, MENU_WIDTH, currentViewport, placeMenu } from './slash-position.ts'

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 375, height: 667 }

describe('placing the menu', () => {
  it('goes under the caret when there is room', () => {
    const placement = placeMenu({ top: 100, bottom: 120, left: 400 }, DESKTOP)
    expect(placement).toEqual({
      side: 'below',
      sheet: false,
      left: 400,
      width: MENU_WIDTH,
      maxHeight: MENU_MAX_HEIGHT,
      top: 126,
    })
  })

  it('flips above the caret near the bottom of the screen', () => {
    const placement = placeMenu({ top: 820, bottom: 840, left: 400 }, DESKTOP)
    expect(placement.side).toBe('above')
    expect(placement.bottom).toBe(900 - 820 + 6)
    expect(placement.top).toBeUndefined()
    expect(placement.maxHeight).toBe(MENU_MAX_HEIGHT)
  })

  it('stays under a caret near the bottom when there is no more room above', () => {
    const short = { width: 1440, height: 200 }
    const placement = placeMenu({ top: 60, bottom: 80, left: 0 }, short)
    expect(placement.side).toBe('below')
    expect(placement.maxHeight).toBe(200 - 80 - 6 - 8)
  })

  it('never runs off the right edge or the left', () => {
    expect(placeMenu({ top: 0, bottom: 20, left: 1400 }, DESKTOP).left).toBe(1440 - MENU_WIDTH - 8)
    expect(placeMenu({ top: 0, bottom: 20, left: -40 }, DESKTOP).left).toBe(8)
  })

  it('spans a phone’s screen, less its margins', () => {
    const placement = placeMenu({ top: 300, bottom: 320, left: 200 }, PHONE)
    expect(placement).toMatchObject({ sheet: true, left: 8, width: 375 - 16 })
  })

  it('opens in the corner when the caret cannot be measured', () => {
    expect(placeMenu(null, DESKTOP)).toMatchObject({ side: 'below', left: 8, top: 14 })
  })

  it('gives itself no height rather than a negative one in a tiny window', () => {
    expect(placeMenu({ top: 0, bottom: 20, left: 0 }, { width: 300, height: 10 }).maxHeight).toBe(0)
  })
})

describe('the viewport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is the visual viewport where there is one, which leaves out a phone’s keyboard', () => {
    vi.stubGlobal('visualViewport', { width: 375, height: 400 })
    expect(currentViewport()).toEqual({ width: 375, height: 400 })
  })

  it('is the window otherwise', () => {
    vi.stubGlobal('visualViewport', null)
    expect(currentViewport()).toEqual({ width: innerWidth, height: innerHeight })
    vi.stubGlobal('visualViewport', undefined)
    expect(currentViewport()).toEqual({ width: innerWidth, height: innerHeight })
  })
})
