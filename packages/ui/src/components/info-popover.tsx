import { useId, type ReactNode } from 'react'
import { Popover as Primitive } from 'radix-ui'

import { tv } from '../lib/class-names.ts'
import { ExternalIcon, InfoIcon } from './icons.tsx'

export const infoPopoverStyles = tv({
  slots: {
    trigger: [
      'inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full',
      'text-muted transition-colors hover:text-foreground data-[state=open]:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      // The glyph is small; the target is not (WCAG 2.5.8).
      'relative before:absolute before:-inset-2.5 before:content-[""]',
    ],
    panel: [
      'menu-panel z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border border-border',
      'bg-surface-raised p-4 text-xs leading-relaxed text-body shadow-overlay',
    ],
    title: 'text-sm font-medium text-foreground',
    link: [
      'inline-flex items-center gap-1 self-start font-medium text-accent-ink underline',
      'decoration-accent-ink/40 underline-offset-2 hover:decoration-accent-ink',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    arrow: 'fill-surface-raised',
  },
})

export interface InfoPopoverProps {
  /** The button's name: what it explains, e.g. "About AA text contrast". */
  readonly label: string
  /** The panel's heading, which also names it. */
  readonly title: string
  /** The explanation, in plain words. */
  readonly children: ReactNode
  /** Where to read more: a primary source, such as the W3C's own guidance. */
  readonly learnMore?: { readonly href: string; readonly label: string } | undefined
}

/**
 * An ⓘ beside a setting that opens a short explanation of it.
 *
 * A popover, not a tooltip: it opens on a click or a tap, so it works on a
 * touch screen, and it may hold a link, which a tooltip may not. It is for the
 * background a setting assumes ("what is AA?"), never for what the setting
 * does: that stays in the description under its label, always visible.
 * Escape and a click elsewhere close it and focus returns to the ⓘ, which is
 * the primitive's. The link leaves the product, so it opens a new tab with
 * no handle on this one (ADR-011).
 */
export function InfoPopover({ label, title, children, learnMore }: InfoPopoverProps) {
  const titleId = useId()
  const styles = infoPopoverStyles()

  return (
    <Primitive.Root>
      <Primitive.Trigger className={styles.trigger()} aria-label={label}>
        <InfoIcon />
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          aria-labelledby={titleId}
          className={styles.panel()}
        >
          <p id={titleId} className={styles.title()}>
            {title}
          </p>
          <div>{children}</div>
          {learnMore === undefined ? undefined : (
            <a
              className={styles.link()}
              href={learnMore.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {learnMore.label}
              <ExternalIcon />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          <Primitive.Arrow className={styles.arrow()} width={12} height={6} />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
