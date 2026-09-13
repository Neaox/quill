import type { VariantProps } from 'tailwind-variants'

import { tv } from '../lib/class-names.ts'

/**
 * An inline text link: "Sign in" inside a sentence, "Go to your workspaces"
 * under a notice, "Open the organisation page" beside a set-up step.
 *
 * The one link shape the rest of this package has no primitive for — its
 * others are `Button`/`buttonClassName` for button-shaped actions, `Breadcrumb`
 * for a trail, and the `linkComponent` seam for navigation surfaces — and, as
 * of the third consumer outside the auth screens, one worth owning here rather
 * than in an application (rule 12, the rule of three).
 *
 * A class list rather than a component, for the same reason `buttonClassName`
 * is: the element is the application's router `Link`, or an `<a>`, or a
 * `<button>` in a sentence, and this is the appearance they borrow.
 *
 * Interaction state is entirely Tailwind variants over native pseudo-classes
 * and the browser's own focus handling (`docs/architecture/styling.md`, rule
 * 1): no JavaScript decides a colour here.
 */
export const textLinkStyles = tv({
  base: [
    'rounded-sm text-accent underline decoration-transparent underline-offset-2',
    'transition-[color,text-decoration-color] hover:decoration-current',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
  ],
  variants: {
    /** `inherit` takes the surrounding text's size, which is the usual case in prose. */
    size: { inherit: '', xs: 'text-xs', sm: 'text-sm' },
  },
  defaultVariants: { size: 'inherit' },
})

export type TextLinkVariants = VariantProps<typeof textLinkStyles>

export interface TextLinkClassOptions {
  readonly size?: NonNullable<TextLinkVariants['size']>
  readonly className?: string | undefined
}

export function textLinkClassName({ size, className }: TextLinkClassOptions = {}): string {
  return textLinkStyles({ size, class: className })
}
