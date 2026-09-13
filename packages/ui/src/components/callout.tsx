import type { ReactNode } from 'react'
import type { VariantProps } from 'tailwind-variants'

import { tv } from '../lib/class-names.ts'
import { DangerIcon, InfoIcon, SuccessIcon, WarningIcon } from './icons.tsx'

/**
 * The artboard's note: a rule down the leading edge on a quiet surface, not a
 * tinted box. That is what keeps a callout part of the document rather than an
 * interruption of it, and it is why the only colour is the two-pixel rule.
 *
 * Three slots, so the tone reaches the rule, the icon, and the heading line
 * from one place.
 */
export const calloutStyles = tv({
  slots: {
    root: [
      'grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 border-s-2 px-4 py-3',
      'rounded-e-md text-sm leading-relaxed text-foreground',
    ],
    icon: 'mt-px size-3.5',
    heading: 'meta',
    body: 'col-start-2 [&>*+*]:mt-2',
  },
  variants: {
    tone: {
      info: { root: 'border-s-accent bg-surface', icon: 'text-accent', heading: 'text-accent' },
      success: {
        root: 'border-s-success bg-success-subtle',
        icon: 'text-success',
        heading: 'text-success',
      },
      warning: {
        root: 'border-s-warning bg-warning-subtle',
        icon: 'text-warning',
        heading: 'text-warning',
      },
      danger: {
        root: 'border-s-danger bg-danger-subtle',
        icon: 'text-danger',
        heading: 'text-danger',
      },
    },
  },
  defaultVariants: { tone: 'info' },
})

export type CalloutTone = NonNullable<VariantProps<typeof calloutStyles>['tone']>

/**
 * Tone is carried by colour and by an icon, neither of which a screen reader
 * can interpret, so it is also carried by words: the tone word always begins
 * the callout's accessible name.
 */
const TONE_CONTENT: Readonly<
  Record<CalloutTone, { readonly label: string; readonly Icon: typeof InfoIcon }>
> = {
  info: { label: 'Note', Icon: InfoIcon },
  success: { label: 'Success', Icon: SuccessIcon },
  warning: { label: 'Warning', Icon: WarningIcon },
  danger: { label: 'Danger', Icon: DangerIcon },
}

export interface CalloutProps {
  readonly tone?: CalloutTone
  /** Optional headline. Without one the tone word is the only heading. */
  readonly title?: string
  readonly children: ReactNode
  readonly className?: string | undefined
}

/**
 * An aside that changes the weight of a passage without changing its meaning.
 *
 * Rendered as a labelled group rather than an alert: a callout is part of the
 * document, not an interruption, so assistive technology should meet it in
 * reading order rather than be interrupted by it. The heading line repeats the
 * tone visually, in the metadata face, and is hidden from the accessibility
 * tree to avoid announcing it twice.
 */
export function Callout({ tone = 'info', title, children, className }: CalloutProps) {
  const { label, Icon } = TONE_CONTENT[tone]
  const styles = calloutStyles({ tone })

  return (
    <div
      role="group"
      aria-label={title === undefined ? label : `${label}: ${title}`}
      className={styles.root({ className })}
    >
      <Icon className={styles.icon()} />
      <p aria-hidden="true" className={styles.heading()}>
        {title ?? label}
      </p>
      <div className={styles.body()}>{children}</div>
    </div>
  )
}
