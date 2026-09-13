import type { ReactNode } from 'react'
import { Dialog as Primitive } from 'radix-ui'
import type { VariantProps } from 'tailwind-variants'

import { tv } from '../lib/class-names.ts'
import { CloseIcon } from './icons.tsx'

/**
 * One definition for the whole dialog.
 *
 * The entrance animation is not here: `.dialog-overlay` and `.dialog-panel` in
 * `tokens.css` key it on Radix's own `data-state`, beside the keyframes and
 * the reduced-motion rule that neutralises them, so it is stated once.
 */
export const dialogStyles = tv({
  slots: {
    overlay: 'dialog-overlay fixed inset-0 bg-overlay',
    panel: [
      'dialog-panel fixed top-1/2 left-1/2 w-[min(32rem,calc(100vw-2rem))]',
      'rounded-lg border border-border bg-surface-raised p-5 shadow-dialog',
      // A dialog never grows past the viewport: its body scrolls instead, so
      // the actions in the footer are always reachable however long the form
      // inside it is (a destination picker over a large workspace, say).
      'flex max-h-[calc(100dvh-2rem)] flex-col',
    ],
    header: 'flex shrink-0 items-start justify-between gap-4',
    headings: 'flex flex-col gap-1.5',
    title: 'text-base leading-snug font-semibold tracking-tight text-foreground',
    description: 'text-xs leading-relaxed text-muted',
    close: [
      '-me-1.5 -mt-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md',
      'text-muted transition-colors hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    body: 'mt-4 min-h-0 grow overflow-y-auto text-xs leading-relaxed text-foreground [&>*+*]:mt-3',
    footer: 'mt-6 flex shrink-0 flex-wrap justify-end gap-2 border-t border-border pt-4',
  },
  variants: {
    /**
     * Which layer a dialog sits on.
     *
     * A modal earns its press by suspending everything behind it, and the
     * dimming is how that is said. A second dialog opened *from* a dialog —
     * a destructive confirmation over the panel that offered it — therefore
     * needs its own overlay to paint above the first panel rather than
     * beneath it, or the two read as one confused surface with the question
     * floating on it. `nested` is that step up; nothing needs a third.
     */
    elevation: {
      base: { overlay: 'z-40', panel: 'z-50' },
      nested: { overlay: 'z-60', panel: 'z-70' },
    },
  },
  defaultVariants: { elevation: 'base' },
})

export type DialogElevation = NonNullable<VariantProps<typeof dialogStyles>['elevation']>

export interface DialogProps {
  /** Controlled open state. Omit to let the dialog own it. */
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  /** The element that opens the dialog. Omit when driving `open` yourself. */
  readonly trigger?: ReactNode
  /** Required: a dialog without an accessible name is unusable without sight. */
  readonly title: string
  readonly description?: string
  readonly children: ReactNode
  /** Actions, laid out end-aligned under a divider. */
  readonly footer?: ReactNode
  readonly closeLabel?: string
  /** `nested` for a dialog opened from inside another one. */
  readonly elevation?: DialogElevation
  readonly className?: string | undefined
}

/**
 * A modal dialog.
 *
 * Focus moves into the panel on open, is trapped while it is open, and returns
 * to the trigger on close; Escape and a click outside both dismiss it; the
 * rest of the page is inert and hidden from assistive technology. All of that
 * is the primitive's job, and the reason this layer does not hand-roll it.
 */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  closeLabel = 'Close',
  elevation,
  className,
}: DialogProps) {
  const styles = dialogStyles({ elevation })

  return (
    <Primitive.Root
      // Forwarded only when supplied: an explicit `undefined` would make the
      // primitive think it is controlled with no value.
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      {trigger === undefined ? undefined : <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>}
      <Primitive.Portal>
        <Primitive.Overlay className={styles.overlay()} />
        <Primitive.Content
          // Without a description there is nothing to point at, and the
          // primitive warns rather than silently describing the dialog by a
          // dangling id.
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          className={styles.panel({ className })}
        >
          <div className={styles.header()}>
            <div className={styles.headings()}>
              <Primitive.Title className={styles.title()}>{title}</Primitive.Title>
              {description === undefined ? undefined : (
                <Primitive.Description className={styles.description()}>
                  {description}
                </Primitive.Description>
              )}
            </div>
            <Primitive.Close aria-label={closeLabel} className={styles.close()}>
              <CloseIcon />
            </Primitive.Close>
          </div>

          <div className={styles.body()}>{children}</div>

          {footer === undefined ? undefined : <div className={styles.footer()}>{footer}</div>}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}

/** Closes the nearest dialog. Wrap a `Button` with it in a dialog footer. */
export function DialogClose({ children }: { readonly children: ReactNode }) {
  return <Primitive.Close asChild>{children}</Primitive.Close>
}
