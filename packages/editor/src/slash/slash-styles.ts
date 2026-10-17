import type { CSSProperties } from 'react'
import { tv } from 'tailwind-variants'

import type { MenuPlacement } from './slash-position.ts'

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
    list: 'min-h-0 overflow-y-auto overscroll-contain px-1 py-1 touch-pan-y [scrollbar-width:thin]',
    heading:
      'flex h-7 items-end px-2 pb-1 text-2xs font-medium tracking-caps text-muted ' +
      'uppercase select-none data-offscreen:sr-only',
    option:
      'flex h-11 cursor-pointer items-center gap-3 rounded-sm px-2 text-sm ' +
      'data-active:bg-surface',
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
  },
})

/** The list's own padding above its first row and below its last, in pixels: `py-1`. */
export const LIST_PADDING = 4

/** The panel's border, top and bottom, which the list scrolls inside. */
export const PANEL_FRAME = 2

/** The height the list scrolls in, given the panel's: the panel less its border. */
export function listViewport(panelHeight: number): number {
  return Math.max(0, panelHeight - PANEL_FRAME)
}

/**
 * The space the windowed-out rows would take, kept as padding on the rows'
 * own box inside the list, so the list scrolls as if every row were drawn.
 * Never on the scrolling list itself: an element cannot be shorter than its
 * padding, so a list padded by a thousand pixels of absent rows grows past
 * the panel's height, the panel clips it, and the end can never be scrolled
 * to. Geometry, not design: no token can say it.
 */
export function windowStyle(window: {
  readonly before: number
  readonly after: number
}): CSSProperties {
  return { paddingTop: window.before, paddingBottom: window.after }
}

/** Where a placement puts the menu, as the few numbers a stylesheet cannot know. */
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
  text: slots.text(),
  label: slots.label(),
  mark: slots.mark(),
  description: slots.description(),
  kbd: slots.kbd(),
  empty: slots.empty(),
} as const
