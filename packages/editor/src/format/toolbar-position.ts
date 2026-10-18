/**
 * Where the selection toolbar goes: above the selected words, centred on
 * them, never over them. Below them when there is no room above — under the
 * application's sticky bar, say — and never past either side of the area it
 * may cover: the page's main region, so it never lies over the workspace
 * sidebar or the rail beside it. Pure arithmetic, so it is tested without a
 * layout engine.
 */

export interface Box {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export interface ToolbarPlacement {
  readonly side: 'above' | 'below'
  readonly top: number
  readonly left: number
}

/** Between the words and the toolbar, and between the toolbar and an edge. */
const GAP = 8
const MARGIN = 8

/** A horizontal stretch of the screen, in viewport pixels. */
export interface Span {
  readonly left: number
  readonly right: number
}

/** The narrowest main region worth keeping to: about half a toolbar. */
const MIN_REGION = 240

/**
 * The stretch the toolbar may cover: the main region, as far as it is on
 * screen, so the toolbar never lies over the sidebar or the rail. A region
 * narrower than the toolbar still holds it, and the toolbar scrolls sideways
 * inside it as it does on a phone; only a region too narrow to use, or none,
 * gives way to the whole screen.
 */
export function toolbarArea(region: Span | undefined, viewportWidth: number): Span {
  const screen = { left: 0, right: viewportWidth }
  if (region === undefined) return screen
  const left = Math.max(0, region.left)
  const right = Math.min(viewportWidth, region.right)
  return right - left >= MIN_REGION ? { left, right } : screen
}

/** The widest the toolbar may be in its area, a margin clear of both sides. */
export function toolbarRoom(area: Span): number {
  return area.right - area.left - 2 * MARGIN
}

export function placeToolbar(
  selection: Box,
  toolbar: { readonly width: number; readonly height: number },
  area: Span,
  /** Where the screen's own sticky chrome ends: nothing is drawn under it. */
  chromeTop = 0,
): ToolbarPlacement {
  const above = selection.top - GAP - toolbar.height
  const side = above >= chromeTop + MARGIN ? 'above' : 'below'
  const top = side === 'above' ? above : selection.bottom + GAP
  const centre = (selection.left + selection.right) / 2
  const first = area.left + MARGIN
  const last = Math.max(first, area.right - toolbar.width - MARGIN)
  const left = Math.min(Math.max(first, centre - toolbar.width / 2), last)
  return { side, top, left }
}
