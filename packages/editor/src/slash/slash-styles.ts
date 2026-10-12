import type { CSSProperties } from 'react'
import { tv } from 'tailwind-variants'

import type { MenuPlacement } from './slash-position.ts'
import type { SlashMenuWording } from './slash-store.ts'

/**
 * The parts of the menu in one definition. Which item is active is said
 * once, by `aria-activedescendant`; the option carries a boolean attribute the
 * colour follows, never a class chosen in JSX.
 */
export const slashMenuStyles = tv({
  slots: {
    root:
      'slash-menu fixed z-30 flex flex-col overflow-hidden rounded-md border ' +
      'border-border-strong/70 bg-surface-raised shadow-raised',
    list: 'min-h-0 overflow-y-auto overscroll-contain px-1 touch-pan-y [scrollbar-width:thin]',
    heading:
      'flex items-end px-2 pb-1 text-2xs font-medium tracking-caps text-muted ' +
      'uppercase select-none data-offscreen:sr-only',
    option: 'flex cursor-pointer items-center gap-3 rounded-sm px-2 text-sm data-active:bg-surface',
    icon:
      'flex size-8 shrink-0 items-center justify-center rounded-sm border border-border ' +
      'bg-surface text-foreground-soft',
    text: 'flex min-w-0 grow flex-col',
    label: 'truncate font-medium text-foreground',
    mark: 'bg-transparent font-semibold text-accent',
    description: 'truncate text-xs text-foreground-soft',
    kbd:
      'ms-auto shrink-0 rounded-sm border border-border-strong bg-surface px-1.5 font-mono ' +
      'text-2xs leading-5 text-foreground-soft',
    empty: 'px-3 py-3 text-sm text-foreground-soft',
    // An emoji's own picture, drawn where a block's icon is.
    image: 'size-5 object-contain',
  },
})

/** The list's own padding above its first row and below its last, in pixels. */
export const LIST_PADDING = 4

/**
 * How tall each kind of row is, in rem. The list is windowed by arithmetic, so
 * a row's height has to be a number the code knows as well as the stylesheet
 * does. It is given as an inline height in rem rather than as a spacing class
 * for that reason: a spacing class follows the design's density, which code
 * cannot read, while a rem is the root font size times a number, which it can
 * (`rootFontSize`). The two cannot drift apart, which is how the last rows of
 * the list ended up out of reach when the real rows were taller than the sums.
 */
export const OPTION_REM = 2.75
export const HEADING_REM = 1.75

export const OPTION_STYLE: CSSProperties = { height: `${String(OPTION_REM)}rem` }
export const HEADING_STYLE: CSSProperties = { height: `${String(HEADING_REM)}rem` }

/** The root font size in pixels, which a rem is a multiple of; 16 where the browser cannot say. */
export function rootFontSize(): number {
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(size) && size > 0 ? size : 16
}

/** Where a placement puts the menu, as the few numbers a stylesheet cannot know. */

/**
 * The space the windowed-out rows would take, kept as padding so the list
 * scrolls as if every row were drawn. Geometry, not design: no token can say it.
 */
export function windowStyle(window: {
  readonly before: number
  readonly after: number
}): CSSProperties {
  return { paddingTop: LIST_PADDING + window.before, paddingBottom: LIST_PADDING + window.after }
}

export function placementStyle(placement: MenuPlacement): CSSProperties {
  return {
    left: placement.left,
    width: placement.width,
    maxHeight: placement.maxHeight,
    ...(placement.top === undefined ? {} : { top: placement.top }),
    ...(placement.bottom === undefined ? {} : { bottom: placement.bottom }),
  }
}

/** How many blocks a list offers, said the way a person would. */
export function countMessage(count: number, noun = 'block'): string {
  if (count === 0) return `No ${noun}s`
  return count === 1 ? `1 ${noun}` : `${String(count)} ${noun}s`
}

/** What the insert menu says: it lists blocks. */
export const BLOCK_WORDING: SlashMenuWording = {
  name: 'Insert a block',
  empty: (query) => `No blocks match “${query}”`,
  count: countMessage,
}

const slots = slashMenuStyles()

/**
 * Each part's classes, worked out once. A list re-renders on every
 * keystroke, and merging a row's class lists afresh for every row on every
 * key is a measurable share of a frame.
 */
export const slashMenuClasses = {
  list: slots.list(),
  heading: slots.heading(),
  option: slots.option(),
  icon: slots.icon(),
  image: slots.image(),
  text: slots.text(),
  label: slots.label(),
  mark: slots.mark(),
  description: slots.description(),
  kbd: slots.kbd(),
  empty: slots.empty(),
} as const
