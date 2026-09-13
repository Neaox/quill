import type { ReactNode } from 'react'
import type { VariantProps } from 'tailwind-variants'

import { tv } from '../lib/class-names.ts'

/**
 * Set in the mono face at the metadata size, because a badge is a fact about a
 * document rather than part of one — the same rule the header readout and the
 * table headings follow.
 */
export const badgeStyles = tv({
  base: [
    'inline-flex items-center gap-1 rounded-sm border px-1.5 py-px',
    'font-mono text-2xs tracking-caps uppercase whitespace-nowrap',
  ],
  variants: {
    tone: {
      neutral: 'border-border bg-surface text-muted',
      accent: 'border-accent/40 bg-accent-subtle text-accent',
      success: 'border-success/40 bg-success-subtle text-success',
      warning: 'border-warning/45 bg-warning-subtle text-warning',
      danger: 'border-danger/40 bg-danger-subtle text-danger',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export type BadgeTone = NonNullable<VariantProps<typeof badgeStyles>['tone']>

export interface BadgeProps {
  readonly tone?: BadgeTone
  readonly children: ReactNode
  readonly className?: string | undefined
}

/**
 * A short status label.
 *
 * Its text stands on its own: the tone is emphasis, never the meaning, so a
 * badge reads correctly in monochrome and to a screen reader.
 */
export function Badge({ tone, children, className }: BadgeProps) {
  return <span className={badgeStyles({ tone, className })}>{children}</span>
}
