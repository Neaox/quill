import { preloadDialogs } from './dialog.tsx'
import { preloadMenus } from './menu.tsx'
import { preloadPopovers } from './revision-timeline.tsx'
import { preloadTooltips } from './tooltip.tsx'

/**
 * Fetches every overlay's on-demand machinery now (`lib/on-demand.ts`).
 *
 * A page never needs to: each overlay asks for its own in idle time and holds
 * a press that lands first. It is for a test environment, which should render
 * a component the way a settled page does, and for anything that knows a
 * press is imminent.
 */
export async function preloadOverlays(): Promise<void> {
  await Promise.all([preloadDialogs(), preloadMenus(), preloadPopovers(), preloadTooltips()])
}
