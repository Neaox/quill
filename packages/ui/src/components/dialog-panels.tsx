import type { ReactNode, RefObject } from 'react'
import { Dialog as Primitive } from 'radix-ui'

import { dialogStyles, type DialogProps } from './dialog-model.ts'
import { CloseIcon } from './icons.tsx'

/*
 * The dialog's Radix half, fetched on demand (`dialog.tsx`): focus trapping,
 * the scroll lock, hiding the rest of the page from assistive technology, and
 * dismissal are all of what a dialog weighs and none of what a closed one
 * draws.
 */

/**
 * A modal dialog.
 *
 * Focus moves into the panel on open, is trapped while it is open, and returns
 * to the trigger on close; Escape and a click outside both dismiss it; the
 * rest of the page is inert and hidden from assistive technology. All of that
 * is the primitive's job, and the reason this layer does not hand-roll it.
 */
export function RadixDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel = 'Close',
  elevation,
  placement,
  className,
  onCloseAutoFocus,
  returnFocusTo,
}: Omit<DialogProps, 'trigger'> & {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The light trigger `dialog.tsx` drew, which this never replaces; focus goes back to it on close. */
  readonly returnFocusTo: RefObject<HTMLElement | null>
}) {
  const styles = dialogStyles({ elevation, placement })

  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className={styles.overlay()} />
        <Primitive.Content
          // Without a description there is nothing to point at, and the
          // primitive warns rather than silently describing the dialog by a
          // dangling id.
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event)
            if (event.defaultPrevented) return
            event.preventDefault()
            returnFocusTo.current?.focus()
          }}
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
export function RadixDialogClose({ children }: { readonly children: ReactNode }) {
  return <Primitive.Close asChild>{children}</Primitive.Close>
}
