import type { SlashRect } from './slash-store.ts'

/**
 * Where the menu goes, worked out from the caret and the viewport alone.
 *
 * Under the caret when it fits; above it when the caret is near the bottom
 * and there is more room there; never past an edge. On a phone the menu is
 * the width of the screen less its margins, anchored to the caret's line, so
 * every row is a comfortable target and nothing is cut off at the side.
 * Pure arithmetic, so it is tested without a layout engine.
 */

export interface Viewport {
  readonly width: number
  readonly height: number
}

export interface MenuPlacement {
  readonly side: 'below' | 'above'
  /** Full width on a narrow screen. */
  readonly sheet: boolean
  readonly left: number
  readonly width: number
  readonly maxHeight: number
  /** From the top of the viewport, when below the caret. */
  readonly top?: number
  /** From the bottom of the viewport, when above it. */
  readonly bottom?: number
}

/** The widest the menu is drawn. */
export const MENU_WIDTH = 368
/** The tallest it is drawn: about eight rows, the most a list can be scanned at a glance. */
export const MENU_MAX_HEIGHT = 384
/** Below this, the menu is room enough for a few rows; less, and the other side is tried. */
const COMFORTABLE_HEIGHT = 220
/** Between the caret and the menu, and between the menu and the viewport's edge. */
const GAP = 6
const MARGIN = 8
/** The screen width below which the menu spans the screen. */
export const SHEET_BELOW = 640

export function placeMenu(rect: SlashRect | null, viewport: Viewport): MenuPlacement {
  const sheet = viewport.width < SHEET_BELOW
  const width = sheet
    ? viewport.width - MARGIN * 2
    : Math.min(MENU_WIDTH, viewport.width - MARGIN * 2)
  const caret = rect ?? { top: MARGIN, bottom: MARGIN, left: MARGIN }
  const left = sheet
    ? MARGIN
    : Math.max(MARGIN, Math.min(caret.left, viewport.width - width - MARGIN))
  const roomBelow = viewport.height - caret.bottom - GAP - MARGIN
  const roomAbove = caret.top - GAP - MARGIN
  const side = roomBelow >= COMFORTABLE_HEIGHT || roomBelow >= roomAbove ? 'below' : 'above'
  const maxHeight = Math.max(0, Math.min(MENU_MAX_HEIGHT, side === 'below' ? roomBelow : roomAbove))
  return side === 'below'
    ? { side, sheet, left, width, maxHeight, top: caret.bottom + GAP }
    : { side, sheet, left, width, maxHeight, bottom: viewport.height - caret.top + GAP }
}

/** The part of the window the author can see, which on a phone excludes the keyboard. */
export function currentViewport(): Viewport {
  const visual = globalThis.visualViewport
  return visual === null || visual === undefined
    ? { width: globalThis.innerWidth, height: globalThis.innerHeight }
    : { width: visual.width, height: visual.height }
}
