import { useRef, useState, type ReactNode } from 'react'
import { Slot } from 'radix-ui'

import { onDemand, useOnDemand, useOnDemandWhen } from '../lib/on-demand.ts'
import type { DialogProps } from './dialog-model.ts'

export {
  dialogStyles,
  type DialogElevation,
  type DialogPlacement,
  type DialogProps,
} from './dialog-model.ts'

/**
 * The dialog's machinery — focus trap, scroll lock, inert background,
 * dismissal — fetched on demand (quill-plan.md section 31; `lib/on-demand.ts`).
 * A closed dialog draws nothing but its trigger, so a page needs none of it to
 * paint: it is asked for in idle time, or at once when the dialog is opened or
 * its trigger is hovered, focused or pressed.
 */
const panels = onDemand(() => import('./dialog-panels.tsx'))

/** Fetches the dialog's machinery now; safe to call repeatedly. */
export function preloadDialogs(): Promise<unknown> {
  return panels.load()
}

/**
 * A modal dialog.
 *
 * Focus moves into the panel on open, is trapped while it is open, and returns
 * to the trigger on close; Escape and a click outside both dismiss it; the
 * rest of the page is inert and hidden from assistive technology. All of that
 * is the primitive's job, and the reason this layer does not hand-roll it.
 *
 * Until the primitive has arrived the dialog is its trigger alone, announced
 * as the dialog trigger it will be; a press on it is held, and the dialog
 * opens as soon as it can. The trigger stays that same element afterwards —
 * the primitive opens beside it and returns focus to it — so a click that
 * lands as the module arrives is never on a node that has just been replaced.
 */
export function Dialog(props: DialogProps) {
  const { open, onOpenChange, trigger } = props
  // Owned here unless the caller owns it, so the trigger below is never the
  // primitive's: the primitive is attached to it and never replaces it.
  const [ownOpen, setOwnOpen] = useState(false)
  const isOpen = open ?? ownOpen
  const setOpen = (next: boolean) => {
    if (open === undefined) setOwnOpen(next)
    onOpenChange?.(next)
  }
  // Only this dialog, once opened: a page of closed dialogs keeps its light
  // triggers when the module arrives (`useOnDemandWhen`).
  const loaded = useOnDemandWhen(panels, isOpen)
  const triggerRef = useRef<HTMLElement>(null)

  const preload = () => {
    void panels.load().catch(() => undefined)
  }
  return (
    <>
      {trigger === undefined ? undefined : (
        <Slot.Root
          ref={triggerRef}
          aria-haspopup="dialog"
          aria-expanded={isOpen && loaded !== undefined}
          data-state={isOpen && loaded !== undefined ? 'open' : 'closed'}
          aria-busy={isOpen && loaded === undefined ? true : undefined}
          onPointerEnter={preload}
          onFocus={preload}
          onClick={() => {
            setOpen(true)
          }}
        >
          {trigger}
        </Slot.Root>
      )}
      {loaded === undefined ? undefined : (
        <loaded.RadixDialog
          {...props}
          open={isOpen}
          onOpenChange={setOpen}
          returnFocusTo={triggerRef}
        />
      )}
    </>
  )
}

/**
 * Closes the nearest dialog. Wrap a `Button` with it in a dialog footer.
 *
 * Only ever drawn inside an open dialog, whose machinery has therefore
 * arrived.
 */
export function DialogClose({ children }: { readonly children: ReactNode }) {
  const loaded = useOnDemand(panels, true)
  return loaded === undefined ? (
    children
  ) : (
    <loaded.RadixDialogClose>{children}</loaded.RadixDialogClose>
  )
}
