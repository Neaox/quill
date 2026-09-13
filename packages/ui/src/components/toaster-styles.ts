import { tv } from '../lib/class-names.ts'

/**
 * Every visible pixel of a toast, in one definition.
 *
 * It lives apart from both the public `Toaster` and the library-backed host it
 * loads so that neither has to import the other (review 2026-09-13, H1: the
 * host, and the toast library inside it, are a chunk a reader only fetches
 * once the application has painted).
 */
export const toasterStyles = tv({
  slots: {
    toast: [
      'relative flex w-full items-start gap-2.5 rounded-lg border-s-2',
      'bg-surface-raised p-4 text-foreground shadow-overlay',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    icon: 'mt-0.5 shrink-0',
    content: 'flex min-w-0 flex-1 flex-col',
    title: 'text-xs leading-snug font-semibold text-foreground',
    description: 'mt-1 text-xs leading-relaxed text-muted',
    action: [
      'order-2 inline-flex h-7 shrink-0 items-center justify-center self-start rounded-md border',
      'border-border-strong px-2.5 text-2xs font-medium text-foreground transition-colors',
      'hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2',
      'focus-visible:outline-focus-ring',
    ],
    cancel: [
      'order-2 inline-flex h-7 shrink-0 items-center justify-center self-start rounded-md px-2.5',
      'text-2xs font-medium text-muted transition-colors hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    close: [
      'order-last -m-1 ms-1 inline-flex size-7 shrink-0 items-center justify-center self-start',
      'rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
  },
  variants: {
    tone: {
      neutral: { toast: 'border-s-border-strong text-muted' },
      success: { toast: 'border-s-success text-success' },
      info: { toast: 'border-s-accent text-accent' },
      warning: { toast: 'border-s-warning text-warning' },
      danger: { toast: 'border-s-danger text-danger' },
    },
  },
  defaultVariants: { tone: 'neutral' },
})

/** Where the stack anchors on the viewport. */
export type ToasterPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center'
