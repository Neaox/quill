import { BRAND } from '@quill/brand'
import { tv } from '@quill/ui'

/**
 * The product's mark and name, set together.
 *
 * The mark is a page: a tile in the ink colour with two lines of text across
 * it in the paper colour and a short third line in the accent, the one place
 * the signal colour sits. It is drawn entirely from the semantic tokens, so it
 * follows every identity and both schemes (ADR-028) with no colour of its own,
 * and it is a shape rather than a letter or a picture of the product's code
 * name, so a rename (`docs/operations/renaming.md`) changes only the words
 * beside it.
 *
 * Decorative: the name next to it is the label, so the mark is hidden from
 * assistive technology and never focusable.
 */
const brandLockup = tv({
  slots: {
    root: 'inline-flex items-center gap-2.5 text-foreground',
    mark: 'shrink-0',
    name: 'font-display font-semibold tracking-tight',
  },
  variants: {
    size: {
      md: { mark: 'size-6', name: 'text-base' },
      lg: { mark: 'size-7', name: 'text-lg' },
    },
  },
  defaultVariants: { size: 'md' },
})

export interface BrandLockupProps {
  readonly size?: 'md' | 'lg'
  readonly className?: string | undefined
}

export function BrandLockup({ size, className }: BrandLockupProps) {
  const styles = brandLockup({ size })
  return (
    <span className={styles.root({ className })}>
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={styles.mark()}>
        <rect width="32" height="32" rx="8" className="fill-foreground" />
        <rect x="8" y="9" width="16" height="3" rx="1.5" className="fill-background" />
        <rect x="8" y="14.5" width="16" height="3" rx="1.5" className="fill-background" />
        <rect x="8" y="20" width="9" height="3" rx="1.5" className="fill-accent" />
      </svg>
      <span className={styles.name()}>{BRAND.name}</span>
    </span>
  )
}
