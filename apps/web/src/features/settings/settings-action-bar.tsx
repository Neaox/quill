import type { ReactNode } from 'react'

import { tv } from '@quill/ui'

export const settingsActionBarStyles = tv({
  slots: {
    // Keeps the last control clear of the bar: the same height the bar
    // occupies, safe-area inset included, held open at the end of the flow.
    spacer: 'h-[calc(var(--spacing)*17+env(safe-area-inset-bottom))] shrink-0',
    bar: [
      'fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-border',
      'bg-background/92 px-4 pt-3 backdrop-blur-md',
      'pb-[max(calc(var(--spacing)*3),env(safe-area-inset-bottom))]',
    ],
  },
})

export interface SettingsActionBarProps {
  /** Names the bar as a region, so it can be reached from the landmarks list. */
  readonly label: string
  readonly children: ReactNode
}

/**
 * A settings screen's actions on a phone or a narrow tablet: a bar held to
 * the bottom of the viewport, where a thumb is, instead of a Save button at
 * the top of a page that is mostly a long column of controls.
 *
 * It is a different surface rather than the desktop bar reflowed, so a screen
 * renders it *instead of* `SettingsActions` below the compact breakpoint
 * (`COMPACT_EDITOR_QUERY`), never as well. It clears the home indicator
 * through `safe-area-inset-bottom`, and leaves a spacer of its own height at
 * the end of the page so the last control can always be scrolled above it.
 */
export function SettingsActionBar({ label, children }: SettingsActionBarProps) {
  const styles = settingsActionBarStyles()

  return (
    <>
      <div aria-hidden="true" className={styles.spacer()} />
      <section aria-label={label} className={styles.bar()}>
        {children}
      </section>
    </>
  )
}
