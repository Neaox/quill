import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import type { VariantProps } from 'tailwind-variants'

import { tv } from '../lib/class-names.ts'
import { Spinner } from './spinner.tsx'

/**
 * The accent is the product's one signal colour, so exactly one variant wears
 * it: the primary action. Everything else is drawn in ink on paper, which is
 * what keeps the accent meaningful when it does appear.
 *
 * Heights are the artboard's compact rows. The small size is 28 pixels, which
 * still clears the 24-pixel floor of WCAG 2.2 SC 2.5.8, and `lg` is the touch
 * size for the places a phone reaches first.
 *
 * Every state lives in `base` and follows a real attribute, so each variant
 * gets each state without restating it.
 */
export const buttonStyles = tv({
  base: [
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border font-medium',
    'whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow]',
    'ease-standard focus-visible:outline-2 focus-visible:outline-offset-2',
    'focus-visible:outline-focus-ring',
    'disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress',
  ],
  variants: {
    variant: {
      primary: 'border-transparent bg-accent text-accent-foreground hover:bg-accent-hover',
      secondary:
        'border-border bg-surface-raised text-foreground hover:border-border-strong hover:bg-surface',
      ghost: 'border-transparent bg-transparent text-muted hover:bg-surface hover:text-foreground',
      danger: 'border-transparent bg-danger text-accent-foreground hover:bg-danger-hover',
    },
    size: {
      sm: 'h-7 px-2.5 text-2xs',
      md: 'h-8 px-3 text-xs',
      lg: 'h-10 px-4 text-sm',
    },
  },
  compoundVariants: [{ variant: 'ghost', size: 'sm', class: 'px-2' }],
  defaultVariants: { variant: 'primary', size: 'md' },
})

type ButtonStyleProps = VariantProps<typeof buttonStyles>

export type ButtonVariant = NonNullable<ButtonStyleProps['variant']>
export type ButtonSize = NonNullable<ButtonStyleProps['size']>

export interface ButtonClassOptions {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly className?: string | undefined
}

/**
 * The button's class list, without the button.
 *
 * A link that navigates must be an anchor, not a button with a click handler,
 * but it should still look like one. This is the supported way to borrow the
 * appearance: the classes stay in one place, so a change to the button reaches
 * every link that looks like one.
 */
export function buttonClassName({ variant, size, className }: ButtonClassOptions = {}): string {
  return buttonStyles({ variant, size, class: className })
}

export interface ButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  /** Visual weight. `primary` is the single most important action on a view. */
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  /** Shows a spinner in place of the leading icon and blocks interaction. */
  readonly loading?: boolean
  /** Icon rendered before the label. Decorative; the label carries the meaning. */
  readonly iconStart?: ReactNode
  /** Icon rendered after the label. */
  readonly iconEnd?: ReactNode
  readonly children: ReactNode
}

/**
 * The button primitive.
 *
 * A real `<button>` with an explicit default `type` of `button`, so a button
 * inside a form never submits it by accident. Disabled and loading states are
 * the same to a pointer but different to a screen reader: `aria-busy` says the
 * action is in flight rather than unavailable, and both are attributes the
 * style follows rather than class strings assembled here.
 */
export function Button({
  variant,
  size,
  loading = false,
  iconStart,
  iconEnd,
  className,
  children,
  disabled = false,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonStyles({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading}
      {...rest}
    >
      {loading ? <Spinner /> : iconStart}
      <span>{children}</span>
      {iconEnd}
    </button>
  )
}
